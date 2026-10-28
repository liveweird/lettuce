import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import i18n from "../i18n";
import { formatBytes } from "./telemetryFormat";
import { databaseGroupName, databaseTableName, usageOf } from "./telemetryNames";

const t = i18n.t.bind(i18n) as TFunction;

describe("telemetryNames", () => {
  test("known groups and tables read in words, an unknown name reads as itself", () => {
    expect(databaseGroupName("days_off", t)).toBe("Days off");
    expect(databaseGroupName("future_group", t)).toBe("future_group");
    expect(databaseTableName("one_on_one_meetings", t)).toBe("1:1 meetings");
    expect(databaseTableName("future_table", t)).toBe("future_table");
  });

  test("a bounded figure reads 'n of N', and an unmeasured one is the bare dash", () => {
    expect(usageOf(t, 3, 20)).toBe("3 of 20");
    expect(usageOf(t, 8 * 1024 * 1024, 64 * 1024 * 1024, formatBytes)).toBe("8 MB of 64 MB");
    expect(usageOf(t, null, 20)).toBe("—");
  });
});
