import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders, screen, waitFor } from "../test/render";
import Feedback from "./Feedback";

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

function teamsPage(total: number): Response {
  const items =
    total > 0
      ? [{ id: 1, name: "Platform", managerId: 7, managerName: "Me", managerDeleted: false }]
      : [];
  return jsonResponse(200, { items, page: 1, pageSize: 1, total });
}

function emptyFeedbacksPage(): Response {
  return jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 });
}

function mockApi(mockFetch: FetchMock, managedTeams: number) {
  mockFetch.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).startsWith("/api/v1/feedbacks") ? emptyFeedbacksPage() : teamsPage(managedTeams),
    ),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderFeedback(route = "/feedback") {
  return renderWithProviders(
    <>
      <Feedback />
      <LocationProbe />
    </>,
    { route },
  );
}

describe("Feedback page", () => {
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

  test("non-manager sees only Received and Provided tabs", async () => {
    mockApi(mockFetch, 0);
    renderFeedback();

    expect(screen.getByRole("tab", { name: "Received" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Provided" })).toBeInTheDocument();

    // The tabs carry the data-tour anchors the guided tour targets for its subsection steps.
    expect(screen.getByRole("tab", { name: "Received" })).toHaveAttribute(
      "data-tour",
      "feedback-received",
    );
    expect(screen.getByRole("tab", { name: "Provided" })).toHaveAttribute(
      "data-tour",
      "feedback-provided",
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/v1\/teams\?.*managerId=7/),
        expect.any(Object),
      ),
    );
    expect(screen.queryByRole("tab", { name: "My team" })).not.toBeInTheDocument();
  });

  test("manager sees the My team tab", async () => {
    mockApi(mockFetch, 1);
    renderFeedback();

    const teamTab = await screen.findByRole("tab", { name: "My team" });
    expect(teamTab).toBeInTheDocument();
    expect(teamTab).toHaveAttribute("data-tour", "feedback-team");
  });

  test("Received is active by default and clicking Provided switches tab and URL", async () => {
    mockApi(mockFetch, 0);
    const user = userEvent.setup();
    renderFeedback();

    expect(screen.getByRole("tab", { name: "Received" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Provided" }));

    expect(screen.getByRole("tab", { name: "Provided" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("location")).toHaveTextContent("/feedback?tab=provided");
  });

  test("?tab=provided in the URL activates the Provided tab on load", async () => {
    mockApi(mockFetch, 0);
    renderFeedback("/feedback?tab=provided");

    expect(screen.getByRole("tab", { name: "Provided" })).toHaveAttribute("aria-selected", "true");
  });

  test("?tab=team activates My team for a manager", async () => {
    mockApi(mockFetch, 1);
    renderFeedback("/feedback?tab=team");

    const teamTab = await screen.findByRole("tab", { name: "My team" });
    expect(teamTab).toHaveAttribute("aria-selected", "true");
  });

  test("?tab=team falls back to Received for a non-manager", async () => {
    mockApi(mockFetch, 0);
    renderFeedback("/feedback?tab=team");

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByRole("tab", { name: "My team" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Received" })).toHaveAttribute("aria-selected", "true");
  });

  test("an unknown ?tab= value falls back to Received", async () => {
    mockApi(mockFetch, 0);
    renderFeedback("/feedback?tab=bogus");

    expect(screen.getByRole("tab", { name: "Received" })).toHaveAttribute("aria-selected", "true");
  });
});
