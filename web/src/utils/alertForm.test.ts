import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import { alertFormValidation, emptyAlertFormValues, toAlertBody } from "./alertForm";

const t = ((key: string) => key) as unknown as TFunction;

describe("alertForm", () => {
  test("a checked bound whose input is still incomplete fails validation instead of reaching the body as null (v3.5.2)", () => {
    // DateTimeField emits "" until BOTH halves are complete — a date with no time is "".
    const values = { ...emptyAlertFormValues(), title: "T", content: "C", startsAtSet: true, startsAt: "" };
    const rules = alertFormValidation(t);
    expect(rules.startsAt(values.startsAt, values)).toBe("alerts.boundRequired");
    expect(rules.endsAt("", { ...values, endsAtSet: true })).toBe("alerts.boundRequired");
    // Only an unchecked bound is a deliberate null; the checked-but-incomplete one never gets
    // this far (the form refuses to submit), so the body keeps a real epoch for a real value.
    expect(toAlertBody({ ...values, startsAtSet: false }).startsAt).toBeNull();
    expect(toAlertBody({ ...values, startsAt: "2026-07-01T08:00" }).startsAt).toBe(
      new Date("2026-07-01T08:00").getTime(),
    );
  });

  test("a complete pair validates and an inverted window is rejected", () => {
    const rules = alertFormValidation(t);
    const values = {
      ...emptyAlertFormValues(),
      startsAtSet: true,
      startsAt: "2026-07-02T08:00",
      endsAtSet: true,
      endsAt: "2026-07-01T08:00",
    };
    expect(rules.startsAt(values.startsAt, values)).toBeNull();
    expect(rules.endsAt(values.endsAt, values)).toBe("alerts.windowInvalid");
    expect(rules.endsAt("2026-07-03T08:00", values)).toBeNull();
  });
});
