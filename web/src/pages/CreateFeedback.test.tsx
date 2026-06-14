import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateFeedback from "./CreateFeedback";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderCreateFeedback(query = "?subjectId=5&subjectName=Mona") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/new${query}`]}>
          <Routes>
            <Route path="/feedback/new" element={<CreateFeedback />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateFeedback page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "USER");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows the immutable subject, provider and status", () => {
    renderCreateFeedback();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Mona");
    expect((screen.getByLabelText("Provider") as HTMLInputElement).value).toBe("You");
    expect((screen.getByLabelText("Status") as HTMLInputElement).value).toBe("Draft");
    expect((screen.getByPlaceholderText("Select visibility") as HTMLInputElement).value).toBe(
      "Provider + subject",
    );
  });

  test("visibility offers only Provider+subject and Public", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    const listbox = await screen.findByRole("listbox", { hidden: true });
    const options = within(listbox)
      .getAllByRole("option", { hidden: true })
      .map((o) => o.textContent);
    expect(options).toEqual(["Provider + subject", "Public"]);
  });

  test("submits a DRAFT with no requester and redirects to the dashboard", async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { id: 99 }));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.type(screen.getByLabelText("Content"), "Great leadership this quarter");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      subjectId: 5,
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "Great leadership this quarter",
    });
    expect("requesterId" in body).toBe(false);
  });

  test("choosing Public is reflected in the submitted visibility", async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { id: 100 }));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    const listbox = await screen.findByRole("listbox", { hidden: true });
    await user.click(within(listbox).getByText("Public"));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse((postCall![1] as RequestInit).body as string).visibility).toBe("PUBLIC");
    });
  });

  test("surfaces an error alert when the API rejects the feedback", async () => {
    mockFetch.mockResolvedValue(jsonResponse(400, { error: "bad_request", message: "nope" }));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.type(screen.getByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("Cancel asks for confirmation; Discard leaves to the dashboard", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    expect(await screen.findByTestId("probe")).toHaveTextContent("/");
  });

  test("Cancel confirmation can be dismissed with Keep editing", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /keep editing/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("redirects to the dashboard when subjectId is missing", () => {
    renderCreateFeedback("");
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
