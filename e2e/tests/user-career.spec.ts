import { test, expect, login, logout, createUserViaUi, notificationCard, openBell, pickSelectOption, uniqueText, ADMIN } from "./helpers";
import type { Page } from "@playwright/test";

// The career progression journey (v2.15.0): the admin's user form has NO career fields anymore;
// a throwaway manager records positions for a throwaway subordinate from the subordinates-card
// drill-down (start → conclude-by-starting-another → correct a date → delete), the current
// position feeds the details card's Profile section, the subordinate gets the notification and
// a read-only view of their own timeline, and a dictionary rename still propagates through the
// position's entry ref (the old user-edit acceptance scenario, re-homed). The v2.16.0 leg walks
// the nav Career page: the manager's own (empty) My career + the Team pyramid (row, scope
// toggle, the v2.17.0 time slider, chart view); the subordinate gets My career only. Owns all its state:
// throwaway users + team per run, plus one appended-then-retired career-paths entry (the same
// shared-dictionary etiquette the retired user-edit career leg used).

// The dictionary whole-document save cycle (the dictionaries.spec helper): wait for the PUT
// AND the re-seeding GET, then for the Save button to leave its loading state.
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

const isPositionsCall = (r: { url(): string }) => /\/api\/v1\/users\/\d+\/career-positions/.test(r.url());

