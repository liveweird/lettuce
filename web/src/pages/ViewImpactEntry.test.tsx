import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewImpactEntry from "./ViewImpactEntry";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const ENTRY = {
  id: 5,
  userId: 8,
  userName: "Olga Owner",
  title: "Pipeline shipped",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  whatHappened: "Shipped the **pipeline**",
  contribution: "Built it",
  whyItMattered: "Cut the turnaround",
  evidence: "Kudos thread",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

const EVENTS = {
  items: [
    {
      id: 1,
      entryId: 5,
      userId: 8,
      userName: "Olga Owner",
      timestamp: Date.now(),
      type: "CREATED",
      params: { periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    },
  ],
};

function renderScreen(
  route = "/impact-log/5/view",
  entryStatus = 200,
  entry: Record<string, unknown> = ENTRY,
  errorBody: Record<string, unknown> = { title: "x" },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string) => {
    const u = String(url);
    if (u === "/api/v1/impact-log/5/events") {
      return Promise.resolve(jsonResponse(200, EVENTS));
    }
    if (u === "/api/v1/impact-log/5") {
      return Promise.resolve(jsonResponse(entryStatus, entryStatus === 200 ? entry : errorBody));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log/:id/view" element={<ViewImpactEntry />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("ViewImpactEntry page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the four labeled markdown sections, the owner, and the period", async () => {
    renderScreen();

    // The markdown renders (bold stripped to a strong element, so the text splits).
    expect(await screen.findByText("pipeline")).toBeInTheDocument();
    expect(screen.getByText("Built it")).toBeInTheDocument();
    expect(screen.getByText("Cut the turnaround")).toBeInTheDocument();
    expect(screen.getByText("Kudos thread")).toBeInTheDocument();
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(screen.getByText("My contribution")).toBeInTheDocument();
    expect(screen.getByText("Why did it matter")).toBeInTheDocument();
    expect(screen.getByText("What evidence / feedback supports that")).toBeInTheDocument();
    expect(screen.getByText("Olga Owner")).toBeInTheDocument();
    // The entry title renders in the header (v2.37.0).
    expect(screen.getByText("Pipeline shipped")).toBeInTheDocument();
    expect(screen.getByText("Jul 1, 2026 – Jul 31, 2026")).toBeInTheDocument();
    // The viewer (id 7) is not the owner (id 8) → no Edit entry point.
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
  });

  test("a single-day period collapses to one date (formatIsoDateRange, the ImpactLogTable rule)", async () => {
    renderScreen("/impact-log/5/view", 200, { ...ENTRY, periodStart: "2026-07-15", periodEnd: "2026-07-15" });

    expect(await screen.findByText("Pipeline shipped")).toBeInTheDocument();
    expect(screen.getByText("Jul 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/Jul 15, 2026 –/)).toBeNull();
  });

  test("the owner gets the Edit entry point; History shows the event trail", async () => {
    localStorage.setItem(USER_ID_KEY, "8");
    const user = userEvent.setup();
    renderScreen();

    expect(await screen.findByText("You")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^edit$/i })).toHaveAttribute(
      "href",
      "/impact-log/5/edit",
    );

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(
      await screen.findByText("Entry created for the period Jul 1, 2026 – Jul 31, 2026."),
    ).toBeInTheDocument();
  });

  test("each section contracts and expands independently (expanded by default)", async () => {
    const user = userEvent.setup();
    renderScreen();

    // The section label doubles as the toggle (the RequesterMessage idiom) — assert via
    // aria-expanded, not through Mantine's Collapse animation (the FilterPanel idiom).
    const toggle = await screen.findByRole("button", { name: "My contribution" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // A neighbor keeps its own state.
    expect(screen.getByRole("button", { name: "What happened" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("a 403 maps to the access wording, a 404 to not-found", async () => {
    renderScreen("/impact-log/5/view", 403);
    expect(await screen.findByText("You don't have access to this entry.")).toBeInTheDocument();
  });

  test("an invalid id redirects to the journal without fetching", () => {
    const mockFetch = renderScreen("/impact-log/abc/view");
    expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("ViewImpactEntry sharing (v4.8.0)", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("the Share button renders only when canShare is true", async () => {
    renderScreen("/impact-log/5/view", 200, { ...ENTRY, canShare: true });
    expect(await screen.findByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  test("canShare false hides the button, and a sharedBy read shows the banner without it", async () => {
    renderScreen("/impact-log/5/view", 200, { ...ENTRY, canShare: false, sharedBy: "Sue Sharer" });
    expect(await screen.findByText("Shared with you by Sue Sharer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    // Read-only: a sharee is never the owner, so there is no Edit entry point.
    expect(screen.queryByRole("link", { name: /^edit$/i })).toBeNull();
  });

  test("an upgraded read can carry sharedBy AND canShare — the button follows canShare only", async () => {
    renderScreen("/impact-log/5/view", 200, { ...ENTRY, canShare: true, sharedBy: "Sue Sharer" });
    expect(await screen.findByText("Shared with you by Sue Sharer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });

  test("the lapse 403 renders the friendly localized message, not the generic denial", async () => {
    renderScreen("/impact-log/5/view", 403, ENTRY, {
      title: "Forbidden",
      status: 403,
      detail: "The person who shared this no longer has access to it",
    });
    expect(
      await screen.findByText(
        "The person who shared this document with you can no longer open it, so your access has ended.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this entry.")).toBeNull();
  });
});
