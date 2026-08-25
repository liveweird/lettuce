import { test, expect, login, logout, uniqueText, AAA_ONE, MANAGER_AAA } from "./helpers";
import { apiToken, authHeader } from "./api";

// Succession plans (v2.42.0): the manager's critical-role/seat records. This file exclusively
// owns Manager AAA's succession plans (seat: AAA One, candidate: AAA Two) plus the development
// goal the nomination modal creates for the (Manager AAA, AAA Two) pair — goals.spec owns the
// (Manager AAA, AAA Three) pair, so no collision. Everything is unique-texted and deleted
// in-test, with an API fallback so a failed run leaves no residue.
let planId: number | null = null;
let goalId: number | null = null;

test.afterEach(async ({ request }) => {
  const token = await apiToken(request, MANAGER_AAA);
  if (planId != null) {
    const id = planId;
    planId = null;
    await request.delete(`/api/v1/succession-plans/${id}`, { headers: authHeader(token) });
  }
  if (goalId != null) {
    const id = goalId;
    goalId = null;
    // The modal-created goal stays DRAFT, so the DRAFT-only delete works.
    await request.delete(`/api/v1/goals/${id}`, { headers: authHeader(token) });
  }
});

test("a manager plans a succession, nominates a successor with a linked development goal, and closes the plan", async ({
  page,
}) => {
  const impact = uniqueText("E2E succession impact");
  const gap = uniqueText("E2E succession gap");
  const goalTitle = uniqueText("E2E succession goal");

  // 1. The manager creates a plan for a direct report.
  await login(page, MANAGER_AAA);
  await page.getByRole("link", { name: "Succession plans" }).click();
  await expect(page.getByRole("heading", { name: "Succession plans" })).toBeVisible();
  await page.getByRole("link", { name: "New plan" }).click();
  await expect(page.getByRole("heading", { name: "New succession plan" })).toBeVisible();

  await page.getByRole("combobox", { name: "Person" }).click();
  await page.getByRole("option", { name: "AAA One" }).click();
  await page.getByRole("combobox", { name: "Role criticality" }).click();
  await page.getByRole("option", { name: "Critical" }).click();
  await page.getByRole("combobox", { name: "Retention risk" }).click();
  await page.getByRole("option", { name: "High", exact: true }).click();
  await page.getByRole("button", { name: "Add impact item" }).click();
  // exact: the row's move/remove buttons carry "… loss-impact item 1 …" labels too.
  await page.getByLabel("Loss-impact item 1", { exact: true }).fill(impact);

  const [created] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/succession-plans") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  planId = ((await created.json()) as { id: number }).id;
  await expect(page.getByText("Succession plan created").first()).toBeVisible();

  // 2. The create lands on the plan view: badges, the empty bench's warning cue, the impact list.
  await expect(page.getByRole("heading", { name: "Succession plan" })).toBeVisible();
  await expect(page.getByText("Critical", { exact: true })).toBeVisible();
  await expect(page.getByText("High", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The bench is below target: 0 of 2 successors nominated."),
  ).toBeVisible();
  await expect(page.getByText(impact)).toBeVisible();

  // 3. Nominate AAA Two, with a competency gap and a development goal created from the modal.
  await page.getByRole("link", { name: "Add nomination" }).click();
  await expect(page.getByRole("heading", { name: "New successor nomination" })).toBeVisible();
  // exact: "Candidate awareness" is a sibling combobox.
  await page.getByRole("combobox", { name: "Candidate", exact: true }).click();
  await page.getByRole("option", { name: "AAA Two" }).click();
  await page.getByRole("combobox", { name: "Readiness window" }).click();
  await page.getByRole("option", { name: "Ready now (0–3 mo)" }).click();
  await page.getByRole("button", { name: "Add gap" }).click();
  await page.getByLabel("Competency gap 1", { exact: true }).fill(gap);

  // The in-chain candidate unlocks the goal-create modal; the fresh DRAFT links by default.
  await page.getByRole("button", { name: "New development goal" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: "New development goal" })).toBeVisible();
  await modal.getByLabel("Title").fill(goalTitle);
  // withAsterisk widens the accessible names — match by prefix (the known gotcha).
  await modal.getByLabel(/^Target$|^Target \*/).fill("3");
  await modal.getByLabel("Due date").fill("2027-12-31");
  const [goalCreated] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/goals") && r.request().method() === "POST" && r.ok(),
    ),
    modal.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  goalId = ((await goalCreated.json()) as { id: number }).id;
  await expect(page.getByText("Development goal created and linked").first()).toBeVisible();
  // The linked goal shows as a selected pill in the Development action items picker.
  // .first(): the closed MultiSelect keeps its listbox option MOUNTED beside the pill.
  await expect(page.getByText(`${goalTitle} (Draft)`).first()).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/nominations") && r.request().method() === "POST" && r.ok(),
    ),
    // Scope to the page: the just-closed goal modal lingers in the DOM during its exit
    // transition, Create button included.
    page.locator("#main-content").getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  await expect(page.getByText("Nomination added").first()).toBeVisible();

  // 4. The plan view shows the bench: the nomination card, its gap, the goal chip, 1/2 cue.
  await expect(page.getByText("AAA Two", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready now (0–3 mo)")).toBeVisible();
  await expect(page.getByText(gap)).toBeVisible();
  await expect(page.getByRole("link", { name: `Open the goal ${goalTitle}` })).toBeVisible();
  await expect(
    page.getByText("The bench is below target: 1 of 2 successors nominated."),
  ).toBeVisible();

  // 5. The seat's person sees nothing: no nav leaf (not a manager), an empty direct visit.
  await logout(page);
  await login(page, AAA_ONE);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Succession plans" })).toHaveCount(0);
  await page.goto("/succession");
  await expect(page.getByRole("heading", { name: "Succession plans" })).toBeVisible();
  await expect(page.getByText("No succession plans")).toBeVisible();

  // 6. Back as the owner: close the plan — it stays browsable but read-only; then delete it.
  await logout(page);
  await login(page, MANAGER_AAA);
  await page.goto(`/succession/${planId}/view`);
  await page.getByRole("button", { name: "Close plan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close plan" }).click();
  await expect(page.getByText("Succession plan closed").first()).toBeVisible();
  await expect(
    page.getByText("This plan is closed — it stays browsable but can no longer be edited."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Add nomination" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);
  // The bench stays browsable on the closed plan.
  await expect(page.getByText(gap)).toBeVisible();

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/v1/succession-plans/${planId}`) &&
        r.request().method() === "DELETE" &&
        r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  planId = null;
  await expect(page).toHaveURL(/\/succession$/);
  await expect(page.getByText("Succession plan deleted").first()).toBeVisible();
});
