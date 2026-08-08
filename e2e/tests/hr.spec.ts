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
  PASSWORD,
} from "./helpers";

// The probe DRAFT minted below (manager-aaa → AAA Three — this file's exclusively-owned pair
// under parallel workers; AAA One belongs to the other feedback specs) would block any later
// spec's create on the same pair via the no-duplicate invariant, so it is deleted via the API
// even on failure.
let probeFeedbackId: number | null = null;

test.afterEach(async ({ request }) => {
  if (probeFeedbackId == null) return;
  const id = probeFeedbackId;
  probeFeedbackId = null;
  // Retry through the per-IP login bucket like helpers.login() does.
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await request.post("/api/v1/login", {
      data: { email: MANAGER_AAA, password: PASSWORD },
    });
    if (res.ok()) {
      const { token } = (await res.json()) as { token: string };
      await request.delete(`/api/v1/feedbacks/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return;
    }
    if (res.status() !== 429) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`hr.spec cleanup failed: could not delete probe feedback ${id}`);
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

  // 7. No admin surface: the Config group never offers Alerts to HR.
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);
});
