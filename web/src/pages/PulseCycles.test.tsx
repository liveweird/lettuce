import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import PulseCycles from "./PulseCycles";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const SETTINGS = { cadenceWeeks: 4, openDays: 7 };

const CYCLES = [
  {
    id: 6,
    status: "SCHEDULED",
    plannedOpenDate: "2026-09-01",
    plannedCloseDate: "2026-09-08",
    rotatingQuestion: { en: "Good work is recognized here.", pl: "Dobra praca jest tu doceniana." },
    participantCount: 0,
    responseCount: 0,
    createdAt: 0,
    lastModified: 0,
  },
  {
    id: 5,
    status: "CLOSED",
    plannedOpenDate: "2026-07-01",
    plannedCloseDate: "2026-07-08",
    rotatingQuestion: { en: "I feel that I belong on my team.", pl: "Czuję, że jestem częścią swojego zespołu." },
    participantCount: 10,
    responseCount: 7,
    closedAt: 500,
    createdAt: 0,
    lastModified: 0,
  },
];

describe("PulseCycles (admin)", () => {
  let mockFetch: FetchMock;

  function renderPage() {
    return renderWithProviders(
      <Routes>
        <Route path="/pulse-cycles" element={<PulseCycles />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>,
      { route: "/pulse-cycles" },
    );
  }

  function setupMocks({ cycles = CYCLES as unknown[] } = {}) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/pulse-surveys/settings")) {
        return Promise.resolve(method === "PUT" ? new Response(null, { status: 204 }) : jsonResponse(200, SETTINGS));
      }
      if (/\/cycles\/\d+\/(open|close|cancel)$/.test(u)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (/\/cycles\/\d+$/.test(u) && method === "PUT") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.includes("/pulse-surveys/cycles") && method === "POST") {
        return Promise.resolve(jsonResponse(201, { ...CYCLES[0], id: 7 }));
      }
      if (u.includes("/pulse-surveys/cycles")) {
        return Promise.resolve(jsonResponse(200, { items: cycles }));
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test("non-admins are redirected home", () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify([]));
    setupMocks();
    renderPage();
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  test("settings load into the editor and save with a toast", async () => {
    setupMocks();
    const toast = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByDisplayValue("4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
    // The heading carries the data-tour anchor for the (admin-only) Config → Pulse cycles step.
    expect(screen.getByRole("heading", { name: "Pulse cycles" })).toHaveAttribute(
      "data-tour",
      "config-pulse-cycles",
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([url, init]) => String(url).includes("/settings") && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeTruthy();
    });
    expect(toast).toHaveBeenCalled();
  });

  test("the schedule form prefills from the latest cycle + cadence, close follows open", async () => {
    setupMocks();
    renderPage();
    // Latest non-cancelled cycle opens 2026-09-01; +4 weeks = 2026-09-29; close +7 days.
    // DateInput mirrors its value into a hidden input, so query by label, not display value.
    await waitFor(() => expect(screen.getByLabelText("Open date")).toHaveValue("2026-09-29"));
    expect(screen.getByLabelText("Close date")).toHaveValue("2026-10-06");
  });

  test("scheduling POSTs the dates and toasts", async () => {
    setupMocks();
    const toast = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByLabelText("Open date")).toHaveValue("2026-09-29"));
    await user.click(screen.getByRole("button", { name: "Schedule cycle" }));
    await waitFor(() => {
      const post = mockFetch.mock.calls.find(
        ([url, init]) =>
          /\/pulse-surveys\/cycles$/.test(String(url)) && (init as RequestInit)?.method === "POST",
      );
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        plannedOpenDate: "2026-09-29",
        plannedCloseDate: "2026-10-06",
      });
    });
    expect(toast).toHaveBeenCalled();
  });

  test("the cycle table shows status, question, and counts; lifecycle actions confirm first", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("Good work is recognized here.")).toBeInTheDocument();
    expect(screen.getByText("7/10")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open cycle 6" }));
    expect(
      await screen.findByText(/Open the cycle now\? Every eligible user will be notified/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open now" }));
    await waitFor(() => {
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/cycles/6/open"))).toBe(true);
    });
  });

  test("cancel goes through the audit-honest confirmation copy", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Good work is recognized here.")
    await user.click(screen.getByRole("button", { name: "Cancel cycle 5" }));
    expect(
      await screen.findByText(/Results will not be available\. Submitted answers are kept for audit\./),
    ).toBeInTheDocument();
  });

  test("edit dates opens the modal seeded with the cycle's dates and PUTs the change", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Good work is recognized here.");
    await user.click(screen.getByRole("button", { name: "More actions for cycle 6" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit dates of cycle 6" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Open date")).toHaveValue("2026-09-01"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([url, init]) => /\/cycles\/6$/.test(String(url)) && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeTruthy();
    });
  });

  test("a failed settings load is flagged instead of silently showing defaults", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/pulse-surveys/settings")) return Promise.resolve(jsonResponse(500, { status: 500 }));
      if (u.includes("/pulse-surveys/cycles")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    renderPage();

    expect(
      await screen.findByText(
        "The current settings could not be loaded — the values below are the defaults, not what is stored.",
      ),
    ).toBeInTheDocument();
  });
});
