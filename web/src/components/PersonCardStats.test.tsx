import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import type { PersonCard } from "../utils/teamRows";
import PersonCardBody, { type PersonCardStatsVariant } from "./PersonCardStats";

const PERSON: PersonCard = {
  userId: 11,
  name: "Bob Brown",
  email: "bob@x.test",
  deactivated: false,
  teams: [],
  teamNames: [],
  lastOneOnOneDate: "2026-07-01",
  lastOneOnOneOpenItems: 2,
  lastFeedbackAt: null,
  lastFeedbackGivenAt: null,
  lastFeedbackReceivedAt: null,
  activeGoalCount: null,
  lastReviewId: null,
  lastReviewPeriodStartMonth: null,
  lastReviewPeriodEndMonth: null,
  lastReviewStatus: null,
  careerPath: null,
  careerSpecialization: null,
  seniorityLevel: null,
  nextVacationStart: null,
  daysOffRemaining: null,
  lastLoginAt: null,
};

function renderBody(stats: PersonCardStatsVariant, person: PersonCard = PERSON) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <MemoryRouter>
        <PersonCardBody person={person} stats={stats} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("PersonCardBody open-items badge (v4.19.0)", () => {
  beforeEach(() => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", "[]");
    localStorage.setItem("lettuce.auth.userId", "7");
  });
  afterEach(() => localStorage.clear());

  test("a direct report's (subordinate) card links the badge to the Open action items tab filtered to them", () => {
    renderBody("subordinate");
    const link = screen.getByRole("link", { name: "2 open items — action items with Bob Brown" });
    expect(link).toHaveAttribute("href", "/one-on-ones?tab=action-items&subordinateId=11");
    // The visible badge text is the unchanged "N open items".
    expect(link).toHaveTextContent("2 open items");
  });

  test("a zero count still links (the tab then shows its empty state)", () => {
    renderBody("subordinate", { ...PERSON, lastOneOnOneOpenItems: 0 });
    expect(screen.getByRole("link", { name: "0 open items — action items with Bob Brown" })).toBeInTheDocument();
  });

  test("a deactivated report's badge stays plain text (the list leaves deactivated reports out)", () => {
    renderBody("subordinate", { ...PERSON, deactivated: true });
    expect(screen.getByText("2 open items")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("a manager's (My managers) card keeps the badge as plain text — no link", () => {
    renderBody("manager");
    expect(screen.getByText("2 open items")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("peer and none variants carry no open-items badge at all", () => {
    renderBody("peer");
    expect(screen.queryByText(/open item/)).toBeNull();
    renderBody("none");
    expect(screen.queryByText(/open item/)).toBeNull();
  });
});
