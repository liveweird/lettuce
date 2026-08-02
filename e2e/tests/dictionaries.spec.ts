import { test, expect, login, uniqueText, ADMIN } from "./helpers";
import type { Page } from "@playwright/test";

// The three global dictionaries share one page (`/dictionaries/:slug`): admins edit the whole
// ordered list in place and save it atomically; everyone else gets the read-only numbered view.
// The dictionary is a global document, so this spec only ever appends its own throwaway entries
// (unique E2E-* values) after whatever the volume already holds, and removes them at the end —
// pre-existing entries ride along in every save untouched.

const SLUG = "career-paths";

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

test("admin curates a dictionary; a regular user sees the read-only list", async ({ page }) => {
  const valueA = uniqueText("E2E-Path-A");
  const valueB = uniqueText("E2E-Path-B");
  const renamed = `${valueA}-renamed`;

  await login(page, ADMIN);
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByRole("heading", { name: "Career paths" })).toBeVisible();
  const addEntry = page.getByRole("button", { name: "Add entry", exact: true });
  await expect(addEntry).toBeVisible();

  // Append two entries after whatever is already there.
  const base = await page.getByRole("textbox").count();
  await addEntry.click();
  await page.getByLabel(`Entry ${base + 1}`, { exact: true }).fill(valueA);
  await addEntry.click();
  await page.getByLabel(`Entry ${base + 2}`, { exact: true }).fill(valueB);
  await saveDictionary(page);

  // The re-seeded editor shows both, in order, at the end of the list.
  await expect(page.getByLabel(`Entry ${base + 1}`, { exact: true })).toHaveValue(valueA);
  await expect(page.getByLabel(`Entry ${base + 2}`, { exact: true })).toHaveValue(valueB);

  // Reorder (B above A) and rename A in the same save.
  await page.getByRole("button", { name: `Move entry ${base + 2} up`, exact: true }).click();
  await page.getByLabel(`Entry ${base + 2}`, { exact: true }).fill(renamed);
  await saveDictionary(page);
  await expect(page.getByLabel(`Entry ${base + 1}`, { exact: true })).toHaveValue(valueB);
  await expect(page.getByLabel(`Entry ${base + 2}`, { exact: true })).toHaveValue(renamed);

  // A regular user sees the same values read-only: no inputs, no editor buttons. Sign out
  // through the UI first — the login helper drives the real /login form, which an
  // authenticated session gets redirected away from.
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await login(page, "aaa-one@lettuce.local");
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByText(valueB, { exact: true })).toBeVisible();
  await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toHaveCount(0);

  // Cleanup: the admin removes the two throwaway entries (positions shift after the first
  // removal, so the same label is clicked twice), leaving the volume as found.
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await login(page, ADMIN);
  await page.goto(`/dictionaries/${SLUG}`);
  await expect(page.getByLabel(`Entry ${base + 1}`, { exact: true })).toHaveValue(valueB);
  await page.getByRole("button", { name: `Remove entry ${base + 1}`, exact: true }).click();
  await page.getByRole("button", { name: `Remove entry ${base + 1}`, exact: true }).click();
  await saveDictionary(page);
  await expect(page.getByText(valueB, { exact: true })).toHaveCount(0);
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
});
