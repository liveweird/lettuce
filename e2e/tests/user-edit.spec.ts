import { test, expect, login, uniqueText, ADMIN } from "./helpers";
import type { Page } from "@playwright/test";

// Validates POST /users + PUT /users/{id} through the UI. Creates its own throwaway user so it
// never mutates a seeded account other specs reference by name.
test("admin creates then renames a user", async ({ page }) => {
  const email = `${uniqueText("e2e")}@lettuce.local`.toLowerCase();
  const name1 = uniqueText("E2E Created");
  const name2 = uniqueText("E2E Renamed");
  await login(page, ADMIN);

  // Create (role defaults to USER). The password is generated client-side and revealed
  // once in a confirmation modal — the form has no password fields anymore.
  await page.goto("/users/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name1);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/users") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const id: number = (await created.json()).id;

  // Dismiss the one-time generated-password reveal (.last() skips the header X if it
  // shares the accessible name "Close").
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();

  // Rename via PUT /users/{id}.
  await page.goto(`/users/${id}/edit`);
  await page.getByRole("textbox", { name: "Name" }).fill(name2);
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/users\/\d+$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  // Reopen the user; the persisted name is the one we set.
  await page.goto(`/users/${id}/edit`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(name2);
});

// The dictionary whole-document save cycle (the dictionaries.spec helper): wait for the PUT
// AND the re-seeding GET, then for the Save button to leave its loading state — edits made
// before that lands would be silently reverted.
async function saveDictionary(page: Page, slug: string) {
  const save = page.getByRole("button", { name: "Save", exact: true });
  const isDictionaryCall = (r: { url(): string }) => r.url().endsWith(`/api/v1/dictionaries/${slug}`);
  await Promise.all([
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "PUT" && r.ok()),
    page.waitForResponse((r) => isDictionaryCall(r) && r.request().method() === "GET" && r.ok()),
    save.click(),
  ]);
  await expect(save).not.toHaveAttribute("data-loading", /.*/);
  await expect(save).toBeDisabled();
}

// The career profile (v1.32.0): entry-id storage means a dictionary rename propagates to the
// user's profile immediately — the user's exact acceptance scenario. Only ever appends its own
// throwaway E2E-* entry to the shared career-paths dictionary and retires it at the end.
test("a career path set on a user follows the dictionary entry through a rename", async ({ page }) => {
  const email = `${uniqueText("e2e")}@lettuce.local`.toLowerCase();
  const userName = uniqueText("E2E Career");
  const value1 = uniqueText("E2E-Career-Path");
  const value2 = `${value1}-renamed`;
  await login(page, ADMIN);

  // Append a throwaway entry to the career-paths dictionary. Wait for the editor to render
  // (the Add-entry button appears with the loaded rows) BEFORE counting — counting during the
  // load yields 0 and the fill below would overwrite the first pre-existing entry instead.
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const base = await page.getByRole("textbox").count();
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByLabel(`Entry ${base + 1}`, { exact: true }).fill(value1);
  await saveDictionary(page, "career-paths");

  // A throwaway user to carry the profile.
  await page.goto("/users/new");
  await page.getByRole("textbox", { name: "Name" }).fill(userName);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/users") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const id: number = (await created.json()).id;
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();

  // Fresh user: the details page flags all three career fields as missing.
  await page.goto(`/users/${id}/details`);
  await expect(page.getByText("Career profile")).toBeVisible();
  await expect(page.getByText("Not set")).toHaveCount(3);

  // The edit form shows the missing hints too; pick the new entry as the career path.
  await page.goto(`/users/${id}/edit`);
  await expect(page.getByText("Missing — providing it is strongly advised")).toHaveCount(3);
  const careerPath = page.getByRole("combobox", { name: "Career path" });
  await careerPath.click();
  await careerPath.fill(value1); // searchable — narrow the shared dictionary's long list
  await page.getByRole("option", { name: value1, exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/users\/\d+$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  // The details page resolves the value…
  await page.goto(`/users/${id}/details`);
  await expect(page.getByText(value1, { exact: true })).toBeVisible();
  await expect(page.getByText("Not set")).toHaveCount(2);

  // …and renaming the dictionary entry propagates immediately (id-keyed storage).
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const lastEntry = page.getByRole("textbox").last();
  await expect(lastEntry).toHaveValue(value1); // our appended entry is still the tail
  await lastEntry.fill(value2);
  await saveDictionary(page, "career-paths");
  await page.goto(`/users/${id}/details`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();

  // Retire the throwaway entry; the user's profile keeps resolving the retained value.
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const count = await page.getByRole("textbox").count();
  await page.getByRole("button", { name: `Remove entry ${count}`, exact: true }).click();
  await saveDictionary(page, "career-paths");
  await page.goto(`/users/${id}/details`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();
});
