import {
  AAA_TWO,
  ADMIN,
  collapseAlertsBanner,
  expect,
  gotoUserRow,
  login,
  logout,
  MANAGER_AAA,
  notificationCard,
  openBell,
  pickSelectOption,
  test,
} from "./helpers";
import { apiToken, authHeader } from "./api";
import type { APIRequestContext, Page } from "@playwright/test";

// Days off end to end: the admin curates a public holiday, Manager AAA sets AAA Two's yearly
// allowance on the per-user drill-down (v2.32.0 — the chain-manager right; the admin edit page
// lost the field), AAA Two requests
// two periods, Manager AAA accepts one and rejects the other, the accepted days show on the
// team calendar, and the accepted (future) request is cancelled again — so seeded accounts are
// never left with counting requests (REJECTED/CANCELLED rows are inert records). An UNPAID
// single-day request then shows the same cost preview while leaving the paid budget untouched,
// and is cancelled too. The manager also records a day ON BEHALF of AAA Two (v2.29.0, born
// Accepted, both bells notified), which the MANAGER cancels at the end (v2.31.0 — cancellation
// is owner-or-chain and always carries a mandatory reason; the cancelled row grows a reason
// popover and the acting manager keeps a bell receipt). Since v3.2.0 the paid days come in
// POOLS: the admin adds a run-specific "E2E Pool" kind on the Config registry, the manager
// grants it to AAA Two (Add pool on the drill-down), AAA Two books a day from it (the Type
// picker lists the pool), and both the grant and the kind are archived again at the end.
//
// The request window is a run-specific future Monday (weeks vary per run), so residue from a
// failed earlier run rarely collides via the overlap rule — but the sweep below is what
// actually guarantees a clean slate: a mid-run failure skips the tail cleanup, stranding the
// run's "E2E Holiday" (which silently changes a LATER run's cost preview when its window
// happens to cover that date — the 2027-05-24 incident, checkup #16) and its still-counting
// requests on AAA Two. Both are removed via the API before the UI legs (the global-setup
// seed-pair idiom), so the suite self-heals on the next run no matter where a run died.

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// The V41-seeded Polish statutory holidays (2026-2027) — the booked window must avoid them,
// or the spec's cost expectations (its OWN holiday on the first Monday) would be off.
const SEEDED_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-06", "2026-04-05", "2026-04-06", "2026-05-01", "2026-05-03",
  "2026-05-24", "2026-06-04", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-24",
  "2026-12-25", "2026-12-26",
  "2027-01-01", "2027-01-06", "2027-03-28", "2027-03-29", "2027-05-01", "2027-05-03",
  "2027-05-16", "2027-05-27", "2027-08-15", "2027-11-01", "2027-11-11", "2027-12-24",
  "2027-12-25", "2027-12-26",
]);

/** A future Monday 4–43 weeks out (varies per run-minute); the whole two-week window the spec
 * books must stay inside one calendar year (the same-year rule) and clear of the seeded
 * holidays (their zero cost would break the expected numbers). */
function pickMonday(): Date {
  let monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); // next Monday
  const weeks = 4 + (Math.floor(Date.now() / 60_000) % 40);
  monday = addDays(monday, weeks * 7);
  const windowBlocked = (m: Date) =>
    m.getFullYear() !== addDays(m, 8).getFullYear() ||
    // Offsets 0/1 + 7/8 are the two Mon–Tue requests; 2 is the UNPAID leg's Wednesday;
    // 3 is the manager's on-behalf Thursday (v2.29.0); 4 is the extra-pool Friday (v3.2.0).
    [0, 1, 2, 3, 4, 7, 8].some((offset) => SEEDED_HOLIDAYS.has(isoDate(addDays(m, offset))));
  while (windowBlocked(monday)) {
    monday = addDays(monday, 7);
  }
  return monday;
}

