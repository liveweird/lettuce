import { test, expect, login, logout, uniqueText, switchLanguage, ADMIN } from "./helpers";
import { apiToken, authHeader } from "./api";
import type { Page } from "@playwright/test";

// The global dictionaries share one page (`/dictionaries/:slug`): admins edit the whole
// ordered list in place and save it atomically; everyone else gets the read-only numbered view.
// Since v2.20.0 entries carry a language->value map — each row has one input per supported
// language (aria `Entry N (English)` / `Entry N (Polish)`), ENGLISH required, the rest
// optional (a blank input means "no translation"; display falls back to English). The
// dictionary is a global document, so this spec only ever appends its own throwaway entries
// (unique E2E-* values) after whatever the volume already holds, and removes them at the end —
// pre-existing entries ride along in every save untouched.

// seniority-levels, not career-paths: user-career.spec exercises the career-paths document
// (since the v2.15.0 career split; its whole-list editor pattern removes entries BY INDEX), and
// under parallel workers each dictionary document needs exactly one writer file.
const SLUG = "seniority-levels";

async function saveDictionary(page: Page) {
  const save = page.getByRole("button", { name: "Save", exact: true });
  const isDictionaryCall = (r: { url(): string }) =>
    r.url().endsWith(`/api/v1/dictionaries/${SLUG}`);
  await Promise.all([
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "PUT" && r.ok()),
    // After the PUT the editor re-seeds itself from a follow-up GET (new rows gain their
    // server ids) and resets the dirty state — edits made before that lands are silently
    // reverted, so the next steps must not touch the form until the whole cycle is done.
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "GET" && r.ok()),
    save.click(),
  ]);
  // The GET resolving isn't quite the end: the values/dirty reset runs just after it. The
  // button leaving its loading state (data-loading gone) marks the cycle complete; it then
  // sits disabled because the form is pristine again. (Plain toBeDisabled() is not enough —
  // Mantine's loading state also disables the button, straight after the click.)
  await expect(save).not.toHaveAttribute("data-loading", /.*/);
  await expect(save).toBeDisabled();
}

/** Row counter: one English input per row (each row also has a Polish sibling). */
async function rowCount(page: Page): Promise<number> {
  return page.getByLabel(/^Entry \d+ \(English\)$/).count();
}

