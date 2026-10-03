import { afterEach, describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
// A Vite `?raw` import rather than node:fs, so the app tsconfig never needs Node types.
import specText from "../../../server/src/main/resources/openapi/documentation.yaml?raw";
import i18n from "../i18n";
import { REQUIRED_KEYS, SHARE_FEATURE, SHARE_TYPES, documentLabel, shareKindContext, shareOpenPath } from "./shareKinds";

const tFor = (lang: "en" | "pl") => i18n.getFixedT(lang) as unknown as TFunction;

describe("shareKinds — the days-off calendar kind (v4.11.0)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("it is the eighth kind (right before the pulse kind), gated by DAYS_OFF", () => {
    expect(SHARE_TYPES).toHaveLength(9);
    expect(SHARE_TYPES.at(-2)).toBe("DAYS_OFF_CALENDAR");
    expect(SHARE_FEATURE.DAYS_OFF_CALENDAR).toBe("DAYS_OFF");
  });

  test("its label names the person from the snapshot, EN and PL; a missing person reads unavailable", () => {
    expect(documentLabel("DAYS_OFF_CALENDAR", { person: "Pat Person" }, tFor("en"), "en")).toBe(
      "Days-off calendar of Pat Person",
    );
    expect(documentLabel("DAYS_OFF_CALENDAR", { person: "Pat Person" }, tFor("pl"), "pl")).toBe(
      "Kalendarz dni wolnych osoby Pat Person",
    );
    expect(documentLabel("DAYS_OFF_CALENDAR", {}, tFor("en"), "en")).toBe("No longer available");
    expect(documentLabel("DAYS_OFF_CALENDAR", null, tFor("en"), "en")).toBe("No longer available");
  });

  test("only the calendar and the pulse results word the dialog for themselves", () => {
    expect(shareKindContext("DAYS_OFF_CALENDAR")).toBe("calendar");
    expect(shareKindContext("PULSE_TEAM_RESULTS")).toBe("pulse");
    for (const type of SHARE_TYPES.filter((type) => type !== "DAYS_OFF_CALENDAR" && type !== "PULSE_TEAM_RESULTS")) {
      expect(shareKindContext(type), type).toBeUndefined();
    }
  });
});

describe("shareKinds — the pulse team results kind (v4.12.0)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("it is the ninth kind, last in the filter order, gated by PULSE_SURVEYS", () => {
    expect(SHARE_TYPES).toHaveLength(9);
    expect(SHARE_TYPES.at(-1)).toBe("PULSE_TEAM_RESULTS");
    expect(SHARE_FEATURE.PULSE_TEAM_RESULTS).toBe("PULSE_SURVEYS");
  });

  test("its label names the team from the snapshot, EN and PL; a missing team reads unavailable", () => {
    expect(documentLabel("PULSE_TEAM_RESULTS", { team: "AAA" }, tFor("en"), "en")).toBe("Pulse survey results of AAA");
    expect(documentLabel("PULSE_TEAM_RESULTS", { team: "AAA" }, tFor("pl"), "pl")).toBe(
      "Wyniki ankiety pulsu zespołu AAA",
    );
    expect(documentLabel("PULSE_TEAM_RESULTS", {}, tFor("en"), "en")).toBe("No longer available");
    expect(documentLabel("PULSE_TEAM_RESULTS", null, tFor("en"), "en")).toBe("No longer available");
  });
});

describe("shareOpenPath — a pulse results share (v4.12.0)", () => {
  const SHAREE_LINK = "/pulse?tab=results&view=shared&team=5";
  const pulse = { resourceType: "PULSE_TEAM_RESULTS" as const, resourceId: 5, link: SHAREE_LINK, details: { team: "AAA" }, shareeId: 30 };

  test("the sharee opens the server's link (their 'Shared with me' results view, the team marked)", () => {
    expect(shareOpenPath(pulse, 30)).toBe(SHAREE_LINK);
  });

  test("a sharer / the team's manager / an activity-log owner (not the sharee) opens the Results tab with the team marked", () => {
    expect(shareOpenPath(pulse, 7)).toBe("/pulse?tab=results&team=5");
    expect(shareOpenPath(pulse, null)).toBe("/pulse?tab=results&team=5");
    // An activity row never names the sharee: any viewer is a non-sharee.
    const row = { resourceType: pulse.resourceType, resourceId: pulse.resourceId, link: pulse.link, details: pulse.details };
    expect(shareOpenPath(row, 7)).toBe("/pulse?tab=results&team=5");
  });
});

