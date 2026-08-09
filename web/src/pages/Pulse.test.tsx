import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import Pulse from "./Pulse";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

describe("Pulse hub", () => {
  let mockFetch: FetchMock;

  function renderHub(route = "/pulse") {
    return renderWithProviders(
      <Routes>
        <Route path="/pulse" element={<Pulse />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>,
      { route },
    );
  }

  function setupMocks({ managedTotal = 0 } = {}) {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes("/api/v1/teams?")) {
        return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 1, total: managedTotal }));
      }
      if (String(url).includes("/pulse-surveys/cycles")) {
        return Promise.resolve(jsonResponse(200, { items: [] }));
      }
      if (String(url).includes("/visible-teams")) {
        return Promise.resolve(jsonResponse(200, { resultsTeams: [], monitoredTeams: [] }));
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a disabled PULSE_SURVEYS flag redirects the whole page home", () => {
    localStorage.setItem("lettuce.auth.disabledFeatures", JSON.stringify(["PULSE_SURVEYS"]));
    setupMocks();
    renderHub();
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  test("the survey and results tabs render for everyone; participation stays manager/HR-only", async () => {
    setupMocks();
    renderHub();
    expect(await screen.findByRole("tab", { name: "Current survey" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Results" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Participation" })).toBeNull();
    // The tabs carry the data-tour anchors the guided tour targets for its subsection steps.
    expect(screen.getByRole("tab", { name: "Current survey" })).toHaveAttribute(
      "data-tour",
      "pulse-survey",
    );
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("data-tour", "pulse-results");
  });

  test("a manager gets the participation tab and ?tab= picks it", async () => {
    setupMocks({ managedTotal: 1 });
    renderHub("/pulse?tab=participation");
    expect(await screen.findByRole("tab", { name: "Participation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Participation" })).toHaveAttribute("aria-selected", "true");
  });

  test("HR gets the participation tab without managing anything", async () => {
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["HR"]));
    setupMocks();
    renderHub();
    expect(await screen.findByRole("tab", { name: "Participation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Participation" })).toHaveAttribute(
      "data-tour",
      "pulse-participation",
    );
  });

  test("?tab=results selects the results tab", async () => {
    setupMocks();
    renderHub("/pulse?tab=results");
    expect(await screen.findByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
  });
});