test("career progression: chain manager records positions, the person sees the timeline", async ({ page }) => {
  const value1 = uniqueText("E2E-Career-Pos");
  const value2 = `${value1}-renamed`;
  await login(page, ADMIN);

  // 1. Throwaway people + team: M manages S. Passwords come from the one-time reveal modal.
  const manager = await createUserViaUi(page, "E2E Career Mgr");
  const sub = await createUserViaUi(page, "E2E Career Sub");
  const teamName = uniqueText("E2E Career Team");
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", manager.name);
  const [teamCreated] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await teamCreated.json()).id;
  await page.goto(`/teams/${teamId}/details`);
  await pickSelectOption(page, "Add a user", sub.name);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);

  // 2. A throwaway career-paths entry (the shared-dictionary append idiom).
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const base = await page.getByLabel(/^Entry \d+ \(English\)$/).count();
  await page.getByRole("button", { name: "Add entry", exact: true }).click();
  await page.getByLabel(`Entry ${base + 1} (English)`, { exact: true }).fill(value1);
  await page.getByLabel(`Entry ${base + 1} (Polish)`, { exact: true }).fill(`${value1}-pl`);
  await saveDictionary(page, "career-paths");

  // 3. The admin user form lost its career fields (v2.15.0) — no pickers, no admin write.
  await page.goto(`/users/${sub.id}/edit`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(sub.name);
  await expect(page.getByRole("combobox", { name: "Career path" })).toHaveCount(0);
  await logout(page);

  // 4. The manager drills in from the subordinates card and starts the first position.
  await login(page, manager.email, manager.password);
  await page.goto("/?tab=subordinates");
  await page.getByRole("link", { name: `Career progression of ${sub.name}` }).click();
  await expect(page.getByRole("heading", { name: `Career progression — ${sub.name}` })).toBeVisible();
  await expect(page.getByText("No positions recorded yet.")).toBeVisible();
  await page.getByLabel("Start date").fill("2024-01-01");
  const careerPath = page.getByRole("combobox", { name: "Career path" });
  await careerPath.click();
  await careerPath.fill(value1); // searchable — narrow the shared dictionary's long list
  await page.getByRole("option", { name: value1, exact: true }).click();
  // All three fields are required (v2.15.1). Pick the FIRST option of the other two — seed
  // values with stable ids (dictionaries.spec only appends/removes its OWN throwaway
  // seniority entries and the server validates by id, so a concurrent rename is harmless);
  // nothing is asserted on these two values.
  await page.getByRole("combobox", { name: "Career specialization" }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("combobox", { name: "Seniority level" }).click();
  await page.getByRole("option").first().click();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "POST" && r.ok()),
    page.getByRole("button", { name: "Start position" }).click(),
  ]);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  // Scope past the editor's closed Select — its listbox stays MOUNTED with the picked option
  // (the Mantine gotcha), so an unscoped exact-text locator strict-violates against it.
  await expect(page.locator("#main-content").getByText(value1, { exact: true })).toBeVisible();

  // 5. Starting a second position concludes the first — the form PREFILLS from the current
  //    position (v2.15.1), and a date alone is NOT enough (v2.15.2: the triple must differ
  //    from the current position's — the note explains, the submit stays disabled).
  await expect(careerPath).toHaveValue(value1);
  await page.getByLabel("Start date").fill("2025-02-01");
  await expect(page.getByRole("button", { name: "Start position" })).toBeDisabled();
  await expect(
    page.getByText("This repeats the current position exactly", { exact: false }),
  ).toBeVisible();
  // Change the seniority to the SECOND option (a different seed value — same shared-dictionary
  // etiquette as the first pick: stable ids, nothing asserted on the value).
  await page.getByRole("combobox", { name: "Seniority level" }).click();
  await page.getByRole("option").nth(1).click();
  await expect(page.getByRole("button", { name: "Start position" })).toBeEnabled();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "POST" && r.ok()),
    page.getByRole("button", { name: "Start position" }).click(),
  ]);
  await expect(page.getByText("Current", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Edit the position started 2024-01-01")).toBeVisible();
  await expect(page.getByLabel("Edit the position started 2025-02-01")).toBeVisible();

  // 6. Correct the historical position's start date in place.
  await page.getByLabel("Edit the position started 2024-01-01").click();
  await page.getByLabel("Start date").fill("2024-03-01");
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "PUT" && r.ok()),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByLabel("Edit the position started 2024-03-01")).toBeVisible();

  // 7. Delete the newer position — the survivor reopens as Current.
  await page.getByLabel("Delete the position started 2025-02-01").click();
  await Promise.all([
    page.waitForResponse((r) => isPositionsCall(r) && r.request().method() === "DELETE" && r.ok()),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByLabel(/^Edit the position started /)).toHaveCount(1);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();

  // 8. The current position backs the details card's Profile section.
  await page.goto(`/users/${sub.id}/details`);
  await expect(page.getByText(value1, { exact: true })).toBeVisible();

  // 8b. The nav Career page (v2.16.0), still as the manager: My career = own (empty)
  //     timeline; Team pyramid = the subordinate's row with the surviving position, the
  //     scope toggle re-fetching with includeIndirect, and the chart view mounting.
  await page.getByRole("link", { name: "Career", exact: true }).click();
  await expect(page.getByRole("tab", { name: "My career" })).toBeVisible();
  await expect(page.getByText("No positions recorded yet.")).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/career/pyramid") && r.ok()),
    page.getByRole("tab", { name: "Team pyramid" }).click(),
  ]);
  // Locate through the ROW (the filter Selects hold mounted dictionary listboxes, so a bare
  // value1 locator would strict-violate once the panel opens); tenure cells render "…year…".
  const subRow = page.getByRole("row").filter({ hasText: sub.name });
  await expect(subRow).toHaveCount(1);
  await expect(subRow).toContainText(value1);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const indirectFetch = page.waitForResponse(
    (r) => r.url().includes("/career/pyramid?includeIndirect=true") && r.ok(),
  );
  // The Reports select is NOT searchable (readonly input) — click + option, never
  // pickSelectOption (its narrowing fill would hang on the readonly input).
  await page.getByRole("combobox", { name: "Reports" }).click();
  await page.getByRole("option", { name: "All reports (including indirect)" }).click();
  await indirectFetch;
  await expect(subRow).toHaveCount(1);
  // The time slider (v2.17.0): one day back shows the "As of" badge, Today resets it.
  // (Always present here: this spec's own position guarantees an earliest start < today;
  // the as-of ROW semantics are pinned by unit + server tests.)
  const slider = page.getByRole("slider", { name: "Show the pyramid as of a past date" });
  await slider.press("ArrowLeft");
  await expect(page.getByText(/^As of /)).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByText(/^As of /)).toHaveCount(0);
  await page.getByText("Chart", { exact: true }).click();
  await expect(page.getByText("Distribution of", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await logout(page);

  // 9. The subordinate was notified and reads their own timeline WITHOUT the editor.
  await login(page, sub.email, sub.password);
  const dialog = await openBell(page);
  await expect(
    notificationCard(dialog, "recorded a new position in your career progression"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/users/${sub.id}/career`);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expect(page.getByText("Start a new position")).toHaveCount(0);
  // The nav page for a non-manager: My career only — no pyramid tab.
  await page.goto("/career?tab=pyramid");
  await expect(page.getByRole("tab", { name: "My career" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Team pyramid" })).toHaveCount(0);
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  // 9b. Seniority privacy (v2.25.0): the manager's card offers the subordinate no career
  //     link, and a direct URL at the manager's timeline is refused by the server.
  await page.goto("/?tab=managers");
  await expect(page.getByText(manager.name).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Career progression of ${manager.name}` })).toHaveCount(0);
  await page.goto(`/users/${manager.id}/career`);
  await expect(page.getByText("Could not load the career progression.")).toBeVisible();
  await logout(page);

  // 10. A dictionary rename propagates through the position's entry ref; retiring the entry
  //     keeps it resolving (id-keyed storage — the old user-edit acceptance scenario).
  await login(page, ADMIN);
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const lastEntry = page.getByLabel(/^Entry \d+ \(English\)$/).last();
  await expect(lastEntry).toHaveValue(value1); // our appended entry is still the tail
  await lastEntry.fill(value2);
  await saveDictionary(page, "career-paths");
  await page.goto(`/users/${sub.id}/details`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();
  await page.goto("/dictionaries/career-paths");
  await expect(page.getByRole("button", { name: "Add entry", exact: true })).toBeVisible();
  const count = await page.getByLabel(/^Entry \d+ \(English\)$/).count();
  await page.getByRole("button", { name: `Remove entry ${count}`, exact: true }).click();
  await saveDictionary(page, "career-paths");
  await logout(page);
  // The timeline is self/chain/HR-only since v2.25.0 (the ADMIN can no longer open it) —
  // the retired-entry-keeps-resolving check runs as the owner.
  await login(page, sub.email, sub.password);
  await page.goto(`/users/${sub.id}/career`);
  await expect(page.getByText(value2, { exact: true })).toBeVisible();
});
