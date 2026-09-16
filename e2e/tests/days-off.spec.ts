import {
  AAA_ONE,
  AAA_TWO,
  ADMIN,
  collapseAlertsBanner,
  expect,
  fillDate,
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

// Days off end to end, rewritten for v3.9.0 (the approval lifecycle is gone): the admin curates
// a public holiday, Manager AAA sets AAA Two's yearly allowance on the per-user drill-down
// (v2.32.0 — the chain-manager right; the admin edit page lost the field), AAA Two books two
// entries directly (no request/accept step — the entry IS active the moment it's created), a
// teammate (AAA One, not the manager) sees the CREATE fan-out on their bell, AAA Two deletes one
// entry themselves (the owner's own right, no reason required), and the direct manager sees the
// DELETE fan-out too. Since v3.2.0 the paid days come in POOLS: the admin adds a run-specific
// "E2E Pool" kind on the Config registry, the manager grants it to AAA Two (Add pool on the
// drill-down), and AAA Two books one entry from it (the Type picker lists the pool). The manager
// also records a day ON BEHALF of AAA Two (v2.29.0, kept — just a plain entry now, no
// "auto-accepted" wording), which the MANAGER deletes at the end (the chain-wide delete right
// that replaced the mandatory-reason manager-side cancel). A budget correction (v1.43.0) rides
// along unchanged.
//
// The request window is a run-specific future Monday (weeks vary per run), so residue from a
// failed earlier run rarely collides via the overlap rule — but the sweep below is what
// actually guarantees a clean slate: a mid-run failure skips the tail cleanup, stranding the
// run's "E2E Holiday" (which silently changes a LATER run's cost preview when its window
// happens to cover that date — the 2027-05-24 incident, checkup #16) and AAA Two's still-active
// entries. Both are removed via the API before the UI legs (the global-setup seed-pair idiom),
// so the suite self-heals on the next run no matter where a run died.

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

/** A future Monday 4–43 weeks out (varies per run-minute); the booked week must stay inside one
 * calendar year (the same-year rule) and clear of the seeded holidays (their zero cost would
 * break the expected numbers). */
function pickMonday(): Date {
  let monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7)); // next Monday
  const weeks = 4 + (Math.floor(Date.now() / 60_000) % 40);
  monday = addDays(monday, weeks * 7);
  const windowBlocked = (m: Date) =>
    m.getFullYear() !== addDays(m, 4).getFullYear() ||
    // Offsets 0/1 are the default-pool Mon–Tue entry; 3 is the manager's on-behalf Thursday
    // (v2.29.0); 4 is the extra-pool Friday (v3.2.0).
    [0, 1, 3, 4].some((offset) => SEEDED_HOLIDAYS.has(isoDate(addDays(m, offset))));
  while (windowBlocked(monday)) {
    monday = addDays(monday, 7);
  }
  return monday;
}

const MONDAY = pickMonday();
const MONDAY_ISO = isoDate(MONDAY);
const TUESDAY_ISO = isoDate(addDays(MONDAY, 1));
// The manager's on-behalf leg (v2.29.0) books this day for AAA Two — same booked week, no
// overlap (distinct dates from the other two entries).
const THURSDAY_ISO = isoDate(addDays(MONDAY, 3));
// The extra-pool leg (v3.2.0) books this day from the run's own pool kind.
const FRIDAY_ISO = isoDate(addDays(MONDAY, 4));
const POOL_NAME = `E2E Pool ${MONDAY_ISO}`;

// How the calendar cell describes the still-active Tuesday (the raw ISO date rides the title;
// no status wording since v3.9.0 — there is no lifecycle left to name).
const TUESDAY_CELL_TITLE = `AAA Two — ${TUESDAY_ISO}: Paid days off (1 day)`;