describe("shareOpenPath — the Open target per viewer (D7)", () => {
  const SHAREE_LINK = "/days-off?tab=calendar&scope=shared&user=21";
  const calendar = { resourceType: "DAYS_OFF_CALENDAR" as const, resourceId: 21, link: SHAREE_LINK, details: { person: "Pat Person" }, shareeId: 30 };

  test("the sharee opens the server's link (their own 'Shared with me' scope, the person highlighted)", () => {
    expect(shareOpenPath(calendar, 30)).toBe(SHAREE_LINK);
  });

  test("a sharer / author / HR viewer (not the sharee) is sent to the person's details page", () => {
    expect(shareOpenPath(calendar, 7)).toBe("/users/21/details?name=Pat+Person");
    expect(shareOpenPath({ ...calendar, details: null }, 7)).toBe("/users/21/details");
  });

  test("the person's own calendar opens the Calendar tab of their own days off", () => {
    expect(shareOpenPath(calendar, 21)).toBe("/days-off?tab=calendar");
  });

  test("an activity row (no sharee id) always takes the non-sharee branch", () => {
    const row = { resourceType: calendar.resourceType, resourceId: calendar.resourceId, link: calendar.link, details: calendar.details };
    expect(shareOpenPath(row, 7)).toBe("/users/21/details?name=Pat+Person");
    expect(shareOpenPath(row, 21)).toBe("/days-off?tab=calendar");
  });

  test("every other kind keeps the server link for everyone", () => {
    for (const viewer of [30, 7, 21]) {
      expect(
        shareOpenPath({ resourceType: "GOAL", resourceId: 21, link: "/goals/21/view", shareeId: 30 }, viewer),
      ).toBe("/goals/21/view");
    }
    expect(shareOpenPath({ resourceType: "SUCCESSION_PLAN", resourceId: 3, link: "/succession/3/review" }, null)).toBe(
      "/succession/3/review",
    );
  });
});

describe("REQUIRED_KEYS vs the OpenAPI contract (checkup #38 S6)", () => {
  // The `details` description of ShareResponse is the shared oracle: the server pins the same text
  // against its snapshot builders, this pins the client's label requirements against it.
  const keysByType = (): Map<string, string[]> => {
    // Whitespace-collapsed, so re-wrapping or re-indenting the YAML description cannot break it.
    const flat = specText.slice(specText.indexOf("    ShareResponse:")).replaceAll(/\s+/g, " ");
    const marker = flat.indexOf("Keys per `resourceType`:");
    expect(marker).toBeGreaterThanOrEqual(0);
    // "Keys per `resourceType`: FEEDBACK `{provider,subjects}`; …; PULSE_TEAM_RESULTS `{team}`."
    const block = flat.slice(marker, flat.indexOf("}`.", marker) + 3);
    const found = new Map<string, string[]>();
    for (const m of block.matchAll(/\b([A-Z][A-Z_]*) `\{([A-Za-z,]+)\}`/g)) {
      found.set(m[1], m[2].split(",").sort());
    }
    return found;
  };

  test("every share type's required keys equal the spec's per-type key list", () => {
    const documented = keysByType();
    expect([...documented.keys()].sort()).toEqual([...SHARE_TYPES].sort());
    for (const type of SHARE_TYPES) {
      expect([...REQUIRED_KEYS[type]].sort(), type).toEqual(documented.get(type));
    }
  });
});
