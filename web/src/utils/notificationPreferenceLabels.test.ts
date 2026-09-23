import { describe, expect, it } from "vitest";
// Vite imports rather than node:fs, so the app tsconfig never needs Node types (the
// locales/parity.test.ts idiom). The spec sits outside web/, which vite.config.ts admits
// for Vitest runs only (`server.fs.allow`).
import specText from "../../../server/src/main/resources/openapi/documentation.yaml?raw";
import rawEn from "../locales/en/notifications.json";
import rawPl from "../locales/pl/notifications.json";
import i18n from "../i18n";
import { PREFERENCE_LABEL_KEY } from "./notificationPreferenceLabels";

/**
 * Line-scans the `NotificationType` `enum:` block straight out of the OpenAPI spec text — no
 * yaml dependency to add. Deliberately dumb: it finds the `    NotificationType:` schema line,
 * then the next `enum:` line, then collects every following `- VALUE` line, stopping at the
 * first line that isn't one (the `description:` that always follows the enum).
 */
function specNotificationTypeValues(): string[] {
  const lines = specText.split("\n");
  const typeLineIndex = lines.findIndex((line) => line === "    NotificationType:");
  if (typeLineIndex === -1) {
    throw new Error("NotificationType schema not found in documentation.yaml — spec layout changed?");
  }
  const enumLineIndex = lines.findIndex((line, i) => i > typeLineIndex && line.trim() === "enum:");
  if (enumLineIndex === -1) {
    throw new Error("NotificationType enum: block not found in documentation.yaml — spec layout changed?");
  }
  const values: string[] = [];
  for (let i = enumLineIndex + 1; i < lines.length; i++) {
    const match = /^\s+- (.+)$/.exec(lines[i]);
    if (!match) break;
    values.push(match[1].trim());
  }
  return values;
}

/** Walks a dotted i18next key (e.g. `"notifications.preference.FOO"`) into a raw JSON object. */
function resolveDottedPath(root: unknown, dottedPath: string): unknown {
  return dottedPath.split(".").reduce<unknown>((node, segment) => {
    if (node !== null && typeof node === "object" && segment in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}

describe("notification preference labels", () => {
  it("covers exactly the spec's NotificationType enum — no more, no less", () => {
    const specTypes = specNotificationTypeValues();
    // A vacuous pass (an empty scan matching an empty PREFERENCE_LABEL_KEY) would defeat the
    // point of this test entirely — assert the scan actually found something.
    expect(specTypes.length).toBeGreaterThan(0);
    expect(new Set(Object.keys(PREFERENCE_LABEL_KEY))).toEqual(new Set(specTypes));
  });

  it("resolves every key to a non-empty, real translation in both EN and PL, with no i18n fallback", () => {
    for (const [type, key] of Object.entries(PREFERENCE_LABEL_KEY)) {
      // notifications.json IS the "notifications" i18next area — strip that namespace prefix and
      // walk the rest of the dotted key straight into the raw parsed JSON, so this doesn't assume
      // "preference" is the only level (and doesn't go through i18next's EN-fallback, which is
      // exactly what let a missing PL string slip through before this test existed).
      const dottedPath = key.startsWith("notifications.") ? key.slice("notifications.".length) : key;

      const enValue = resolveDottedPath(rawEn, dottedPath);
      expect(typeof enValue, `${type} -> en:${dottedPath}`).toBe("string");
      expect((enValue as string).trim().length, `${type} -> en:${dottedPath}`).toBeGreaterThan(0);

      const plValue = resolveDottedPath(rawPl, dottedPath);
      expect(typeof plValue, `${type} -> pl:${dottedPath}`).toBe("string");
      expect((plValue as string).trim().length, `${type} -> pl:${dottedPath}`).toBeGreaterThan(0);
    }
  });

  it("resolves every NotificationType to a non-empty, real EN translation via i18next", () => {
    // Belt-and-braces on top of the raw-JSON check above: i18next returns the key verbatim when
    // nothing matches, so this also catches a PREFERENCE_LABEL_KEY typo the raw walk wouldn't
    // (a key that resolves in the raw JSON at the wrong path but not through i18next's actual
    // namespace merge).
    for (const [type, key] of Object.entries(PREFERENCE_LABEL_KEY)) {
      const label = i18n.t(key, { lng: "en" });
      expect(label, `${type} -> ${key}`).not.toBe(key);
      expect(label.trim().length, `${type} -> ${key}`).toBeGreaterThan(0);
    }
  });
});
