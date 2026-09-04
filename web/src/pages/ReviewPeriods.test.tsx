import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ReviewPeriods from "./ReviewPeriods";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLES_KEY = "lettuce.auth.roles";

type FetchMock = ReturnType<typeof vi.fn>;

const PERIODS = [
  { id: 4, startMonth: "2025-07", endMonth: "2025-12" },
  { id: 5, startMonth: "2026-01", endMonth: "2026-06" },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/review-periods"]}>
          <Routes>
            <Route path="/review-periods" element={<ReviewPeriods />} />
            <Route path="/" element={<div>HOME</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ReviewPeriods page", () => {
  let mockFetch: FetchMock;

  function setupMocks(periods: unknown[] = PERIODS) {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return Promise.resolve(jsonResponse(201, { id: 6, startMonth: "2026-07", endMonth: "2026-12" }));
      }
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(200, { items: periods }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLES_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("non-admins get the read-only timeline: no append form, no delete, read-only hint", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify([]));
    setupMocks();
    renderPage();

    // The timeline renders for everyone (the Templates precedent)…
    expect(await screen.findByText("July 2025 – December 2025")).toBeInTheDocument();
    // The heading carries the data-tour anchor for the Config → Review periods step.
    expect(screen.getByRole("heading", { name: "Review periods" })).toHaveAttribute(
      "data-tour",
      "config-review-periods",
    );
    expect(screen.getByText("January 2026 – June 2026")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The global timeline performance reviews attach to. Periods are appended by an administrator without gaps and are immutable.",
      ),
    ).toBeInTheDocument();
    // …but every mutating affordance is gone.
    expect(screen.queryByRole("button", { name: "Add period" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete the period/ })).toBeNull();
    expect(screen.queryByLabelText("Last month")).toBeNull();
  });

  test("a non-admin's empty timeline points at the administrator instead of the form", async () => {
    localStorage.setItem(ROLES_KEY, JSON.stringify([]));
    setupMocks([]);
    renderPage();

    expect(
      await screen.findByText("No review periods yet — an administrator adds them here."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add period" })).toBeNull();
  });

  test("locks the next start as text, defaults a 6-month period, previews it, and appends", async () => {
    setupMocks();
    renderPage();

    expect(await screen.findByText("July 2025 – December 2025")).toBeInTheDocument();
    expect(screen.getByText("January 2026 – June 2026")).toBeInTheDocument();
    // The formatted range only — no duplicate raw-ISO line (v1.33.3).
    expect(screen.queryByText("2025-07 – 2025-12")).toBeNull();
    // The fixed start is plain text (no input to mistype) with the timeline rule spelled out.
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fixed — the timeline allows no gaps or overlaps: a new period starts right after the latest one ends.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("First month")).toBeNull();
    // The end pickers default to a 6-month period, previewed verbatim before Add.
    expect(screen.getByLabelText("Last month", { selector: "input" })).toHaveValue("December");
    expect(screen.getByLabelText("Year", { selector: "input" })).toHaveValue("2026");
    expect(screen.getByText("Will add: July 2026 – December 2026")).toBeInTheDocument();
    // Only the LATEST row offers Delete.
    expect(screen.getAllByRole("button", { name: /^Delete the period/ })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Add period" }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        startMonth: "2026-07",
        endMonth: "2026-12",
      });
    });
  });

  test("the period containing today carries the Current badge, others do not", async () => {
    // Fake only Date so waitFor keeps real timers (the TeamMembersTable idiom): today lands
    // inside the 2026-01..06 period and outside 2025-07..12.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-10T12:00:00"));
    try {
      setupMocks();
      renderPage();

      // The pill sits in the row's status cell (v3.4.0) — scope by the table row.
      const currentRow = (await screen.findByText("January 2026 – June 2026")).closest("tr");
      expect(within(currentRow as HTMLElement).getByText("Current")).toBeInTheDocument();
      const otherRow = screen.getByText("July 2025 – December 2025").closest("tr");
      expect(within(otherRow as HTMLElement).queryByText("Current")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("an end before the start is unpickable: same-year end months before the start are not offered", async () => {
    setupMocks();
    renderPage();

    // Start is fixed to 2026-07; with the end year at 2026, months before July are absent.
    await screen.findByText("July 2026");
    fireEvent.click(screen.getByLabelText("Last month", { selector: "input" }));
    expect(await screen.findByRole("option", { name: "July" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "December" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "June" })).toBeNull();
    expect(screen.queryByRole("option", { name: "January" })).toBeNull();
  });

  test("an empty timeline offers start pickers too and re-clamps an invalidated end", async () => {
    setupMocks([]);
    renderPage();

    expect(
      await screen.findByText("No review periods yet — add the first one above."),
    ).toBeInTheDocument();
    // Two picker pairs: (start month, start year) + (end month, end year).
    expect(screen.getByLabelText("First month", { selector: "input" })).toBeInTheDocument();
    const years = screen.getAllByLabelText("Year", { selector: "input" });
    expect(years).toHaveLength(2);

    // Pick December of some year: the default end follows into the NEXT year (May), and
    // pulling the end year back to the start year leaves only December pickable.
    fireEvent.click(screen.getByLabelText("First month", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "December" }));
    const startYear = (years[0] as HTMLInputElement).value;
    expect(screen.getByLabelText("Last month", { selector: "input" })).toHaveValue("May");
    expect(years[1]).toHaveValue(String(Number(startYear) + 1));

    fireEvent.click(years[1]);
    fireEvent.click(await screen.findByRole("option", { name: startYear }));
    fireEvent.click(screen.getByLabelText("Last month", { selector: "input" }));
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["December"]);

    // Committing posts the composed ISO months.
    await userEvent.click(screen.getByRole("button", { name: "Add period" }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        startMonth: `${startYear}-12`,
        endMonth: `${startYear}-12`,
      });
    });
  });

  test("deleting the latest period confirms first; a 409 maps to the referenced message", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return Promise.resolve(
          jsonResponse(409, { type: "about:blank", title: "Conflict", status: 409 }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: PERIODS }));
    });
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /^Delete the period/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText("Only the latest period without any reviews can be deleted."),
    ).toBeInTheDocument();
  });

  test("a disabled PERFORMANCE_REVIEWS feature redirects the page to / (v1.53.0)", async () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["PERFORMANCE_REVIEWS"]));
    try {
      setupMocks();
      renderPage();

      expect(await screen.findByText("HOME")).toBeInTheDocument();
      expect(screen.queryByText("July 2025 – December 2025")).toBeNull();
      expect(screen.queryByRole("button", { name: "Add period" })).toBeNull();
    } finally {
      localStorage.removeItem("lettuce.auth.disabledFeatures");
    }
  });
});