const MONDAY = pickMonday();
const MONDAY_ISO = isoDate(MONDAY);
const TUESDAY_ISO = isoDate(addDays(MONDAY, 1));
// The UNPAID leg's single day — inside the same booked week (no overlap: the Mon–Tue request
// is cancelled by then, and cancelled rows are inert for the overlap rule anyway).
const WEDNESDAY_ISO = isoDate(addDays(MONDAY, 2));
// The manager's on-behalf leg (v2.29.0) books this day for AAA Two — same booked week, no
// overlap (the earlier requests are cancelled/rejected by then, and those rows are inert).
const THURSDAY_ISO = isoDate(addDays(MONDAY, 3));
// The extra-pool leg (v3.2.0) books this day from the run's own pool kind.
const FRIDAY_ISO = isoDate(addDays(MONDAY, 4));
const POOL_NAME = `E2E Pool ${MONDAY_ISO}`;
const MONDAY2_ISO = isoDate(addDays(MONDAY, 7));
const TUESDAY2_ISO = isoDate(addDays(MONDAY, 8));

// How the calendar cell describes the accepted Tuesday (the raw ISO date rides the title).
const TUESDAY_CELL_TITLE = `AAA Two — ${TUESDAY_ISO}: Paid days off, Accepted (1 day)`;

async function sweepResidue(request: APIRequestContext) {
  // Admin: drop every stranded spec-created holiday, wherever a failed run left it.
  const adminAuth = authHeader(await apiToken(request, ADMIN));
  const holidays = (await (
    await request.get("/api/v1/public-holidays", { headers: adminAuth })
  ).json()) as { items: { id: number; name: string }[] };
  for (const h of holidays.items) {
    if (h.name.startsWith("E2E Holiday")) {
      await request.delete(`/api/v1/public-holidays/${h.id}`, { headers: adminAuth });
    }
  }
  // Admin: archive every stranded spec-created pool kind (v3.2.0) — archiving a kind also
  // archives every user's grant of it, so AAA Two's stranded pool goes with it, and the
  // kind's name is free for this run (the unique index covers active kinds only).
  const kinds = (await (
    await request.get("/api/v1/days-off/pool-types", { headers: adminAuth })
  ).json()) as { items: { id: number; name: string }[] };
  for (const k of kinds.items) {
    if (k.name.startsWith("E2E Pool")) {
      await request.delete(`/api/v1/days-off/pool-types/${k.id}`, { headers: adminAuth });
    }
  }

  // Owner: cancel AAA Two's stranded counting requests. Cancellation is date-free since
  // v2.31.0 (REQUESTED or ACCEPTED, past included) and always carries a mandatory reason.
  // Queried PER COUNTING STATUS (v3.2.0): the unfiltered own list sorts -startDate and pages
  // at 100, and the inert rejected/cancelled residue of earlier runs (windows spread over a
  // year) grew past that — this run's rows fell off page 1 and a pending pool request was
  // stranded (its archived pool then rendered as a second history strip).
  const ownAuth = authHeader(await apiToken(request, AAA_TWO));
  for (const status of ["REQUESTED", "ACCEPTED"]) {
    const requests = (await (
      await request.get(`/api/v1/days-off?view=own&status=${status}&pageSize=100`, { headers: ownAuth })
    ).json()) as { items: { id: number }[] };
    for (const r of requests.items) {
      await request.post(`/api/v1/days-off/${r.id}/cancel`, {
        headers: ownAuth,
        data: { reason: "e2e residue sweep" },
      });
    }
  }

  // Manager: drop AAA Two's stranded spec-created budget corrections. A run that dies between
  // adding the correction and the tail cleanup leaves one behind, and pickMonday's window
  // REPEATS every 40 minutes (`Date.now()/60_000 % 40`) — so a later run can pick the very same
  // Monday and add a second correction with an identical comment, which the modal then matches
  // twice (strict-mode violation on `E2E correction <MONDAY_ISO>`). Reading/deleting a
  // correction is a chain-manager right (v2.33.0; MANAGER_AAA is the direct one), so this leg runs as MANAGER_AAA; the owner's id
  // comes from the admin users list (GET /users/{id} is self-or-admin only).
  const mgrAuth = authHeader(await apiToken(request, MANAGER_AAA));
  const owners = (await (
    await request.get(`/api/v1/users?email=${encodeURIComponent(AAA_TWO)}&pageSize=1`, {
      headers: adminAuth,
    })
  ).json()) as { items: { id: number }[] };
  const ownerId = owners.items[0]?.id;
  if (ownerId != null) {
    const corrections = (await (
      await request.get(`/api/v1/days-off/corrections?userId=${ownerId}`, { headers: mgrAuth })
    ).json()) as { items: { id: number; comment: string }[] };
    for (const c of corrections.items) {
      if (c.comment.startsWith("E2E correction")) {
        await request.delete(`/api/v1/days-off/corrections/${c.id}`, { headers: mgrAuth });
      }
    }
  }
}

