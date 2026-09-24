import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
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

const MULTI_TEAM_STATUS = {
  teams: [
    STATUS.teams[0],
    {
      teamId: 22,
      teamName: "BBB",
      members: [{ userId: 4, name: "BBB One", responded: false }],
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

  test("the hint speaks org-wide for an HR auditor, of one's reports for a manager (v3.24.0)", async () => {
    setupMocks();
    renderWithProviders(<PulseParticipation />);
    expect(
      await screen.findByText("Who of your reports has submitted the survey — never their answers."),
    ).toBeInTheDocument();

    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    setupMocks();
    renderWithProviders(<PulseParticipation />);
    expect(
      await screen.findByText("Who has submitted the survey across the whole organization — never their answers."),
    ).toBeInTheDocument();
  });

  test("a non-manager gets the no-teams empty state", async () => {
    setupMocks({ status: { teams: [] } });
    renderWithProviders(<PulseParticipation />);
    expect(await screen.findByText("You don't monitor any teams.")).toBeInTheDocument();
  });

  test("the team picker is hidden with only one team", async () => {
    setupMocks();
    renderWithProviders(<PulseParticipation />);
    await screen.findByText("AAA One");
    expect(screen.queryByLabelText("Team", { selector: "input" })).toBeNull();
  });

  test("the team picker filters the list and recomputes the summary + progress (v4.3.0)", async () => {
    setupMocks({ status: MULTI_TEAM_STATUS });
    renderWithProviders(<PulseParticipation />);
    await screen.findByText("AAA One");
    expect(screen.getByText("BBB One")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 submitted (50%)")).toBeInTheDocument();

    const picker = screen.getByLabelText("Team", { selector: "input" });
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "BBB" }));

    expect(screen.queryByText("AAA One")).toBeNull();
    expect(screen.getByText("BBB One")).toBeInTheDocument();
    expect(screen.getByText("0 of 1 submitted (0%)")).toBeInTheDocument();

    // "All teams" restores the full roster.
    fireEvent.click(picker);
    fireEvent.click(await screen.findByRole("option", { name: "All teams" }));
    expect(await screen.findByText("AAA One")).toBeInTheDocument();
    expect(screen.getByText("BBB One")).toBeInTheDocument();
  });

  test("switching cycles resets a picked team back to All teams (v4.3.0)", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/cycles/6/participation-status")) {
        return Promise.resolve(jsonResponse(200, MULTI_TEAM_STATUS));
      }
      if (u.includes("/cycles/5/participation-status")) {
        return Promise.resolve(jsonResponse(200, MULTI_TEAM_STATUS));
      }
      if (u.includes("/pulse-surveys/cycles")) return Promise.resolve(jsonResponse(200, { items: CYCLES }));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    renderWithProviders(<PulseParticipation />);
    await screen.findByText("AAA One");

    const teamPicker = screen.getByLabelText("Team", { selector: "input" });
    fireEvent.click(teamPicker);
    fireEvent.click(await screen.findByRole("option", { name: "BBB" }));
    expect(screen.queryByText("AAA One")).toBeNull();
    expect(screen.getByText("BBB One")).toBeInTheDocument();

    // Switch to the other cycle — the team pick must not silently carry over.
    const cyclePicker = screen.getByLabelText("Cycle", { selector: "input" });
    fireEvent.click(cyclePicker);
    fireEvent.click(await screen.findByRole("option", { name: /Closed/ }));
    await screen.findByText("AAA One");
    expect(screen.getByLabelText("Team", { selector: "input" })).toHaveValue("All teams");
    expect(screen.getByText("BBB One")).toBeInTheDocument();
  });

  test("no monitorable cycle → the empty state", async () => {
    setupMocks({ cycles: [{ ...CYCLES[0], id: 9, status: "SCHEDULED" }] });
    renderWithProviders(<PulseParticipation />);
    expect(
      await screen.findByText("No open or closed cycle to monitor."),
    ).toBeInTheDocument();
  });
});
