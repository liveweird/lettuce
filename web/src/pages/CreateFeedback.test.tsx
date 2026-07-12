import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateFeedback from "./CreateFeedback";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea (see mockMarkdownEditor). Import inside the
// (hoisted) factory to avoid the top-level-variable restriction.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}


function renderCreateFeedback(query = "?subjectId=5&subjectName=Mona") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
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

  test("shows the immutable subject and provider with default visibility", () => {
    renderCreateFeedback();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Mona")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("Select visibility") as HTMLInputElement).value).toBe(
      "Provider + subject",
    );
  });

  test("visibility offers only Provider+subject and Public", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    // The Template select's listbox is empty in this test, so the only options in the
    // DOM are the visibility ones.
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["Provider + subject", "Public"]);
  });

  test("warns early and disables saving while a duplicate draft is in progress", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/v1/feedbacks/duplicate-check")) {
        return Promise.resolve(jsonResponse(200, { existingId: 42, existingStatus: "DRAFT" }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 }));
    });
    renderCreateFeedback();

    expect(await screen.findByText("A draft of this feedback already exists.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the existing feedback" })).toHaveAttribute(
      "href",
      "/feedback/42/edit",
    );
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();

    // The check fires with the page's triple (subject from the URL, caller as provider).
    const checkUrl = mockFetch.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("duplicate-check"));
    expect(checkUrl).toContain("subjectId=5");
    expect(checkUrl).toContain("providerId=7");
    expect(checkUrl).not.toContain("requesterId");
  });

  test("Save draft submits a DRAFT with no requester and redirects to the dashboard", async () => {
    // A fresh Response per call: the templates GET on mount must not consume the body
    // that the createFeedback POST also needs to read.
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 99 })));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.type(screen.getByLabelText("Content"), "Great leadership this quarter");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
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

  test("Save & send submits with status SENT and redirects to the dashboard", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 101 })));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.type(screen.getByLabelText("Content"), "Shipping this feedback");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.status).toBe("SENT");
    expect(body.content).toBe("Shipping this feedback");
    expect("requesterId" in body).toBe(false);
  });

  test("choosing Public is reflected in the submitted visibility", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 100 })));
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    await user.click(await screen.findByRole("option", { name: "Public", hidden: true }));
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
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
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

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

  test("an explicit back param redirects there after create", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(201, { id: 102 })));
    const back = "/users/10/feedbacks?name=Alice";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider env="test">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={[
              `/feedback/new?subjectId=10&subjectName=Alice&back=${encodeURIComponent(back)}`,
            ]}
          >
            <Routes>
              <Route path="/feedback/new" element={<CreateFeedback />} />
              <Route path="/users/:userId/feedbacks" element={<PathProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Content"), "Notes for Alice");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/users/10/feedbacks"),
    );
  });
});
