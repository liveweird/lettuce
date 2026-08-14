import type { APIRequestContext, Page } from "@playwright/test";
import {
  test,
  expect,
  login,
  logout,
  openBell,
  notificationCard,
  uniqueText,
  ADMIN,
  AAA_ONE,
  AAA_TWO,
  AAA_THREE,
  MANAGER_AAA,
  MANAGER_CCC,
  PASSWORD,
} from "./helpers";

// Pulse surveys (v2.0.0), the whole lifecycle through the real UI. This spec runs in its OWN
// serial phase (playwright.config.ts `pulse` project, after `alerts`): scheduling/opening a
// cycle sprays notifications at EVERY user's bell, and the one-non-terminal-cycle registry is
// global — no other spec may run concurrently. Within the file the tests are ordered steps of
// one flow (schedule → open → fill → monitor → close → results → cancel path); the registry
// is swept at the start and left terminal at the end, so reruns on the shared dev DB self-heal
// (each run leaves one more CLOSED cycle behind — the results asserts therefore always pin the
// CURRENT cycle via the notification deep link / latest-closed default, never cycle #1).

async function apiLogin(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post("/api/v1/login", { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

/** Cancels any SCHEDULED/OPEN cycle a previous (failed) run stranded — the registry admits
 *  only one non-terminal cycle, so residue would 409 this run's schedule. */
async function sweepNonTerminalCycles(request: APIRequestContext): Promise<void> {
  const token = await apiLogin(request, ADMIN);
  const auth = { Authorization: `Bearer ${token}` };
  const cycles = (await (await request.get("/api/v1/pulse-surveys/cycles", { headers: auth })).json()) as {
    items: { id: number; status: string }[];
  };
  for (const cycle of cycles.items) {
    if (cycle.status === "SCHEDULED" || cycle.status === "OPEN") {
      await request.post(`/api/v1/pulse-surveys/cycles/${cycle.id}/cancel`, { headers: auth });
    }
  }
}

/** Finds the single OPEN cycle's id over the API (the spec's own phase guarantees it). */
async function openCycleId(request: APIRequestContext, token: string): Promise<number> {
  const cycles = (await (
    await request.get("/api/v1/pulse-surveys/cycles", { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { items: { id: number; status: string }[] };
  const open = cycles.items.find((c) => c.status === "OPEN");
  expect(open).toBeTruthy();
  return open!.id;
}

async function apiFillSurvey(
  request: APIRequestContext,
  email: string,
  enps: number,
  comment?: string,
): Promise<void> {
  const token = await apiLogin(request, email);
  const cycleId = await openCycleId(request, token);
  const res = await request.put(`/api/v1/pulse-surveys/cycles/${cycleId}/my-response`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { enps, q2: "4", q3: "3", q4: "4", q5: "NA", rotating: "3", ...(comment ? { comment } : {}) },
  });
  expect(res.status()).toBe(204);
}

// One unique comment per run — asserted verbatim in the manager's anonymized comments view.
const COMMENT = uniqueText("E2E pulse comment");

/** Picks an eNPS chip by clicking its visible LABEL — the Chip's radio input itself is
 *  rendered off-viewport (the hidden-input Mantine gotcha), so role-based clicks never land. */
async function pickEnps(page: Page, score: number): Promise<void> {
  await page
    .locator("label.mantine-Chip-label")
    .filter({ hasText: new RegExp(`^${score}$`) })
    .click();
}

/** Answers the wizard's currently visible agreement question with "Agree". Scoped to
 *  #main-content — the header's Language switcher is a radiogroup too — clicking the visible
 *  label (the radio inputs hide under Mantine's styling). */
async function answerVisibleQuestion(page: Page): Promise<void> {
  await page
    .locator("#main-content")
    .getByRole("radiogroup")
    .getByText("Agree", { exact: true })
    .click();
}

test("admin schedules a cycle (prefilled dates) and opens it", async ({ page, request }) => {
  await sweepNonTerminalCycles(request);
  await login(page, ADMIN);
  await page.goto("/pulse-cycles");
  // The settings section proves the runtime store roundtrip (values whatever they are).
  await expect(page.getByText("Weeks between cycles")).toBeVisible();

  // Schedule with the prefilled dates (latest cycle + cadence; today on a fresh DB) — wait
  // for the prefill to resolve, or the click races the settings/cycles queries and the empty
  // dates fail client-side validation without ever POSTing.
  await expect(page.getByLabel("Open date", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "Schedule cycle" }).click();
  await expect(page.getByText("Cycle scheduled")).toBeVisible();
  await expect(page.getByText("Scheduled", { exact: true })).toBeVisible();

  // Open it via the confirmed lifecycle action.
  await page.getByRole("button", { name: /Open cycle \d+/ }).click();
  await page.getByRole("button", { name: "Open now" }).click();
  await expect(page.getByText("Cycle opened")).toBeVisible();
  await expect(page.getByText("Open", { exact: true })).toBeVisible();
});

test("a participant is notified, walks the wizard, and edits it while open", async ({ page }) => {
  await login(page, AAA_ONE);
  // The opened notification is in the bell (text repeats across reruns — take the newest).
  const dialog = await openBell(page);
  await expect(notificationCard(dialog, "The pulse survey is open").first()).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/pulse");
  // The wizard (v2.5.9): one question per step, explicit Next after every answer —
  // answering never auto-advances.
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  await expect(page.getByText("0 of 6 answered")).toBeVisible();
  await pickEnps(page, 9);
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  for (let stepNo = 2; stepNo <= 6; stepNo++) {
    await expect(page.getByText(`Question ${stepNo} of 7`)).toBeVisible();
    await answerVisibleQuestion(page);
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText("Question 7 of 7")).toBeVisible();
  await expect(page.getByText("6 of 6 answered")).toBeVisible();
  // The promoter-band comment prompt (eNPS 9).
  await expect(page.getByText("What should we make sure to preserve?")).toBeVisible();
  await page.getByRole("button", { name: "Submit survey" }).click();
  await expect(page.getByText("Survey submitted")).toBeVisible();

  // A successful save lands on the saved-summary screen (v2.5.9); "Edit my answers"
  // reopens the wizard at Q1 prefilled — change the answer, Next through, save again.
  await expect(page.getByText(/Your answers are saved/)).toBeVisible();
  await page.getByRole("button", { name: "Edit my answers" }).click();
  await expect(page.getByText("Question 1 of 7")).toBeVisible();
  await pickEnps(page, 10);
  for (let stepNo = 2; stepNo <= 7; stepNo++) {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(`Question ${stepNo} of 7`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Survey submitted")).toBeVisible();
  // And back on the summary after the re-save.
  await expect(page.getByText(/Your answers are saved/)).toBeVisible();
});

test("the manager monitors participation live while the cycle is open", async ({ page, request }) => {
  // A second respondent over the API (the route the SPA uses) — AAA Three stays pending.
  await apiFillSurvey(request, AAA_TWO, 8);

  await login(page, MANAGER_AAA);
  await page.goto("/pulse?tab=participation");
  const rows = page.getByRole("table");
  await expect(rows.getByText("AAA One")).toBeVisible();
  // Submitted yes/no only — never content.
  const rowFor = (name: string) => page.getByRole("row").filter({ hasText: name });
  await expect(rowFor("AAA One").getByText("Submitted")).toBeVisible();
  await expect(rowFor("AAA Two").getByText("Submitted")).toBeVisible();
  await expect(rowFor("AAA Three").getByText("Not yet")).toBeVisible();
});

test("admin closes; a respondent reads team results; the non-responding manager still reads comments", async ({
  page,
  request,
}) => {
  // Third respondent (k >= 3) with this run's unique comment. Manager CCC responds too —
  // they are a member of NO team, so no scope's hand-computed numbers move; it just passes
  // the fill gate for the sub-team comparison leg below (v2.10.0).
  await apiFillSurvey(request, AAA_THREE, 2, COMMENT);
  await apiFillSurvey(request, MANAGER_CCC, 8);

  await login(page, ADMIN);
  await page.goto("/pulse-cycles");
  await page.getByRole("button", { name: /Close cycle \d+/ }).click();
  await page.getByRole("button", { name: "Close now" }).click();
  await expect(page.getByText("Cycle closed")).toBeVisible();
  await logout(page);

  // The respondent follows the results notification (deep-linked to THIS cycle).
  await login(page, AAA_ONE);
  const dialog = await openBell(page);
  await expect(notificationCard(dialog, "Pulse survey results are available.").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/pulse?tab=results");
  await expect(page.getByRole("heading", { name: "AAA", exact: true })).toBeVisible();
  await expect(page.getByText("3 of 3 responded (100%)")).toBeVisible();
  await expect(page.getByText("eNPS", { exact: true })).toBeVisible();

  // Hand-computed aggregates for THIS cycle's known answers (v2.6.2 — the numbers, not
  // just the labels, verified through submit → encrypt → store → decrypt → aggregate →
  // render). eNPS {10, 8, 2} = 1 promoter / 1 passive / 1 detractor → score 0, thirds.
  // Deltas are deliberately NOT asserted: a shared-DB rerun has a previous cycle, CI doesn't.
  const card = page.locator(".mantine-Paper-root").filter({ hasText: "eNPS" }).first();
  // The headline is a Mantine Text (<p>); plain getByText would also match the trend
  // chart's y-axis "0" tick once a second closed cycle makes the chart render (reruns).
  await expect(card.getByRole("paragraph").filter({ hasText: /^0$/ })).toBeVisible();
  await expect(card.getByText(/Promoters 33\.3%/)).toBeVisible();
  await expect(card.getByText(/Passives 33\.3%/)).toBeVisible();
  await expect(card.getByText(/Detractors 33\.3%/)).toBeVisible();
  // Q2 {4,4,4}: mean 4.0, favorable 100.0%, n 3.
  const q2Row = card.locator("tr").filter({ hasText: "I understand what is expected" });
  await expect(q2Row.getByText("4.0", { exact: true })).toBeVisible();
  await expect(q2Row.getByText("100.0%", { exact: true })).toBeVisible();
  // Q3 {4,3,3}: mean 10/3 → 3.3, favorable 33.3%.
  const q3Row = card.locator("tr").filter({ hasText: "I receive the support" });
  await expect(q3Row.getByText("3.3", { exact: true })).toBeVisible();
  await expect(q3Row.getByText("33.3%", { exact: true })).toBeVisible();
  // Q5 {4, NA, NA}: the two NAs leave the mean but shrink n to 1.
  const q5Row = card.locator("tr").filter({ hasText: "My current workload" });
  await expect(q5Row.getByText("4.0", { exact: true })).toBeVisible();
  await expect(q5Row.getByText("1", { exact: true })).toBeVisible();

  // A plain member never sees the comments section.
  await expect(page.getByText(COMMENT)).toHaveCount(0);
  await logout(page);

  // The manager did NOT fill their own survey: aggregates stay gated, but their monitoring
  // right still surfaces the anonymized comments (the comments-only card).
  await login(page, MANAGER_AAA);
  await page.goto("/pulse?tab=results");
  await expect(page.getByText("Results are available for closed cycles you took part in.")).toBeVisible();
  await expect(page.getByText(COMMENT)).toBeVisible();
  await expect(page.getByText("Shown anonymized and in random order.").first()).toBeVisible();
  await logout(page);

  // The sub-team comparison (v2.10.0): Manager CCC (who responded) flips the third mode and
  // reads the CCC card — the Own-members baseline (manager-aaa + manager-bbb, neither
  // responded → withheld with the count still visible), the AAA subtree row with this run's
  // known aggregates, and the BBB row withheld (nobody in BBB responded). No comments render
  // in this view, even though CCC's manager monitors AAA.
  await login(page, MANAGER_CCC);
  await page.goto("/pulse?tab=results");
  // The SegmentedControl's radio input is hidden (the Chip gotcha) — click the visible label.
  await page.getByText("Sub-team comparison", { exact: true }).click();
  const cccTable = page.getByRole("table", { name: "Sub-team comparison for CCC" });
  await expect(cccTable).toBeVisible();
  const rowIn = (name: string) => cccTable.getByRole("row").filter({ hasText: name });
  await expect(rowIn("Own members").getByText("0 of 2 responded (0%)")).toBeVisible();
  await expect(
    rowIn("Own members").getByText("Fewer than 3 responses — results are hidden to protect anonymity."),
  ).toBeVisible();
  // AAA {10, 8, 2}: eNPS 0. Favorables: Q2 {4,4,4}, Q4 {4,4,4}, and the NA-shrunk Q5 {4}
  // are all 100.0%; Q3 and the rotating question {4,3,3} are 33.3% — exact counts pin all
  // five columns at once.
  const aaaRow = cccTable.getByRole("row").filter({ hasText: "AAA" }).first();
  await expect(aaaRow.getByText("3 of 3 responded (100%)")).toBeVisible();
  await expect(aaaRow.getByText("100.0%", { exact: true })).toHaveCount(3);
  await expect(aaaRow.getByText("33.3%", { exact: true })).toHaveCount(2);
  await expect(
    rowIn("BBB").getByText("Fewer than 3 responses — results are hidden to protect anonymity."),
  ).toBeVisible();
  // A child-less team's card carries the note instead of a table; comments never show here.
  await expect(page.getByText("This team has no sub-teams to compare.").first()).toBeVisible();
  await expect(page.getByText(COMMENT)).toHaveCount(0);
});

test("cancelling a scheduled cycle is confirmed and leaves the registry terminal", async ({ page }) => {
  await login(page, ADMIN);
  await page.goto("/pulse-cycles");
  await expect(page.getByLabel("Open date", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "Schedule cycle" }).click();
  await expect(page.getByText("Cycle scheduled")).toBeVisible();
  await page.getByRole("button", { name: /Cancel cycle \d+/ }).first().click();
  await expect(page.getByText(/Submitted answers are kept for audit/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel cycle", exact: true }).click();
  await expect(page.getByText("Cycle cancelled")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});
