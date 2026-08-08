import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import PulseParticipation from "./PulseParticipation";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const CYCLES = [
  {
    id: 6,
    status: "OPEN",
    plannedOpenDate: "2026-08-01",
    plannedCloseDate: "2026-08-08",
    createdAt: 0,
    lastModified: 0,
  },
  {
    id: 5,
    status: "CLOSED",
    plannedOpenDate: "2026-07-01",
    plannedCloseDate: "2026-07-08",
    closedAt: 500,
    createdAt: 0,
    lastModified: 0,
  },
];

const STATUS = {
  teams: [
    {
      teamId: 11,
      teamName: "AAA",
      members: [
        { userId: 1, name: "AAA One", responded: true },
        { userId: 2, name: "AAA Two", responded: false },
        { userId: 3, name: "AAA Three", responded: true },
      ],
    },
  ],
};

describe("PulseParticipation", () => {
  let mockFetch: FetchMock;

  function setupMocks({ status = STATUS as unknown, cycles = CYCLES as unknown[] } = {}) {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/participation-status")) return Promise.resolve(jsonResponse(200, status));
      if (u.includes("/pulse-surveys/cycles")) return Promise.resolve(jsonResponse(200, { items: cycles }));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("defaults to the OPEN cycle and shows the yes/no rows + summary", async () => {
    setupMocks();
    renderWithProviders(<PulseParticipation />);
    expect(await screen.findByText("AAA One")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 submitted (66.7%)")).toBeInTheDocument();
    expect(screen.getAllByText("Submitted")).toHaveLength(2);
    expect(screen.getAllByText("Not yet")).toHaveLength(1);
    // The default pick is the OPEN cycle — live monitoring is the point.
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/cycles/6/participation-status"))).toBe(true);
  });

  test("a non-manager gets the no-teams empty state", async () => {
    setupMocks({ status: { teams: [] } });
    renderWithProviders(<PulseParticipation />);
    expect(await screen.findByText("You don't monitor any teams.")).toBeInTheDocument();
  });

  test("no monitorable cycle → the empty state", async () => {
    setupMocks({ cycles: [{ ...CYCLES[0], id: 9, status: "SCHEDULED" }] });
    renderWithProviders(<PulseParticipation />);
    expect(
      await screen.findByText("No open or closed cycle to monitor."),
    ).toBeInTheDocument();
  });
});