async function newRequest(
  page: Page,
  from: string,
  to: string,
  expectedCost: string,
  unpaid = false,
  poolName?: string,
) {
  await page.getByRole("link", { name: "New request" }).click();
  await expect(page).toHaveURL(/\/days-off\/new/);
  // The Type picker (v3.2.0) lists the person's paid pools beside Unpaid; the default pool
  // is pre-picked, so PAID-from-the-default touches nothing.
  if (unpaid || poolName) {
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: unpaid ? "Unpaid" : poolName, exact: true }).click();
  }
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await expect(page.getByText(`This request costs ${expectedCost} working day${expectedCost === "1" ? "" : "s"}.`)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/days-off") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Submit request" }).click(),
  ]);
  await expect(page).toHaveURL(/\/days-off\?tab=requests/);
}

test("days off end to end: holiday, allowance, request, resolve, calendar, cancel", async ({ page, request }) => {
  test.setTimeout(180_000);

  await sweepResidue(request);

  // ── Admin: a public holiday on the Monday + a generous allowance for AAA Two. ──
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  await page.goto("/public-holidays");
  await page.getByLabel("Date", { exact: true }).fill(MONDAY_ISO);
  await page.getByLabel("Name", { exact: true }).fill(`E2E Holiday ${MONDAY_ISO}`);
  await page.getByRole("button", { name: "Add holiday" }).click();
  // A residual holiday from a failed run answers 409 — either way the date is now covered.
  await expect(
    page
      .getByText("Public holiday added")
      .or(page.getByText("A holiday already exists on this date.")),
  ).toBeVisible();
  await expect(page.getByText(`E2E Holiday ${MONDAY_ISO}`).first()).toBeVisible();

  // ── Admin: the run's own paid pool kind (v3.2.0) — a non-carry-over one. ──
  await page.goto("/days-off-pools");
  await expect(page.getByRole("heading", { name: "Paid-leave pools" })).toBeVisible();
  await page.getByLabel("Pool name").fill(POOL_NAME);
  await page.getByLabel("Unused days carry over to the next year").uncheck();
  await page.getByRole("button", { name: "Add pool kind" }).click();
  // The holiday leg's duplicate tolerance: a stranded kind (a sweep race) answers 409.
  await expect(
    page.getByText("Pool kind added").or(page.getByText("A pool kind with that name already exists.")),
  ).toBeVisible();
  await expect(page.getByText(POOL_NAME).first()).toBeVisible();

  await logout(page);

  // ── Manager AAA: sets AAA Two's yearly allowance on the drill-down (v2.32.0 — the field
  // left the admin edit page; the chain-manager pencil beside the budget strip's Allowance).
  // Two saves on purpose: the second (299 → 300) is an ACTUAL change every run — an
  // idempotent re-PUT of 300 would mint no fresh bell for the notification assert below —
  // and its prefill of 299 proves the first save persisted.
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/?tab=subordinates");
  await page
    .locator("li", { hasText: "AAA Two" })
    .first()
    .getByRole("link", { name: "Days off of AAA Two" })
    .click();
  await expect(page).toHaveURL(/\/users\/\d+\/days-off/);
  await expect(page.getByText(/Paid days off of AAA Two in \d{4}/)).toBeVisible();
  await page.getByLabel("Edit the Paid days off allowance of AAA Two").click();
  await page.getByLabel(/^Allowance \(days per year\)/).fill("299");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Allowance saved")).toBeVisible();
  await page.getByLabel("Edit the Paid days off allowance of AAA Two").click();
  const allowanceInput = page.getByLabel(/^Allowance \(days per year\)/);
  await expect(allowanceInput).toHaveValue("299");
  await allowanceInput.fill("300");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  // The first toast may still be on screen (autoClose 2.5s) — first() dodges strict mode.
  await expect(page.getByText("Allowance saved").first()).toBeVisible();

  // ── Manager AAA: grants AAA Two the run's pool kind with 3 days (v3.2.0 — Add pool). ──
  await page.getByLabel("Add a paid pool for AAA Two").click();
  const addPool = page.getByRole("dialog");
  await addPool.getByRole("combobox", { name: /^Pool kind/ }).click();
  await page.getByRole("option", { name: POOL_NAME, exact: true }).click();
  await addPool.getByLabel(/^Allowance \(days per year\)/).fill("3");
  await addPool.getByRole("button", { name: "Add pool", exact: true }).click();
  await expect(page.getByText("Pool added")).toBeVisible();
  // The new strip renders beside the default one, flagged as a yearly-reset pool (first():
  // the managed table below prints pool names too, and an earlier run's cancelled row can
  // share this run's Monday — the 40-minute window repeats).
  await expect(page.getByText(POOL_NAME).first()).toBeVisible();
  await expect(page.getByText("resets yearly")).toBeVisible();
  await logout(page);

  // ── AAA Two: two requests — Mon(holiday)+Tue = 1 day, next Mon+Tue = 2 days. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=requests");
  await expect(page.getByText(/Your paid days off in \d{4}/)).toBeVisible();
  await newRequest(page, MONDAY_ISO, TUESDAY_ISO, "1");
  await expect(page.getByText("Days-off request submitted")).toBeVisible();
  await newRequest(page, MONDAY2_ISO, TUESDAY2_ISO, "2");
  // Both rows sit in My requests as pending.
  await expect(page.locator("tr", { hasText: "Requested" }).first()).toBeVisible();
  // ── The extra-pool leg (v3.2.0): the own budget card lists the granted pool, the Type
  // picker offers it, the row names it — then it is cancelled again (the pool's history
  // stays counted but a cancelled row is inert). ──
  await expect(page.getByText(POOL_NAME).first()).toBeVisible();
  await newRequest(page, FRIDAY_ISO, FRIDAY_ISO, "1", false, POOL_NAME);
  // The page-1 rule again (far-future residue outranks this run's rows in the -startDate
  // sort): filter to Requested before looking for the fresh row (step 10 re-sets the filter).
  const poolFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await poolFilters.getAttribute("aria-expanded")) !== "true") await poolFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Requested" }).click();
  await expect(page.locator("tr", { hasText: POOL_NAME }).first()).toBeVisible();
  await page.getByLabel(`Cancel your days-off request starting ${FRIDAY_ISO}`).click();
  await page.getByRole("dialog").getByLabel(/^Reason/).fill("Pool leg done — e2e");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel the request", exact: true })
    .click();
  await expect(page.getByText("Request cancelled")).toBeVisible();
  await logout(page);

  // ── Manager AAA: the bell heard about it; accept one, reject the other. ──
  await login(page, MANAGER_AAA);
  const dialog = await openBell(page);
  await expect(notificationCard(dialog, "AAA Two requested time off")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/days-off?tab=team");
  // Residue-proof (v1.51.0): rejected/cancelled leftovers from earlier runs carry far-future
  // Mondays that outrank this run's rows in the From-sorted table — once they fill page 1,
  // the fresh pending rows fall off it. Filter the team view to Requested (the sweep already
  // cancelled any stranded pending rows, so only this run's two remain).
  const teamFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await teamFilters.getAttribute("aria-expanded")) !== "true") await teamFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Requested" }).click();
  await page
    .getByLabel(`Accept the days-off request of AAA Two starting ${MONDAY_ISO}`)
    .click();
  await expect(page.getByText("Request accepted")).toBeVisible();
  await page
    .getByLabel(`More actions for the days-off request of AAA Two starting ${MONDAY2_ISO}`)
    .click();
  await page
    .getByRole("menuitem", { name: `Reject the days-off request of AAA Two starting ${MONDAY2_ISO}` })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Request rejected")).toBeVisible();

  // The subordinate card now shows the accepted vacation (v1.44.0) and links to the
  // per-user days-off view, where the same request sits Accepted with the budget strip.
  await page.goto("/?tab=subordinates");
  const aaaTwoCard = page.locator("li", { hasText: "AAA Two" }).first();
  await expect(aaaTwoCard.getByText("Next vacation")).toBeVisible();
  const mondayFormatted = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(`${MONDAY_ISO}T00:00:00`),
  );
  await expect(aaaTwoCard.getByText(mondayFormatted)).toBeVisible();
  await expect(aaaTwoCard.getByText("Days-off budget left")).toBeVisible();
  await aaaTwoCard.getByRole("link", { name: "Days off of AAA Two" }).click();
  await expect(page).toHaveURL(/\/users\/\d+\/days-off/);
  await expect(page.getByRole("heading", { name: "Days off of AAA Two" })).toBeVisible();
  await expect(page.getByText(/Paid days off of AAA Two in \d{4}/)).toBeVisible();
  // Residue-proof (v1.52.0): the drill-down table pages at 20 From-desc, and far-future
  // rejected/cancelled residue from earlier runs fills page 1 — filter to Accepted before
  // asserting (the page-1 rule for shared-DB tables).
  const drillFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await drillFilters.getAttribute("aria-expanded")) !== "true") await drillFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Accepted" }).click();
  await expect(page.locator("tr", { hasText: "Accepted" }).first()).toBeVisible();
  await logout(page);

  // ── AAA Two: sees the outcomes, the calendar bar, then cancels the accepted request. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  const ownBell = await openBell(page);
  await expect(
    notificationCard(ownBell, "Manager AAA accepted your days-off request"),
  ).toBeVisible();
  await expect(
    notificationCard(ownBell, "Manager AAA rejected your days-off request"),
  ).toBeVisible();
  // The allowance change (v2.32.0) told the owner too — the 299→300 save is an actual
  // change every run, so this run always minted a fresh card.
  await expect(
    notificationCard(ownBell, 'Manager AAA set your yearly "Paid days off" allowance to 300'),
  ).toBeVisible();
  // The extra-pool grant (v3.2.0) is the same event naming its pool.
  await expect(
    notificationCard(ownBell, `Manager AAA set your yearly "${POOL_NAME}" allowance to 3`),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/days-off?tab=requests");
  // Residue-proof (v1.52.0): same page-1 rule on the own-requests table. Check Rejected
  // first, then leave the filter on Accepted so the cancel step below still finds its row
  // (the stored filter survives the re-goto).
  const ownFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await ownFilters.getAttribute("aria-expanded")) !== "true") await ownFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Rejected" }).click();
  await expect(page.locator("tr", { hasText: "Rejected" }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Accepted" }).click();
  await expect(page.locator("tr", { hasText: "Accepted" }).first()).toBeVisible();

  // Page the calendar forward to the ASSERTED TUESDAY's month (not Monday's — a window
  // starting on a month's last Monday puts the Tuesday in the NEXT month, the latent
  // Nov-30/Dec-1 flake) and find the accepted Tuesday's bar.
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("table", { name: "Team days-off calendar" })).toBeVisible();
  const now = new Date();
  const tuesday = addDays(MONDAY, 1);
  const monthSteps =
    (tuesday.getFullYear() - now.getFullYear()) * 12 + (tuesday.getMonth() - now.getMonth());
  for (let i = 0; i < monthSteps; i += 1) {
    await page.getByLabel("Next month").click();
  }
  await expect(page.locator(`[title="${TUESDAY_CELL_TITLE}"]`)).toBeVisible();

  // Cancel the accepted (still future) request — the reserved days return to the budget.
  await page.goto("/days-off?tab=requests");
  await page.getByLabel(`Cancel your days-off request starting ${MONDAY_ISO}`).click();
  // The mandatory reason (v2.31.0): the confirm is a required-textarea modal now.
  await page.getByRole("dialog").getByLabel(/^Reason/).fill("Plans changed — e2e");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel the request", exact: true })
    .click();
  await expect(page.getByText("Request cancelled")).toBeVisible();

  // ── The UNPAID variant: same working-day cost preview, but the paid budget is untouched. ──
  const budgetStrip = page.getByText(/Your paid days off in \d{4}/);
  const budgetBefore = await budgetStrip.innerText();
  await newRequest(page, WEDNESDAY_ISO, WEDNESDAY_ISO, "1", true);
  // The stored Status filter still says Accepted — flip it to Requested to see the fresh row.
  const unpaidFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await unpaidFilters.getAttribute("aria-expanded")) !== "true") await unpaidFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Requested" }).click();
  await expect(page.locator("tr", { hasText: "Unpaid" }).first()).toBeVisible();
  await expect(budgetStrip).toHaveText(budgetBefore);
  // Cancel it again so seed accounts keep no counting rows.
  await page.getByLabel(`Cancel your days-off request starting ${WEDNESDAY_ISO}`).click();
  // The mandatory reason (v2.31.0): the confirm is a required-textarea modal now.
  await page.getByRole("dialog").getByLabel(/^Reason/).fill("Not needed — e2e");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel the request", exact: true })
    .click();
  await expect(page.getByText("Request cancelled")).toBeVisible();
  await logout(page);

  // ── Manager: records days off ON BEHALF of AAA Two (v2.29.0) — born Accepted. ──
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=team");
  await page.getByRole("link", { name: "New days off" }).click();
  await expect(page).toHaveURL(/\/days-off\/new\?onBehalf=1/);
  await pickSelectOption(page, "On behalf of", "AAA Two");
  await page.getByLabel("From", { exact: true }).fill(THURSDAY_ISO);
  await page.getByLabel("To", { exact: true }).fill(THURSDAY_ISO);
  await expect(page.getByText("This request costs 1 working day.")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/days-off") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Submit auto-accepted" }).click(),
  ]);
  await expect(page).toHaveURL(/\/days-off\?tab=team/);
  await expect(page.getByText("Days off recorded and accepted")).toBeVisible();
  // The acting manager keeps a durable receipt in their own bell.
  const recordBell = await openBell(page);
  await expect(
    notificationCard(recordBell, "You recorded days off on behalf of AAA Two"),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // ── Manager: a +2 budget correction for AAA Two (v1.43.0). ──
  await page.goto("/days-off?tab=team");
  await page.getByRole("radio", { name: "Budgets" }).click();
  await page.getByLabel("Budget corrections of AAA Two").click();
  const correctionsModal = page.getByRole("dialog");
  await expect(correctionsModal.getByText("Add correction").first()).toBeVisible();
  await correctionsModal.getByLabel("Days").fill("2");
  await correctionsModal.getByLabel("Comment").fill(`E2E correction ${MONDAY_ISO}`);
  await correctionsModal.getByRole("button", { name: "Add correction" }).click();
  await expect(page.getByText("Correction added")).toBeVisible();
  await expect(correctionsModal.getByText(`E2E correction ${MONDAY_ISO}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // ── AAA Two: sees the correction read-only + the bell notification. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  const corrBell = await openBell(page);
  await expect(
    notificationCard(corrBell, 'added 2 day(s) to your "Paid days off" budget'),
  ).toBeVisible();
  // The on-behalf recording (v2.29.0) also reached the owner's bell.
  await expect(
    notificationCard(corrBell, "Manager AAA recorded days off on your behalf"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/days-off?tab=requests");
  await page.getByRole("button", { name: "Corrections" }).click();
  const ownModal = page.getByRole("dialog");
  await expect(ownModal.getByText(`E2E correction ${MONDAY_ISO}`)).toBeVisible();
  // Read-only: no add form, no per-row actions.
  await expect(ownModal.getByRole("button", { name: "Add correction" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await logout(page);

  // ── Cleanup — and the v2.31.0 manager-side cancel: Manager AAA (a chain manager of the
  // owner) cancels the recorded Accepted entry with a reason, keeps the bell receipt, and
  // the cancelled row grows the reason popover. Seed accounts keep no counting rows. ──
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=team");
  // The team view is remembered per device — the Budgets pick above would still hold.
  await page.getByRole("radio", { name: "Requests" }).click();
  const cleanupFilters = page.getByRole("button", { name: /^Filters/ });
  if ((await cleanupFilters.getAttribute("aria-expanded")) !== "true") await cleanupFilters.click();
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Accepted" }).click();
  await page.getByLabel(`Cancel AAA Two's days-off request starting ${THURSDAY_ISO}`).click();
  await page.getByRole("dialog").getByLabel(/^Reason/).fill("Recorded in error — e2e");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel the request", exact: true })
    .click();
  await expect(page.getByText("Request cancelled")).toBeVisible();
  // The cancelled row's reason popover (flip the filter to Cancelled to find it). Two
  // residue defenses: the table renders LOCALIZED dates, not ISO (match the app's
  // formatIsoDate — en, dateStyle medium), and cancelled rows are PERMANENT records, so
  // earlier runs' residue outranks this run's row under the default -startDate sort —
  // sort by "Requested on" descending instead (this run's rows are the newest created).
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Cancelled" }).click();
  await page.getByRole("button", { name: "Requested on" }).click();
  await page.getByRole("button", { name: "Requested on" }).click();
  const thursdayFormatted = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(`${THURSDAY_ISO}T00:00:00`),
  );
  const cancelledRow = page.locator("tr", { hasText: thursdayFormatted }).first();
  await cancelledRow.getByLabel("Cancellation reason").click();
  await expect(page.getByText("Recorded in error — e2e")).toBeVisible();
  await expect(page.getByText(/Manager AAA ·/)).toBeVisible();
  await page.keyboard.press("Escape");
  // The acting manager's bell receipt.
  const receiptBell = await openBell(page);
  await expect(
    notificationCard(receiptBell, "You cancelled AAA Two's days-off request"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // The rest of the cleanup: delete the correction, then the admin removes the holiday.
  await page.getByLabel("Budget corrections of AAA Two").click();
  const cleanupModal = page.getByRole("dialog");
  await cleanupModal.getByRole("button", { name: /^Delete the correction/ }).first().click();
  // The confirm modal stacks on top — its Delete is the last one.
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(page.getByText("Correction deleted")).toBeVisible();
  await page.keyboard.press("Escape");
  // The manager archives AAA Two's extra pool on the drill-down (v3.2.0 — the default pool
  // has no such control); the cancelled Friday leaves no counting history, so the strip
  // simply disappears.
  await page.goto("/?tab=subordinates");
  await page
    .locator("li", { hasText: "AAA Two" })
    .first()
    .getByRole("link", { name: "Days off of AAA Two" })
    .click();
  await page.getByLabel(`Archive the ${POOL_NAME} pool of AAA Two`).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Pool archived")).toBeVisible();
  await expect(page.getByLabel("Edit the Paid days off allowance of AAA Two")).toBeVisible();
  await expect(page.getByLabel(`Archive the ${POOL_NAME} pool of AAA Two`)).toHaveCount(0);
  await logout(page);

  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  // The admin archives the run's pool kind (the row's ⋯ menu → the registry's archive confirm).
  await page.goto("/days-off-pools");
  await page.getByRole("button", { name: `More actions for ${POOL_NAME}` }).click();
  await page.getByRole("menuitem", { name: `Archive the ${POOL_NAME} pool kind` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText("Pool kind archived")).toBeVisible();
  await expect(page.getByText(POOL_NAME)).toHaveCount(0);
  await page.goto("/public-holidays");
  const holidayRow = page.locator("tr", { hasText: `E2E Holiday ${MONDAY_ISO}` }).last();
  await holidayRow.getByRole("button", { name: /^Delete the holiday/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Public holiday deleted")).toBeVisible();
  await logout(page);
});
