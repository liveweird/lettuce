import { createUserViaUi, expect, login, loginWithPassword, logout, switchLanguage, test, ADMIN } from "./helpers";

// The changelog page (/changelog): the bundled release history whose newest entry IS the
// app's displayed version. Read-only — the visit only marks the "new entries" dot as seen
// in the viewer's own localStorage. No exact-version assert on purpose: that would need a
// hand-edit every release; the semver shape + a rendered body already prove the page wires
// the bundled entries in, in both languages. The PL leg runs on a THROWAWAY user since
// v2.21.0 — switching persists the server-side language, and seeded accounts must stay
// English for the parallel suite.
test("the changelog lists versioned entries and renders them in the picked language", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E Changelog");
  await logout(page);
  await loginWithPassword(page, user.email, user.password);

  await page.goto("/changelog");
  await expect(page.getByRole("heading", { name: "Changelog" })).toBeVisible();

  // The newest entry: a semver title, its release date, and a non-empty markdown body.
  const newest = page.getByText(/^v\d+\.\d+\.\d+$/).first();
  await expect(newest).toBeVisible();
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2}$/).first()).toBeVisible();

  // Entry bodies are bilingual (content, not chrome): switching to PL re-renders the
  // heading and keeps the version timeline (the i18n.spec switcher idiom).
  await switchLanguage(page, "Polski");
  await expect(page.getByRole("heading", { name: "Historia zmian" })).toBeVisible();
  await expect(page.getByText(/^v\d+\.\d+\.\d+$/).first()).toBeVisible();

  // Back to EN — hygiene (the switcher helper's trigger/name locators are language-proof).
  await switchLanguage(page, "English");
  await expect(page.getByRole("heading", { name: "Changelog" })).toBeVisible();
});