const enMedium = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));

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

  // Owner: delete every one of AAA Two's still-active entries (v3.9.0 — soft delete replaced
  // accept/reject/cancel; there is no status to filter on anymore, so a plain view=own fetch
  // catches everything, including anything a manager recorded on AAA Two's behalf, since
  // view=own is keyed on ownership, not on who created the row).
  const ownAuth = authHeader(await apiToken(request, AAA_TWO));
  const own = (await (
    await request.get("/api/v1/days-off?view=own&pageSize=100", { headers: ownAuth })
  ).json()) as { items: { id: number }[] };
  for (const r of own.items) {
    await request.delete(`/api/v1/days-off/${r.id}`, { headers: ownAuth });
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

/** AAA Two's self-create entry, through the header's "New days off" button — there is no
 * request/accept step since v3.9.0, so the "expected" here is simply that the entry lands on
 * "My days off" the moment it's submitted. */
async function newEntry(
  page: Page,
  from: string,
  to: string,
  expectedCost: string,
  poolName?: string,
) {
  await page.getByRole("link", { name: "New days off" }).click();
  await expect(page).toHaveURL(/\/days-off\/new/);
  // The Type picker (v3.2.0) lists the person's paid pools beside Unpaid; the default pool is
  // pre-picked, so a default-pool entry touches nothing here.
  if (poolName) {
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: poolName, exact: true }).click();
  }
  await fillDate(page, "From", from);
  await fillDate(page, "To", to);
  await expect(
    page.getByText(`This entry costs ${expectedCost} working day${expectedCost === "1" ? "" : "s"}.`),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/days-off") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Submit", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/days-off\?tab=requests/);
  // A prior entry's success toast may still be lingering when this helper runs again in the
  // same test (toasts stack), so assert at least one is present rather than exactly one.
  await expect(page.getByText("Days off added").first()).toBeVisible();
}

