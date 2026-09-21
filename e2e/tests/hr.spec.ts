import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  provideFeedback,
  gotoUserRow,
  ADMIN,
  AAA_THREE,
  MANAGER_AAA,
} from "./helpers";
import { apiToken, authHeader } from "./api";

// The probe DRAFT minted below (manager-aaa → AAA Three — this file's exclusively-owned pair
// under parallel workers; AAA One belongs to the other feedback specs) would block any later
// spec's create on the same pair via the no-duplicate invariant, so it is deleted via the API
// even on failure.
let probeFeedbackId: number | null = null;

test.afterEach(async ({ request }) => {
  if (probeFeedbackId == null) return;
  const id = probeFeedbackId;
  probeFeedbackId = null;
  // apiToken retries through the per-IP login bucket like helpers.login() does.
  const token = await apiToken(request, MANAGER_AAA);
  await request.delete(`/api/v1/feedbacks/${id}`, { headers: authHeader(token) });
});

// The HR auditor role (v1.25.0): read-only access to everything any user is a party to —
// browsed from the user-details Audit section — with zero write affordances and no admin
// surface. The cross-pair read matrix and the hr.read/hr.list audit trail live in the server
// suite (HrRoleTest); this spec walks the real UI path once.

test("an HR auditor browses another pair's private draft read-only", async ({ page }) => {
  // 1. Admin mints a throwaway user and grants HR (Roles multi-select: Escape closes the
  //    dropdown so it can't cover Save).
  await login(page, ADMIN);
  const auditor = await createUserViaUi(page, "E2E-HR");
  await page.goto(`/users/${auditor.id}/edit`);
  await page.getByRole("combobox", { name: "Roles" }).click();
  await page.getByRole("option", { name: "HR" }).click();
  await page.keyboard.press("Escape");
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${auditor.id}$`).test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  // Since v1.26.0 ADMIN is a management-only role: on a user's details page the admin gets
  // no Audit section (the email is the page-loaded barrier before asserting the absence).
  await gotoUserRow(page, "AAA Three");
  await page.getByRole("link", { name: "User details for AAA Three" }).click();
  await expect(page.getByText(AAA_THREE)).toBeVisible();
  await expect(page.getByText("Audit", { exact: true })).toHaveCount(0);
  await logout(page);

  // 2. A manager writes a private DRAFT about a report — invisible to everyone but the
  //    provider, ADMIN, and HR (the strongest audit-read proof).
  const probe = `E2E-HR audit probe ${Date.now()}`;
  await login(page, MANAGER_AAA);
  probeFeedbackId = await provideFeedback(page, "AAA Three", probe, "Save draft");
  await logout(page);

  // 3. The auditor reaches AAA Three's details; the Audit section is offered.
  await login(page, auditor.email, auditor.password);
  await gotoUserRow(page, "AAA Three");
  await page.getByRole("link", { name: "User details for AAA Three" }).click();
  await expect(page.getByText("Audit", { exact: true })).toBeVisible();

  // 4. The feedbacks audit list shows the foreign DRAFT with its (unredacted) preview…
  // Open it pre-sorted newest-first (persisted view settings) — the persistent dev volume
  // accumulates E2E feedback rows for this seed pair across runs, so under the default name
  // sort the fresh probe eventually falls off page 1 (the gotoUserRow lesson, table edition).
  await page.evaluate(() => {
    localStorage.setItem(
      "lettuce.viewSettings.managerFeedbacks.audit.paging",
      JSON.stringify({ sortField: "lastModified", sortDir: "desc", pageSize: 20 }),
    );
  });
  await page.getByRole("link", { name: "Audit feedbacks of AAA Three" }).click();
  await expect(page.getByRole("heading", { name: "All feedbacks of AAA Three" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: probe });
  await expect(row).toHaveCount(1);
  // …read-only: the row offers View, never Edit.
  await expect(row.getByRole("link", { name: /view/i })).toBeVisible();
  await expect(row.getByRole("link", { name: /edit/i })).toHaveCount(0);

  // 5. The opened record is read-only too: Close (a link-styled Button) is the only action —
  //    the write affordances (Send/Withdraw/Delete) are real buttons and must be absent.
  await row.getByRole("link", { name: /view/i }).click();
  await expect(page.getByText(probe)).toBeVisible();
  await expect(page.getByRole("button", { name: /send|withdraw|delete/i })).toHaveCount(0);
  // The audit back-link round-trips to the audit list.
  await page.getByRole("link", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: "All feedbacks of AAA Three" })).toBeVisible();

  // 6. The 1:1 and goals audit lists load under the same mode, reached via the audit list's
  //    "Back to User details" round-trip (content may be empty on a fresh volume — the heading
  //    is the assertion; cross-pair rows are pinned server-side in HrRoleTest).
  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Audit 1:1 meetings of AAA Three" }).click();
  await expect(page.getByRole("heading", { name: "All 1:1 meetings of AAA Three" })).toBeVisible();
  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Audit goals of AAA Three" }).click();
  await expect(page.getByRole("heading", { name: "All goals of AAA Three" })).toBeVisible();

  // 6b. The career timeline joined the guarded HR reads in v2.25.0 (self/chain/HR only):
  //     the details card offers auditors the Career progression drill-down, and the page
  //     loads for HR — the positive twin of user-career.spec's refused direct URL.
  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Career progression of AAA Three" }).click();
  await expect(
    page.getByRole("heading", { name: "Career progression — AAA Three" }),
  ).toBeVisible();
  await page.goBack();

  // 6c. The four remaining audit drill-downs (v3.24.0 — until then only feedbacks/1:1s/goals
  //     were walked here). Headings and the ABSENCE of write affordances are the assertions:
  //     AAA Three's reviews/days off/journal/plans belong to other specs, so row counts are
  //     not this file's to assert (the cross-pair matrix is pinned in HrRoleTest). The career
  //     step above ended with goBack(), so this starts ON the details page — no back-link click.
  await page.getByRole("link", { name: "Audit performance reviews of AAA Three" }).click();
  await expect(
    page.getByRole("heading", { name: "All performance reviews of AAA Three" }),
  ).toBeVisible();

  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Audit days off of AAA Three" }).click();
  await expect(page.getByRole("heading", { name: "Days off of AAA Three" })).toBeVisible();
  // v3.24.0: the auditor now also sees the paid-leave BUDGET behind the corrections they could
  // already read — read-only, so the manager affordances must all be absent.
  await expect(page.getByText(/Paid days off of AAA Three in \d{4}/)).toBeVisible();
  await expect(page.getByRole("button", { name: /add pool|archive/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /edit the .* allowance/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /add a correction/i })).toHaveCount(0);

  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Audit AAA Three's impact log" }).click();
  await expect(page.getByRole("heading", { name: "Impact log — AAA Three" })).toBeVisible();

  await page.getByRole("link", { name: /back to user details/i }).click();
  await page.getByRole("link", { name: "Succession plans involving AAA Three (audit)" }).click();
  await expect(
    page.getByRole("heading", { name: "Succession plans of AAA Three (audit)" }),
  ).toBeVisible();

  // 6d. The team-KPI auditor path (v3.24.0) — until then HR could read any KPI record by id
  //     but nothing listed or linked them. Both entry points, by clicking only: the hub's
  //     auditor tab, and the team-details link (Config -> Teams -> a team the auditor neither
  //     manages nor belongs to). The DATA rule (an auditor lists another team's KPIs at every
  //     status; a manager/ADMIN gets 403) is pinned server-side in TeamKpiRoutesTest — this
  //     walk asserts REACH, so it never depends on rows another spec owns.
  await page.getByRole("link", { name: "Team KPIs" }).click();
  await expect(page.getByRole("tab", { name: "All teams" })).toBeVisible();
  await page.getByRole("tab", { name: "All teams" }).click();
  await expect(
    page.getByText("Every team's KPIs, org-wide — at every status, drafts included."),
  ).toBeVisible();

  // /teams directly (the house idiom of every other spec — the Config nav group collapses off
  // its own routes, so a click path through it would depend on the group's expanded state).
  await page.goto("/teams");
  await page.getByRole("link", { name: "Team details for AAA" }).click();
  // Scoped to main: the nav leaf carries the same accessible name ("Team KPIs" is the button's
  // visible text — the page-header action takes no per-team aria-label).
  await page.locator("main").getByRole("link", { name: "Team KPIs" }).click();
  await expect(page.getByRole("heading", { name: "Team KPIs of AAA" })).toBeVisible();
  await expect(page.getByText(/an auditor view, since you don't manage this team/)).toBeVisible();
  // Read-only: the auditor never gets the manager's create entry point.
  await expect(page.getByRole("link", { name: "New team KPI" })).toHaveCount(0);

  // 7. No admin surface: the Config group never offers Alerts to HR.
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);
});