test("admin curates a dictionary; a regular user sees the read-only list", async ({ page }) => {
  const valueA = uniqueText("E2E-Level-A");
  const valueB = uniqueText("E2E-Level-B");
  const renamed = `${valueA}-renamed`;

  await login(page, ADMIN);
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByRole("heading", { name: "Seniority levels" })).toBeVisible();
  const addEntry = page.getByRole("button", { name: "Add entry", exact: true });
  await expect(addEntry).toBeVisible();

  // Append two entries after whatever is already there — A translated, B ENGLISH-ONLY
  // (the Polish input stays blank: only English is required since v2.20.0).
  const base = await rowCount(page);
  await addEntry.click();
  await page.getByLabel(`Entry ${base + 1} (English)`, { exact: true }).fill(valueA);
  await page.getByLabel(`Entry ${base + 1} (Polish)`, { exact: true }).fill(`${valueA}-pl`);
  await addEntry.click();
  await page.getByLabel(`Entry ${base + 2} (English)`, { exact: true }).fill(valueB);
  await saveDictionary(page);

  // The re-seeded editor shows both, in order, at the end of the list — B's Polish input
  // comes back empty (no translation stored, not a copied English).
  await expect(page.getByLabel(`Entry ${base + 1} (English)`, { exact: true })).toHaveValue(valueA);
  await expect(page.getByLabel(`Entry ${base + 2} (English)`, { exact: true })).toHaveValue(valueB);
  await expect(page.getByLabel(`Entry ${base + 2} (Polish)`, { exact: true })).toHaveValue("");

  // Reorder (B above A) and rename A's English in the same save (its Polish rides along).
  await page.getByRole("button", { name: `Move entry ${base + 2} up`, exact: true }).click();
  await page.getByLabel(`Entry ${base + 2} (English)`, { exact: true }).fill(renamed);
  await saveDictionary(page);
  await expect(page.getByLabel(`Entry ${base + 1} (English)`, { exact: true })).toHaveValue(valueB);
  await expect(page.getByLabel(`Entry ${base + 2} (English)`, { exact: true })).toHaveValue(renamed);
  await expect(page.getByLabel(`Entry ${base + 2} (Polish)`, { exact: true })).toHaveValue(`${valueA}-pl`);

  // A regular user sees the same values read-only: no inputs, no editor buttons. The viewer's
  // language leads (English under the EN test locale); other languages sit behind the entry's
  // language-count badge (a popover — v2.23.0), and the untranslated entry renders its
  // English exactly once with no badge at all (the fallback).
  // Sign out through the UI first — the login helper drives the real /login form, which an
  // authenticated session gets redirected away from.
  await logout(page);
  await login(page, "aaa-one@lettuce.local");
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByText(valueB, { exact: true })).toHaveCount(1);
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await expect(page.getByText(`${valueA}-pl`, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Languages of entry ${base + 2}`, exact: true }).click();
  await expect(page.getByText(`${valueA}-pl`, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `Languages of entry ${base + 1}`, exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toHaveCount(0);

  // Cleanup: the admin removes the two throwaway entries (positions shift after the first
  // removal, so the same label is clicked twice), leaving the volume as found.
  await logout(page);
  await login(page, ADMIN);
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByLabel(`Entry ${base + 1} (English)`, { exact: true })).toHaveValue(valueB);
  await page.getByRole("button", { name: `Remove entry ${base + 1}`, exact: true }).click();
  await page.getByRole("button", { name: `Remove entry ${base + 1}`, exact: true }).click();
  await saveDictionary(page);
  await expect(page.getByText(valueB, { exact: true })).toHaveCount(0);
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
});

test("all read-only dictionaries keep compact aligned rows on desktop and mobile", async ({ page, request }) => {
  test.setTimeout(120_000);
  const token = await apiToken(request, ADMIN);
  const headers = authHeader(token);
  const dictionaryUrl = `/api/v1/dictionaries/${SLUG}`;
  const originalResponse = await request.get(dictionaryUrl, { headers });
  expect(originalResponse.ok()).toBe(true);
  const original = await originalResponse.json() as { items: { id: number; values: Record<string, string> }[] };
  const stamp = uniqueText("e2e-dictionary-layout");
  const email = `${stamp}@lettuce.local`;
  const password = `${stamp}-password`;
  const longEnglish = uniqueText("E2ELongEnglish").padEnd(100, "W");
  const longPolish = uniqueText("E2EDlugaPolska").padEnd(100, "Z");
  let userId: number | undefined;
  try {
    const created = await request.post("/api/v1/users", {
      headers, data: { name: stamp, email, password },
    });
    expect(created.ok()).toBe(true);
    userId = ((await created.json()) as { id: number }).id;
    const saved = await request.put(dictionaryUrl, {
      headers,
      data: { items: [...original.items, { values: { en: longEnglish, pl: longPolish } }] },
    });
    expect(saved.ok()).toBe(true);
    await login(page, email, password);
    for (const language of ["English", "Polski"]) {
      await switchLanguage(page, language);
      for (const slug of ["career-paths", "career-specializations", "seniority-levels", "pulse-rotating-questions"]) {
        await page.goto(`/dictionaries/${slug}`);
        const table = page.getByRole("table");
        await expect(table).toBeVisible();
        await expect(table.getByRole("columnheader")).toHaveCount(3);
        await expect(page.getByRole("textbox")).toHaveCount(0);
        for (const width of [1440, 1280, 1024, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          // Overflow alone missed the 3.8.5 regression: the generic card layout fitted,
          // but separated the number/value/languages and made short rows ~180px tall.
          await expect.poll(() => table.evaluate((element) => {
            const row = element.querySelector("tbody tr")!;
            const cells = [...row.children].map((cell) => cell.getBoundingClientRect());
            const headers = [...element.querySelectorAll("thead th")].map((cell) => cell.getBoundingClientRect());
            return cells.length === 3 &&
              cells.every((cell) => Math.abs(cell.y - cells[0].y) <= 1) &&
              cells[0].right <= cells[1].left + 1 && cells[1].right <= cells[2].left + 1 &&
              headers.every((header) => header.width > 10 && header.height > 10) &&
              Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= innerWidth;
          })).toBe(true);
          if (width >= 1024) {
            const sizes = await table.evaluate((element) => {
              const row = element.querySelector("tbody tr")!;
              return { height: row.getBoundingClientRect().height,
                valueRatio: row.children[1].getBoundingClientRect().width / element.getBoundingClientRect().width };
            });
            expect(sizes.height).toBeLessThanOrEqual(64);
            expect(sizes.valueRatio).toBeGreaterThan(0.6);
          }
          if (slug === SLUG) {
            const shown = language === "English" ? longEnglish : longPolish;
            const value = table.getByText(shown, { exact: true });
            await expect(value).toBeVisible();
            expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
          }
        }
        if (slug === SLUG) {
          const shown = language === "English" ? longEnglish : longPolish;
          const other = language === "English" ? longPolish : longEnglish;
          const row = table.getByRole("row").filter({ hasText: shown });
          await row.getByRole("button").click();
          const translation = page.getByText(other, { exact: true });
          await expect(translation).toBeVisible();
          await expect.poll(() => translation.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
          })).toBe(true);
          await page.keyboard.press("Escape");
        }
      }
    }
  } finally {
    const restored = await request.put(dictionaryUrl, { headers, data: original });
    expect(restored.ok()).toBe(true);
    if (userId != null) {
      const removed = await request.delete(`/api/v1/users/${userId}`, { headers });
      expect(removed.ok()).toBe(true);
    }
  }
});
