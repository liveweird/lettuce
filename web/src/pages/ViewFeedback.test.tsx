import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewFeedback from "./ViewFeedback";

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

const FEEDBACK = {
  id: 5,
  requesterId: null,
  subjectId: 7,
  providerId: 10,
  visibility: "PUBLIC",
  status: "SENT",
  content: "Nice work on the launch",
};

function renderViewFeedback(query = "?providerName=Alice", id = "5") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/${id}/view${query}`]}>
          <Routes>
            <Route path="/feedback/:id/view" element={<ViewFeedback />} />
            <Route path="/feedback" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ViewFeedback page", () => {
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

  test("renders the feedback read-only with a Close link to the received tab", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    renderViewFeedback();

    expect((await screen.findByLabelText("Provider")) as HTMLInputElement).toHaveValue("Alice");
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("You");
    expect((screen.getByLabelText("Requester") as HTMLInputElement).value).toBe("None");
    expect((screen.getByLabelText("Visibility") as HTMLInputElement).value).toBe("Public");
    expect((screen.getByLabelText("Status") as HTMLInputElement).value).toBe("Sent");
    // Content renders as read-only markdown, not an editable form control.
    expect(screen.getByText("Nice work on the launch")).toBeInTheDocument();

    // Everything is read-only: there is no editable Content control nor a Save control, only Close.
    expect(screen.queryByRole("textbox", { name: /content/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute(
      "href",
      "/feedback?tab=received",
    );
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();

    // Only the GET was issued — no mutations.
    expect(
      mockFetch.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET"),
    ).toBe(true);
  });

  test("404 shows a not-found alert with a Close link", async () => {
    mockFetch.mockResolvedValue(jsonResponse(404, { error: "not_found", message: "missing" }));
    renderViewFeedback();

    expect(await screen.findByText(/feedback not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute(
      "href",
      "/feedback?tab=received",
    );
  });

  test("403 load shows a permission message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(403, { error: "forbidden", message: "no" }));
    renderViewFeedback();

    expect(await screen.findByText(/don't have permission to view this feedback/i)).toBeInTheDocument();
  });

  test("a non-404/403 load error shows the generic failed message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { error: "internal", message: "boom" }));
    renderViewFeedback();

    expect(await screen.findByText(/failed to load feedback \(500\)/i)).toBeInTheDocument();
  });

  test("an invalid id redirects to the received tab", () => {
    renderViewFeedback("", "abc");
    expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=received");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("as=provider shows 'You' as provider and Close links to the provided tab", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    renderViewFeedback("?as=provider&subjectName=Mona");

    expect((await screen.findByLabelText("Provider")) as HTMLInputElement).toHaveValue("You");
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Mona");
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute(
      "href",
      "/feedback?tab=provided",
    );
  });

  test("as=team Close links to the team tab", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    renderViewFeedback("?as=team&subjectName=Mona");

    await screen.findByLabelText("Provider");
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute(
      "href",
      "/feedback?tab=team",
    );
  });

  test("an explicit back param overrides the tab default for the Close link", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    const back = encodeURIComponent("/users/10/feedbacks?name=Alice");
    renderViewFeedback(`?providerName=Alice&back=${back}`);

    await screen.findByLabelText("Provider");
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute(
      "href",
      "/users/10/feedbacks?name=Alice",
    );
  });

  test("the provider can advance the status and is navigated back", async () => {
    // Caller is the provider (userId === providerId), status SENT → next action is Withdraw.
    localStorage.setItem(USER_ID_KEY, "10");
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(200, FEEDBACK));
    });
    const user = userEvent.setup();
    renderViewFeedback();

    // Withdrawing is gated behind a confirmation modal.
    await user.click(await screen.findByRole("button", { name: /^withdraw$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^withdraw$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/feedback?tab=received"),
    );
    const putCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/feedbacks/5" && (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string).status).toBe("WITHDRAWN");
  });

  test("a rejected transition surfaces an action error and does not navigate", async () => {
    localStorage.setItem(USER_ID_KEY, "10");
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url === "/api/feedbacks/5") {
        return Promise.resolve(jsonResponse(400, { error: "bad_request", message: "no" }));
      }
      return Promise.resolve(jsonResponse(200, FEEDBACK));
    });
    const user = userEvent.setup();
    renderViewFeedback();

    await user.click(await screen.findByRole("button", { name: /^withdraw$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^withdraw$/i }));

    expect(await screen.findByText(/this status change is not allowed/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("a non-provider sees no status-transition action", async () => {
    // Caller (userId 7) is the subject, not the provider → no action button.
    mockFetch.mockResolvedValue(jsonResponse(200, FEEDBACK));
    renderViewFeedback();

    await screen.findByLabelText("Provider");
    expect(screen.queryByRole("button", { name: /^withdraw$/i })).not.toBeInTheDocument();
  });

  test("a requester viewing a REQUESTED feedback sees no Content section", async () => {
    // Caller (userId 7) is the requester; a never-drafted request has nothing to read.
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ...FEEDBACK,
        requesterId: 7,
        status: "REQUESTED",
        content: "should not show",
      }),
    );
    renderViewFeedback();

    // Other fields still render, but Content (label + body) is gone.
    expect((await screen.findByLabelText("Status")) as HTMLInputElement).toHaveValue("Requested");
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    expect(screen.queryByText("should not show")).not.toBeInTheDocument();
  });

  test("a requester viewing a REJECTED feedback sees no Content section", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ...FEEDBACK,
        requesterId: 7,
        status: "REJECTED",
        content: "should not show",
      }),
    );
    renderViewFeedback();

    expect((await screen.findByLabelText("Status")) as HTMLInputElement).toHaveValue("Rejected");
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    expect(screen.queryByText("should not show")).not.toBeInTheDocument();
  });

  test("a requester viewing a SENT feedback still sees Content", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { ...FEEDBACK, requesterId: 7, status: "SENT", content: "Delivered note" }),
    );
    renderViewFeedback();

    expect(await screen.findByText("Content")).toBeInTheDocument();
    expect(screen.getByText("Delivered note")).toBeInTheDocument();
  });

  test("a non-requester viewing a REQUESTED feedback still sees Content", async () => {
    // Caller (userId 7) is not the requester (requesterId 9) → the gate does not apply.
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ...FEEDBACK,
        requesterId: 9,
        status: "REQUESTED",
        content: "Still visible",
      }),
    );
    renderViewFeedback();

    expect(await screen.findByText("Content")).toBeInTheDocument();
    expect(screen.getByText("Still visible")).toBeInTheDocument();
  });
});
