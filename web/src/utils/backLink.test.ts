import { describe, expect, test } from "vitest";
import { backLabelKey, resolveBackLink } from "./backLink";
import { navLeafLabel } from "../appShell/navModel";

describe("backLabelKey", () => {
  test.each([
    ["/?tab=managers", "dashboard.tabs.managers"],
    ["/?tab=peers", "dashboard.tabs.peers"],
    ["/?tab=subordinates", "dashboard.tabs.subordinates"],
    ["/?tab=myTeams", "dashboard.tabs.myTeams"],
    ["/?tab=unknown", "appShell.nav.dashboard"],
    ["/", "appShell.nav.dashboard"],
    ["/users/7/details?name=A", "feedback.origin.details"],
    ["/teams/3/details?from=org", "teams.detailsTitle"],
    ["/feedback?tab=received", "appShell.nav.feedback"],
    ["/goals?tab=own#x", "appShell.nav.goals"],
    ["/users", "appShell.nav.users"],
    ["/org", "appShell.nav.orgChart"],
    ["/dictionaries/career-paths", "appShell.nav.careerPaths"],
    ["/feedback/5/view", "feedback.origin.previous"],
    ["/users/7/feedbacks", "feedback.origin.previous"],
    ["/teams/3/details/extra", "feedback.origin.previous"],
    ["//evil.example", "feedback.origin.previous"],
    ["/\\evil.example", "feedback.origin.previous"],
    ["https://evil.example", "feedback.origin.previous"],
  ])("%s -> %s", (path, key) => {
    expect(backLabelKey(path)).toBe(key);
  });
});

describe("navLeafLabel", () => {
  test("exact match only, group children included", () => {
    expect(navLeafLabel("/org")).toBe("appShell.nav.orgChart");
    expect(navLeafLabel("/dictionaries/seniority-levels")).toBe("appShell.nav.seniorityLevels");
    expect(navLeafLabel("/changelog")).toBe("appShell.nav.changelog");
    expect(navLeafLabel("/feedback/new")).toBeNull();
    expect(navLeafLabel("/nope")).toBeNull();
  });
});

describe("resolveBackLink", () => {
  test("the override wins the destination, the from label keeps naming it", () => {
    expect(
      resolveBackLink({ fromLabelKey: "feedback.origin.members", backOverride: "/x", defaultTo: "/d" }),
    ).toEqual({ to: "/x", labelKey: "feedback.origin.members" });
  });

  test("a back-only visit is labelled after the override", () => {
    expect(resolveBackLink({ backOverride: "/feedback?tab=received", defaultTo: "/users" })).toEqual({
      to: "/feedback?tab=received",
      labelKey: "appShell.nav.feedback",
    });
  });

  test("no override: the from label and the default destination", () => {
    expect(
      resolveBackLink({ fromLabelKey: "feedback.origin.org", backOverride: null, defaultTo: "/org" }),
    ).toEqual({ to: "/org", labelKey: "feedback.origin.org" });
    expect(resolveBackLink({ backOverride: null, defaultTo: "/users" }).labelKey).toBe("appShell.nav.users");
  });
});
