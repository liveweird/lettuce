import { describe, expect, test } from "vitest";
import { activeLeaf, resolveNav } from "./navModel";

const allOpen = { isAdmin: true, isManager: true, hasFeature: () => true };

describe("resolveNav", () => {
  test("with every gate open: four sections, the admin Config leaves, and the footer pair", () => {
    const nav = resolveNav(allOpen, 7);
    expect(nav.sections.map((s) => s.id)).toEqual(["overview", "myWork", "team", "administration"]);
    const config = nav.sections[3].entries[0];
    expect("children" in config ? config.children.map((c) => c.to) : []).toEqual(
      expect.arrayContaining(["/users", "/pulse-cycles", "/feature-flags", "/integration-clients", "/alerts"]),
    );
    expect(nav.footer.map((l) => l.to)).toEqual(["/users/7/change-password", "/changelog"]);
    expect(nav.leafTos).toEqual(expect.arrayContaining(["/", "/succession", "/changelog", "/users/7/change-password"]));
  });

  test("a non-manager loses Succession, a non-admin the admin Config leaves, a disabled feature its leaves", () => {
    const nav = resolveNav({ isAdmin: false, isManager: false, hasFeature: (f) => f !== "FEEDBACKS" }, null);
    expect(nav.leafTos).not.toContain("/succession");
    expect(nav.leafTos).not.toContain("/alerts");
    expect(nav.leafTos).not.toContain("/feedback");
    expect(nav.leafTos).not.toContain("/kudos");
    const overview = nav.sections.find((s) => s.id === "overview");
    expect(overview?.entries.map((e) => ("to" in e ? e.to : e.label))).toEqual(["/"]);
    // No signed-in user id → no account leaf, the Changelog stays.
    expect(nav.footer.map((l) => l.to)).toEqual(["/changelog"]);
  });

  test("a section left without a visible entry disappears", () => {
    const teamFeatures = new Set(["TEAM_KPIS", "PERFORMANCE_REVIEWS", "PULSE_SURVEYS", "SUCCESSION_PLANS"]);
    const nav = resolveNav({ isAdmin: false, isManager: false, hasFeature: (f) => !teamFeatures.has(f) }, 1);
    expect(nav.sections.map((s) => s.id)).toEqual(["overview", "myWork", "administration"]);
  });
});

describe("activeLeaf", () => {
  test("the longest matching path wins and the dashboard only matches exactly", () => {
    const tos = ["/", "/users", "/users/7/change-password", "/changelog"];
    expect(activeLeaf(tos, "/")).toBe("/");
    expect(activeLeaf(tos, "/users/7/change-password")).toBe("/users/7/change-password");
    expect(activeLeaf(tos, "/users/7/edit")).toBe("/users");
    expect(activeLeaf(tos, "/teams")).toBeNull();
  });
});
