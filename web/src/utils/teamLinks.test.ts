import { describe, expect, test } from "vitest";
import { teamDetailsLink } from "./teamLinks";
import { teamKpisLink } from "./teamKpiLinks";
import { userDetailsLink } from "./userLinks";

describe("teamDetailsLink", () => {
  test("bare, from-only, back-only and both", () => {
    expect(teamDetailsLink(3)).toBe("/teams/3/details");
    expect(teamDetailsLink(3, { from: "org" })).toBe("/teams/3/details?from=org");
    expect(teamDetailsLink(3, { from: "myTeams" })).toBe("/teams/3/details?from=myTeams");
    expect(teamDetailsLink(3, { back: "/?tab=managers" })).toBe(
      "/teams/3/details?back=%2F%3Ftab%3Dmanagers",
    );
    expect(teamDetailsLink(3, { from: "org", back: "/org" })).toBe(
      "/teams/3/details?from=org&back=%2Forg",
    );
  });
});

describe("teamKpisLink", () => {
  test("bare, from-only and with an encoded nested back", () => {
    expect(teamKpisLink(3)).toBe("/teams/3/kpis");
    expect(teamKpisLink(3, { from: "team" })).toBe("/teams/3/kpis?from=team");
    expect(teamKpisLink(3, { from: "team", back: "/teams/3/details?from=myTeams" })).toBe(
      "/teams/3/kpis?from=team&back=%2Fteams%2F3%2Fdetails%3Ffrom%3DmyTeams",
    );
    expect(teamKpisLink(3, { back: "/?tab=myTeams" })).toBe("/teams/3/kpis?back=%2F%3Ftab%3DmyTeams");
  });
});

describe("userDetailsLink", () => {
  test("back rides after the other params and stays encoded", () => {
    expect(userDetailsLink(7, "Ann", "members", 3, { back: "/teams/3/details?from=org" })).toBe(
      "/users/7/details?name=Ann&from=members&teamId=3&back=%2Fteams%2F3%2Fdetails%3Ffrom%3Dorg",
    );
    expect(userDetailsLink(7, null, undefined, undefined, { back: "/feedback?tab=received" })).toBe(
      "/users/7/details?back=%2Ffeedback%3Ftab%3Dreceived",
    );
    expect(userDetailsLink(7, "Ann")).toBe("/users/7/details?name=Ann");
  });
});
