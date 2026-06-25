import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RequestFeedback from "./RequestFeedback";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

// Requester is user 3; subject is user 7 (Mona). Providers are users 10/11.
const USER_POOL = [
  { id: 3, name: "Me Myself", email: "me@example.com", role: "USER" as const },
  { id: 7, name: "Mona Subject", email: "mona@example.com", role: "USER" as const },
  { id: 10, name: "Alice Provider", email: "alice@example.com", role: "USER" as const },
  { id: 11, name: "Bob Provider", email: "bob@example.com", role: "USER" as const },
];

function setupMocks(mockFetch: FetchMock, onFeedbacks: (init?: RequestInit) => Response) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/users?")) {
      return Promise.resolve(
        jsonResponse(200, { items: USER_POOL, page: 1, pageSize: 100, total: USER_POOL.length }),
      );
    }
    if (url === "/api/feedbacks") return Promise.resolve(onFeedbacks(init));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderRequestFeedback(query = "?subjectId=7&subjectName=Mona") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/request${query}`]}>
          <Routes>
            <Route path="/feedback/request" element={<RequestFeedback />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

// The provider picker is a searchable Select whose options come from an async user
// fetch. Typing keeps the dropdown open and findByRole retries, so this resolves the
// race against the pool load without depending on any other on-page data marker.
async function addProvider(user: ReturnType<typeof userEvent.setup>, label: string) {
  const input = screen.getByPlaceholderText("Pick a user");
  await user.click(input);
  await user.type(input, label.split(" ")[0]);
  await user.click(await screen.findByRole("option", { name: label, hidden: true }));
  await user.click(screen.getByRole("button", { name: /^add$/i }));
}

describe("RequestFeedback page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "3");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("redirects to the subordinates tab when subjectId is missing", () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 1 }));
    renderRequestFeedback("");
    expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates");
  });

  test("shows the subject and a provider picker that excludes the subject and the requester", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 1 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    expect((await screen.findByLabelText("Subject")) as HTMLInputElement).toHaveValue("Mona");
    expect((screen.getByLabelText("Requester") as HTMLInputElement).value).toBe("You");

    const picker = screen.getByPlaceholderText("Pick a user");
    await user.click(picker);
    // Typing the shared "Provider" substring keeps the dropdown open and lets the
    // async user pool resolve; only the two providers match.
    await user.type(picker, "Provider");
    expect(await screen.findByRole("option", { name: "Alice Provider", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bob Provider", hidden: true })).toBeInTheDocument();

    // The subject (Mona, id 7) and the requester (Me, id 3) are filtered out of the
    // picker even though both are in the pool.
    await user.clear(picker);
    await user.type(picker, "M");
    expect(screen.queryByRole("option", { name: "Mona Subject", hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Me Myself", hidden: true })).not.toBeInTheDocument();
  });

  test("adding a provider lists them; removing clears back to the empty state", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 1 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await addProvider(user, "Alice Provider");
    expect(screen.getByRole("cell", { name: "Alice Provider" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove alice provider/i }));
    expect(screen.queryByRole("cell", { name: "Alice Provider" })).not.toBeInTheDocument();
    expect(screen.getByText(/add at least one provider/i)).toBeInTheDocument();
  });

  test("Request is disabled until at least one provider is selected", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 1 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    expect(screen.getByRole("button", { name: /^request$/i })).toBeDisabled();

    await addProvider(user, "Alice Provider");
    expect(screen.getByRole("button", { name: /^request$/i })).not.toBeDisabled();
  });

  test("submitting creates a REQUESTED feedback per provider and navigates to subordinates", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 99 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=subordinates"),
    );
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => url === "/api/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      requesterId: 3,
      subjectId: 7,
      providerId: 10,
      visibility: "PROVIDER_REQUESTER_SUBJECT",
      status: "REQUESTED",
      content: "",
    });
  });

  test("a chosen visibility is reflected in the submitted request", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 99 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    // "Public" is unique to the visibility Select, so target the option directly rather
    // than a listbox (two Selects on this page each render a listbox).
    await user.click(screen.getByPlaceholderText("Select visibility"));
    await user.click(await screen.findByRole("option", { name: "Public", hidden: true }));

    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse((postCall![1] as RequestInit).body as string).visibility).toBe("PUBLIC");
    });
  });

  test("403 shows a permission error alert", async () => {
    setupMocks(mockFetch, () => jsonResponse(403, { error: "forbidden", message: "no" }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));

    expect(await screen.findByText(/don't have permission to request this feedback/i)).toBeInTheDocument();
  });

  test("400 shows a validation error alert", async () => {
    setupMocks(mockFetch, () => jsonResponse(400, { error: "bad_request", message: "no" }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));

    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
  });

  test("a network error shows a connection alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/users?")) {
        return Promise.resolve(
          jsonResponse(200, { items: USER_POOL, page: 1, pageSize: 100, total: USER_POOL.length }),
        );
      }
      if (url === "/api/feedbacks" && init?.method === "POST") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));

    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  });

  test("Cancel opens a discard modal whose Discard link points at subordinates", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 1 }));
    const user = userEvent.setup();
    renderRequestFeedback();

    await screen.findByLabelText("Subject");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/discard this feedback request/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /discard/i })).toHaveAttribute(
      "href",
      "/?tab=subordinates",
    );

    await user.click(within(dialog).getByRole("button", { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("honors an explicit back param on submit and discard", async () => {
    setupMocks(mockFetch, () => jsonResponse(201, { id: 99 }));
    const user = userEvent.setup();
    // back = "/?tab=peers", url-encoded
    renderRequestFeedback(
      `?subjectId=7&subjectName=Mona&back=${encodeURIComponent("/?tab=peers")}`,
    );

    await screen.findByLabelText("Subject");

    // Discard link points back at the originating tab, not the subordinates default.
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: /discard/i })).toHaveAttribute(
      "href",
      "/?tab=peers",
    );
    await user.click(within(dialog).getByRole("button", { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // Submitting also returns to the originating tab.
    await addProvider(user, "Alice Provider");
    await user.click(screen.getByRole("button", { name: /^request$/i }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/?tab=peers"));
  });
});
