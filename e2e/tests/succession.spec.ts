import { test, expect, login, logout, uniqueText, AAA_ONE, MANAGER_AAA } from "./helpers";
import { apiToken, authHeader } from "./api";

// Succession plans (v2.42.0): the manager's critical-role/seat records. This file exclusively
// owns Manager AAA's succession plans (seat: AAA One, candidates: AAA Two and AAA Three) plus
// the development goal the nomination modal creates for the (Manager AAA, AAA Two) pair —
// goals.spec owns the (Manager AAA, AAA Three) GOAL pair and no goal is created for AAA Three
// here, so no collision. Everything is unique-texted and deleted in-test, with an API fallback
// so a failed run leaves no residue.
let planId: number | null = null;
let goalId: number | null = null;

// The pulse.spec sweep precedent: a stranded plan for the owned (Manager AAA, AAA One) pair —
// a failed run, or manual testing on the shared volume — 409s the create below and blocks the
// spec until someone cleans it by hand. Sweep the pair at start; this spec owns it outright.
test.beforeEach(async ({ request }) => {
  const token = await apiToken(request, MANAGER_AAA);
  const res = await request.get("/api/v1/succession-plans?view=own&pageSize=100", {
    headers: authHeader(token),
  });
  const { items } = (await res.json()) as { items: { id: number; userName: string }[] };
  for (const plan of items.filter((p) => p.userName === "AAA One")) {
    await request.delete(`/api/v1/succession-plans/${plan.id}`, { headers: authHeader(token) });
  }
});

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

  // 1. The manager creates a plan for a direct report — the criticality/risk sliders start
  //    mid-scale (Core/Medium); one ArrowRight each promotes them to Critical/High.
  await login(page, MANAGER_AAA);
  await page.getByRole("link", { name: "Succession plans" }).click();
  await expect(page.getByRole("heading", { name: "Succession plans" })).toBeVisible();
  await page.getByRole("link", { name: "New plan" }).click();
  await expect(page.getByRole("heading", { name: "New succession plan" })).toBeVisible();

  await page.getByRole("combobox", { name: "Person" }).click();
  await page.getByRole("option", { name: "AAA One" }).click();
  await page.getByRole("slider", { name: "Role criticality" }).press("ArrowRight");
  await page.getByRole("slider", { name: "Retention risk" }).press("ArrowRight");
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

  // 2. The create lands on the Review screen's Basic-info tab: the definition is inline
  //    editable (the impact row carries its text) and the empty bench shows the warning cue.
  await expect(page.getByRole("heading", { name: "Succession plan" })).toBeVisible();
  await expect(
    page.getByText("The bench is below target: 0 of 2 successors nominated."),
  ).toBeVisible();
  await expect(page.getByLabel("Loss-impact item 1", { exact: true })).toHaveValue(impact);

  // 3. Nominate AAA Two from the Nominations tab, with a competency gap and a development
  //    goal created from the modal.
  await page.getByRole("tab", { name: "Nominations" }).click();
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

  // 4. Back on the Review screen: the 1/2 cue on Basic info, the card on the Nominations tab.
  await expect(
    page.getByText("The bench is below target: 1 of 2 successors nominated."),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Nominations" }).click();
  await expect(page.getByText("AAA Two", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready now (0–3 mo)")).toBeVisible();
  await expect(page.getByText(gap)).toBeVisible();
  await expect(page.getByRole("link", { name: `Open the goal ${goalTitle}` })).toBeVisible();

  // 5. Progress on a gap: edit the nomination, tick its filled flag, and see the strikethrough
  //    on the read-only card (v2.45.0).
  await page.getByLabel("Edit the nomination of AAA Two").click();
  await expect(page.getByRole("heading", { name: "Edit successor nomination" })).toBeVisible();
  await page.getByLabel("Mark competency gap 1 as filled").check();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/nominations/") && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await expect(page.getByText("Nomination updated").first()).toBeVisible();
  await page.getByRole("tab", { name: "Nominations" }).click();
  await expect(page.getByText(gap)).toHaveCSS("text-decoration-line", "line-through");

  // 6. A second nomination (AAA Three) defaults to Secondary now that a primary exists;
  //    explicitly picking Primary asks to demote AAA Two, and continuing swaps the two types.
  await page.getByRole("link", { name: "Add nomination" }).click();
  await expect(page.getByRole("heading", { name: "New successor nomination" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Nomination type" })).toHaveValue("Secondary");
  await page.getByRole("combobox", { name: "Candidate", exact: true }).click();
  await page.getByRole("option", { name: "AAA Three" }).click();
  await page.getByRole("combobox", { name: "Nomination type" }).click();
  await page.getByRole("option", { name: "Primary", exact: true }).click();
  await page.locator("#main-content").getByRole("button", { name: "Create", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByText(/AAA Two is currently the primary successor/)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/nominations") && r.request().method() === "POST" && r.ok(),
    ),
    confirm.getByRole("button", { name: "Make primary" }).click(),
  ]);
  await expect(page.getByText("Nomination added").first()).toBeVisible();
  // The demote rode the same write: AAA Three holds the one Primary, AAA Two turned Secondary,
  // and the 2/2 bench retires the under-target cue on the Basic-info tab.
  await expect(page.getByText(/The bench is below target/)).toHaveCount(0);
  await page.getByRole("tab", { name: "Nominations" }).click();
  await expect(page.getByText("AAA Three", { exact: true })).toBeVisible();
  await expect(page.getByText("Primary", { exact: true })).toBeVisible();
  await expect(page.getByText("Secondary", { exact: true })).toBeVisible();

  // 7. The History tab (v2.46.0): the trail records the whole session so far, localized.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Plan created (Critical / High, bench target 2).")).toBeVisible();
  await expect(
    page.getByText("AAA Three nominated (Ready soon (3–12 mo), Primary)."),
  ).toBeVisible();
  await expect(
    page.getByText("The nomination of AAA Two changed to secondary — a new primary was chosen."),
  ).toBeVisible();

  // 8. The person-card button (v2.47.0): while the plan is OPEN, the subordinates grid's
  //    AAA One card links straight to it; AAA Two (a candidate, not a seat) gets nothing.
  await page.goto("/?tab=subordinates");
  await page
    .locator("li", { hasText: "AAA One" })
    .first()
    .getByRole("link", { name: "Succession plan for AAA One" })
    .click();
  await expect(page.getByRole("heading", { name: "Succession plan" })).toBeVisible();
  await page.goto("/?tab=subordinates");
  await expect(
    page.getByRole("link", { name: "Succession plan for AAA Two" }),
  ).toHaveCount(0);
  await page.goto(`/succession/${planId}/view`);
  await expect(page.getByRole("heading", { name: "Succession plan" })).toBeVisible();

  // 9. Complete review stamps the reviewed date and exits to the list, where the filled
  //    Critical/High badges show on the row.
  await page.getByRole("button", { name: "Complete review" }).click();
  await expect(page.getByText("Review completed").first()).toBeVisible();
  await expect(page).toHaveURL(/\/succession$/);
  await expect(page.getByText("Critical", { exact: true })).toBeVisible();
  await expect(page.getByText("High", { exact: true })).toBeVisible();

  // 10. Re-entering and leaving via Close warns that the visit won't count as a review.
  await page.getByRole("link", { name: "Review the succession plan for AAA One" }).click();
  await expect(page.getByRole("heading", { name: "Succession plan" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const leaveDialog = page.getByRole("dialog");
  await expect(leaveDialog.getByText(/will not count as a review of the plan/)).toBeVisible();
  await leaveDialog.getByRole("button", { name: "Leave" }).click();
  await expect(page).toHaveURL(/\/succession$/);

  // 11. The seat's person sees nothing: no nav leaf (not a manager), an empty direct visit.
  await logout(page);
  await login(page, AAA_ONE);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Succession plans" })).toHaveCount(0);
  await page.goto("/succession");
  await expect(page.getByRole("heading", { name: "Succession plans" })).toBeVisible();
  await expect(page.getByText("No succession plans")).toBeVisible();

  // 12. Back as the owner: close the plan — it stays browsable but read-only; then delete it
  //    from the list (the Review screen no longer carries Delete).
  await logout(page);
  await login(page, MANAGER_AAA);
  await page.goto(`/succession/${planId}/view`);
  await page.getByRole("button", { name: "Close plan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close plan" }).click();
  await expect(page.getByText("Succession plan closed").first()).toBeVisible();
  await expect(
    page.getByText("This plan is closed — it stays browsable but can no longer be edited."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete review" })).toHaveCount(0);
  // The bench stays browsable on the closed plan, without edit affordances.
  await page.getByRole("tab", { name: "Nominations" }).click();
  await expect(page.getByText(gap)).toBeVisible();
  await expect(page.getByRole("link", { name: "Add nomination" })).toHaveCount(0);

  await page.getByRole("link", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/succession$/);
  await page.getByRole("button", { name: "Delete the succession plan for AAA One" }).click();
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
  await expect(page.getByText("Succession plan deleted").first()).toBeVisible();
});
