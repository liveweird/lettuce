import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  provideFeedback,
  gotoUserRow,
  recordApiWrites,
  ADMIN,
  AAA_ONE,
  AAA_THREE,
  HR,
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

  // 6e. The org-wide calendar (v3.25.0) — the auditor's Days off calendar used to contain only
  //     themselves (member scope) since they belong to no team and manage nobody. Reach
  //     assertion: the auditor-only scope exists, picking it asks the server for scope=org, and
  //     the team narrowing appears. WHO shows up that month is demo-volume state other specs
  //     own, so it is not asserted here; the data rule lives in DaysOffRoutesTest.
  await page.goto("/days-off");
  await page.getByRole("combobox", { name: "Whose calendar" }).click();
  const [orgCalendar] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/days-off/calendar") && r.url().includes("scope=org")),
    page.getByRole("option", { name: "All teams (auditor)" }).click(),
  ]);
  expect(orgCalendar.ok()).toBe(true);
  await expect(page.getByRole("combobox", { name: "Team", exact: true })).toBeVisible();

  // 7. No admin surface: the Config group never offers Alerts to HR.
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);
});

// The seeded HR demo account (v4.1.0): a relationship-less auditor, read-only, confirming the
// same reach the minted auditor above exercises exists on a real login too — no writes here.
test("the seeded HR demo account reaches the Audit section with no admin surface", async ({ page }) => {
  await login(page, HR);

  await gotoUserRow(page, "AAA One");
  // No admin surface on the users list: the seed account is HR only, never ADMIN.
  await expect(page.getByRole("button", { name: "Modify actions for AAA One" })).toHaveCount(0);

  await page.getByRole("link", { name: "User details for AAA One" }).click();
  await expect(page.getByText(AAA_ONE)).toBeVisible();
  await expect(page.getByText("Audit", { exact: true })).toBeVisible();

  // No admin surface in the nav either: the Config group never offers Alerts to HR.
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);
});

// v4.3.0: HR reach into team performance (the review-period "Everyone (auditor)" reports
// scope) and the pulse hub's Results/Trend/Participation tabs — the HR demo account manages
// nobody and belongs to no team, so it is the exact "org-wide or nothing" case those two
// features exist for. Read-only throughout: recordApiWrites is the walker's own oracle
// (the feature-tutorials idiom) — list totals move under parallel writers, this file's own
// traffic does not.
test("the HR auditor reaches team performance and every pulse tab, read-only", async ({ page }) => {
  await login(page, HR);
  const writes = recordApiWrites(page);

  // Team's-performance tab: visible to HR even though it manages nobody, and its Reports
  // scope defaults straight to "Everyone (auditor)" — the only scope that isn't permanently
  // empty for a relationship-less auditor.
  await page.goto("/performance?tab=managed");
  await expect(page.getByRole("tab", { name: "Team's performance" })).toBeVisible();
  // Review periods are performance-reviews.spec's registry (e2e/README.md) — this file never
  // appends one. On a fresh database with an empty timeline the dashboard shows its
  // no-periods state instead of the table; only the tab's reach is asserted then.
  const noPeriods = page.getByText(/There are no review periods yet/);
  const filters = page.getByRole("button", { name: /filters/i });
  await expect(noPeriods.or(filters)).toBeVisible();
  if (await filters.isVisible()) {
    await filters.click();
    const reportsScope = page.getByRole("combobox", { name: "Reports" });
    await expect(reportsScope).toHaveValue("Everyone (auditor)");
    // A relationship-less auditor has no meaningful direct/all choice — the control is locked.
    await expect(reportsScope).toBeDisabled();
    // Wait for a REAL data row — a person-details link inside the table body — before asserting
    // the create action is absent; a loading/empty row would make that assertion vacuous.
    await expect(
      page.getByRole("table").locator("tbody").getByRole("link", { name: /^User details for / }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /New performance review/ })).toHaveCount(0);
  }

  // Pulse: Results, Trend and Participation each render real content, not an empty/forbidden
  // state — the hub gates Participation on isManager || isHr(), and Results/Trend fall back
  // to the org-wide "all" view for an auditor with no own/monitored teams. Each wait below
  // accepts either real content or the corresponding LEGITIMATE empty state (no closed cycle
  // yet, no cycle to monitor) — never leaves the tab on its loading Skeleton before the
  // negative "no error alert" check that follows, which would make that check vacuous too.
  await page.goto("/pulse?tab=results");
  await expect(page.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("No closed pulse cycles yet.").or(page.getByRole("heading", { name: "AAA", exact: true })),
  ).toBeVisible();
  await expect(page.getByText("Loading failed", { exact: false })).toHaveCount(0);

  await page.getByRole("tab", { name: "Trend" }).click();
  await expect(
    page
      .getByRole("group", { name: "Teams on the chart" })
      .or(page.getByText("There are no teams in the organization yet.")),
  ).toBeVisible();
  await expect(page.getByText("Loading failed", { exact: false })).toHaveCount(0);

  await page.getByRole("tab", { name: "Participation" }).click();
  await expect(
    page
      .getByText("No open or closed cycle to monitor.")
      .or(page.getByRole("heading", { name: "AAA", exact: true })),
  ).toBeVisible();
  await expect(page.getByText("Could not load the participation.")).toHaveCount(0);

  expect(writes).toEqual([]);
});
