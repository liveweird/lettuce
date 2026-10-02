import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { userActivityLink } from "./activityLinks";

describe("userActivityLink", () => {
  beforeEach(() => localStorage.setItem("lettuce.auth.userId", "7"));
  afterEach(() => localStorage.clear());

  test("addresses another person's log with its origin, team, audit flag and return target", () => {
    expect(userActivityLink(9, "Riley Report", "subordinates")).toBe("/users/9/activity?name=Riley%20Report&from=subordinates");
    expect(userActivityLink(9, "Riley", "team", 4, true, { back: "/teams/4/details", manages: true })).toBe(
      "/users/9/activity?name=Riley&from=team&teamId=4&mode=audit&back=%2Fteams%2F4%2Fdetails&manages=1",
    );
  });

  test("the signed-in person's own id routes to the nav page", () => {
    expect(userActivityLink(7, "Me", "details", undefined, true)).toBe("/activity");
  });
});