test("days off end to end: holiday, allowance, entries, delete, calendar", async ({ page, request }) => {
  test.setTimeout(180_000);

  await sweepResidue(request);

  // ── Admin: a public holiday on the Monday + a generous allowance for AAA Two. ──
  await login(page, ADMIN);
  await collapseAlertsBanner(page);
  await page.goto("/public-holidays");
  await fillDate(page, "Date", MONDAY_ISO);
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
  // idempotent re-save of 300 would mint no fresh bell for a notification assert elsewhere —
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
  await expect(page.getByText(POOL_NAME).first()).toBeVisible();
  await expect(page.getByText("resets yearly")).toBeVisible();
  await logout(page);

  // ── AAA Two: two entries — Mon(holiday)+Tue from the default pool, Fri from the extra pool.
  // No request/accept step since v3.9.0: each entry is active on "My days off" the instant it's
  // submitted. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=requests");
  await expect(page.getByText(/Your paid days off in \d{4}/)).toBeVisible();
  await newEntry(page, MONDAY_ISO, TUESDAY_ISO, "1");
  const mondayFormatted = enMedium(MONDAY_ISO);
  await expect(page.locator("tr", { hasText: mondayFormatted }).first()).toBeVisible();
  // The extra-pool leg (v3.2.0): the own budget card already lists the granted pool, the Type
  // picker offers it, and the fresh row names it.
  await expect(page.getByText(POOL_NAME).first()).toBeVisible();
  await newEntry(page, FRIDAY_ISO, FRIDAY_ISO, "1", POOL_NAME);
  const fridayFormatted = enMedium(FRIDAY_ISO);
  await expect(page.locator("tr", { hasText: POOL_NAME }).first()).toBeVisible();
  await logout(page);

  // ── Manager AAA: the subordinate card counts the entry immediately — nothing to accept. ──
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/?tab=subordinates");
  const aaaTwoCard = page.locator("li", { hasText: "AAA Two" }).first();
  await expect(aaaTwoCard.getByText("Next vacation")).toBeVisible();
  await expect(aaaTwoCard.getByText(mondayFormatted)).toBeVisible();
  await expect(aaaTwoCard.getByText("Days-off budget left")).toBeVisible();
  await logout(page);

  // ── AAA One — AAA Two's TEAMMATE, not their manager — sees the CREATE fan-out (v3.9.0: the
  // whole team, not just the direct manager). ──
  await login(page, AAA_ONE);
  const teammateBell = await openBell(page);
  await expect(notificationCard(teammateBell, "AAA Two added a day off")).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // ── AAA Two: deletes the Friday pool entry themselves — the owner's own right, no reason
  // required (unlike the pre-v3.9.0 mandatory-reason cancel). ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=requests");
  await page.getByLabel(`Delete your days-off entry starting ${FRIDAY_ISO}`).click();
  await expect(page.getByText("Delete this days-off entry?")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel(/^Reason/)).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Days-off entry deleted")).toBeVisible();
  await expect(page.locator("tr", { hasText: fridayFormatted })).toHaveCount(0);
  await logout(page);

  // ── Manager AAA: sees the DELETE fan-out too — the direct manager reads it the same way. ──
  await login(page, MANAGER_AAA);
  const deleteBell = await openBell(page);
  await expect(notificationCard(deleteBell, "AAA Two deleted a day off")).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // ── AAA Two: the calendar still marks the active Tuesday — no status wording (v3.9.0). ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=requests");
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page.getByRole("table", { name: "Team days-off calendar" })).toBeVisible();
  // Page the calendar forward to the ASSERTED TUESDAY's month (not Monday's — a window
  // starting on a month's last Monday puts the Tuesday in the NEXT month, the latent
  // Nov-30/Dec-1 flake) and find the active Tuesday's bar.
  const now = new Date();
  const tuesday = addDays(MONDAY, 1);
  const monthSteps =
    (tuesday.getFullYear() - now.getFullYear()) * 12 + (tuesday.getMonth() - now.getMonth());
  for (let i = 0; i < monthSteps; i += 1) {
    await page.getByLabel("Next month").click();
  }
  await expect(page.locator(`[title="${TUESDAY_CELL_TITLE}"]`)).toBeVisible();
  await logout(page);

  // ── Manager: records days off ON BEHALF of AAA Two (v2.29.0, kept) — a plain active entry,
  // no "auto-accepted" wording since there is no acceptance step anymore. ──
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=team");
  await page.getByRole("link", { name: "Record days off" }).click();
  await expect(page).toHaveURL(/\/days-off\/new\?onBehalf=1/);
  await pickSelectOption(page, "On behalf of", "AAA Two");
  await fillDate(page, "From", THURSDAY_ISO);
  await fillDate(page, "To", THURSDAY_ISO);
  await expect(page.getByText("This entry costs 1 working day.")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/days-off") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Submit", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/days-off\?tab=team/);
  await expect(page.getByText("Days off recorded")).toBeVisible();
  const thursdayFormatted = enMedium(THURSDAY_ISO);
  await expect(page.locator("tr", { hasText: thursdayFormatted }).first()).toBeVisible();

  // ── Manager: a +2 budget correction for AAA Two (v1.43.0, unchanged). ──
  await page.getByText("Budgets", { exact: true }).click();
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

  // ── AAA Two: the on-behalf entry reached them through the SAME team fan-out as any other
  // create — no dedicated on-behalf receipt anymore — plus the correction notification and the
  // allowance-change ones (v2.32.0). The fan-out card names the OWNER (whose absence it is), not
  // the acting manager, so an on-behalf create reads "AAA Two added a day off" like any other.
  // Then the read-only Corrections view, then cleanup: AAA Two deletes their own remaining
  // Monday–Tuesday entry. ──
  await login(page, AAA_TWO);
  await collapseAlertsBanner(page);
  const ownBell = await openBell(page);
  await expect(notificationCard(ownBell, "AAA Two added a day off")).toBeVisible();
  await expect(
    notificationCard(ownBell, 'added 2 day(s) to your "Paid days off" budget'),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/days-off?tab=requests");
  await page.getByRole("button", { name: "Corrections" }).click();
  const ownModal = page.getByRole("dialog");
  await expect(ownModal.getByText(`E2E correction ${MONDAY_ISO}`)).toBeVisible();
  // Read-only: no add form, no per-row actions.
  await expect(ownModal.getByRole("button", { name: "Add correction" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByLabel(`Delete your days-off entry starting ${MONDAY_ISO}`).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Days-off entry deleted")).toBeVisible();
  await logout(page);

  // ── Cleanup — and the v3.9.0 chain-manager delete: Manager AAA (a chain manager of the
  // owner) deletes the recorded Thursday entry from the Team tab's Entries view, no reason
  // required. Then the rest of the cleanup: the correction, the pool grant, the pool kind, and
  // the holiday. ──
  await login(page, MANAGER_AAA);
  await collapseAlertsBanner(page);
  await page.goto("/days-off?tab=team");
  await page.getByText("Entries", { exact: true }).click();
  await page.getByLabel(`Delete AAA Two's days-off entry starting ${THURSDAY_ISO}`).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Days-off entry deleted")).toBeVisible();
  await expect(page.locator("tr", { hasText: thursdayFormatted })).toHaveCount(0);

  await page.getByText("Budgets", { exact: true }).click();
  await page.getByLabel("Budget corrections of AAA Two").click();
  const cleanupModal = page.getByRole("dialog");
  await cleanupModal.getByRole("button", { name: /^Delete the correction/ }).first().click();
  // The confirm modal stacks on top — its Delete is the last one.
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(page.getByText("Correction deleted")).toBeVisible();
  await page.keyboard.press("Escape");
  // The manager archives AAA Two's extra pool on the drill-down (v3.2.0 — the default pool
  // has no such control); no counting entries remain, so the strip simply disappears.
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
