import {
  test,
  expect,
  login,
  logout,
  openBell,
  notificationCard,
  gotoUserRow,
  MANAGER_AAA,
  AAA_ONE,
  AAA_TWO,
} from "./helpers";

// Bell mechanics: unread badge, per-notification seen/unseen toggles, and "Mark all as seen".
// One ask each from AAA One and AAA Two gives Manager AAA at least two fresh unseen
// notifications to work with — a second ask with the SAME triple would be blocked by the
// no-duplicate constraint (v1.13). The spec never asserts absolute counts (the shared DB
// accumulates notifications across runs).
test("recipient toggles seen/unseen and marks all notifications as seen", async ({ page }) => {
  // Mint two provider-side notifications for Manager AAA — one ask per requester.
  const ids: number[] = [];
  for (const requester of [AAA_ONE, AAA_TWO]) {
    await login(page, requester);
    await gotoUserRow(page, "Manager AAA");
    await page.getByRole("link", { name: "Ask Manager AAA for feedback" }).click();
    const [created] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
      ),
      page.getByRole("button", { name: "Send request" }).click(),
    ]);
    ids.push((await created.json()).id);
    await logout(page);
  }

  await login(page, MANAGER_AAA);
  const dialog = await openBell(page);
  const card = notificationCard(dialog, "AAA One requested feedback about AAA One.");
  await expect(card).toBeVisible();

  // Mark that one as seen → its row restyles and offers "Mark as unseen". The buttons'
  // accessible names are their per-id aria-labels ("Mark notification 12 as seen"), not the
  // tooltip text.
  const markSeenBtn = card.getByRole("button", { name: /Mark notification \d+ as seen/ });
  const markUnseenBtn = card.getByRole("button", { name: /Mark notification \d+ as unseen/ });
  await expect(markSeenBtn).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => /\/notifications\/\d+\/seen$/.test(r.url()) && r.ok()),
    markSeenBtn.click(),
  ]);
  await expect(markUnseenBtn).toBeVisible();
  await expect(markSeenBtn).toHaveCount(0);

  // …and back to unseen.
  await Promise.all([
    page.waitForResponse((r) => /\/notifications\/\d+\/unseen$/.test(r.url()) && r.ok()),
    markUnseenBtn.click(),
  ]);
  await expect(markSeenBtn).toBeVisible();

  // Mark all as seen → the bulk button disappears and the badge reads 0 unread.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/notifications/seen-all") && r.request().method() === "POST" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Mark all as seen" }).click(),
  ]);
  await expect(dialog.getByRole("button", { name: "Mark all as seen" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Mark notification \d+ as seen/ })).toHaveCount(0);
  // Close the modal via Escape — the header X has no reliable accessible name.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Notifications (0 unread)" })).toBeVisible();

  // Tidy the seeded provider's triage queue: reject both requests.
  for (const id of ids) {
    await page.goto(`/feedback/${id}/edit`);
    await page.getByRole("button", { name: "Reject" }).click();
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith(`/feedbacks/${id}/reject`) && r.request().method() === "POST" && r.ok(),
      ),
      page.getByRole("dialog").getByRole("button", { name: "Reject" }).click(),
    ]);
  }
});
