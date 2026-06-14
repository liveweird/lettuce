import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

const FEEDBACK = {
  id: 5,
  requesterId: null,
  subjectId: 7,
  providerId: 10,
  visibility: "PUBLIC",
  status: "SENT",
  content: "Nice work on the launch",
};

function renderViewFeedback(query = "?providerName=Alice") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/5/view${query}`]}>
          <Routes>
            <Route path="/feedback/:id/view" element={<ViewFeedback />} />
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
    expect((screen.getByLabelText("Content") as HTMLTextAreaElement).value).toBe(
      "Nice work on the launch",
    );

    // Everything is read-only: there is no Save/Edit control, only Close.
    expect(screen.getByLabelText("Content")).toBeDisabled();
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
});
