import {
  test,
  expect,
  login,
  clickAskForFeedback,
  logout,
  openBell,
  notificationCard,
  gotoUserRow,
  uniqueText,
  ADMIN,
  AAA_ONE,
  AAA_TWO,
  PASSWORD,
} from "./helpers";

// Bell mechanics: unread badge, per-notification seen/unseen toggles, and "Mark all as seen".
// The recipient is a THROWAWAY provider minted via the API: this spec's "Mark all as seen" and
// its `(0 unread)` badge assertion need a bell no other spec (or parallel worker) can mint
// notifications into — seed accounts receive notifications from several other files. One ask
// each from AAA One and AAA Two gives the recipient two fresh unseen notifications; a second ask
// with the SAME triple would be blocked by the no-duplicate constraint (v1.13).
test("recipient toggles seen/unseen and marks all notifications as seen", async ({
  page,
  request,
}) => {
  // Mint the throwaway provider over the API as admin (the create accepts a client-supplied
  // password, so no reveal-modal round-trip is needed).
  const providerName = uniqueText("E2E Bell");
  const provider = {
    name: providerName,
    email: `${providerName.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`,
    password: `e2e-${uniqueText("pw")}`,
  };
  const adminLogin = await request.post("/api/v1/login", {
    data: { email: ADMIN, password: PASSWORD },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const { token } = (await adminLogin.json()) as { token: string };
  const created = await request.post("/api/v1/users", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: provider.name, email: provider.email, password: provider.password },
  });
  expect(created.ok()).toBeTruthy();

  // Two provider-side notifications for the throwaway — one ask per requester.
  const ids: number[] = [];
  for (const requester of [AAA_ONE, AAA_TWO]) {
    await login(page, requester);
    await gotoUserRow(page, provider.name);
    await clickAskForFeedback(page, provider.name);
    const [createdFeedback] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
      ),
      page.getByRole("button", { name: "Send request" }).click(),
    ]);
    ids.push((await createdFeedback.json()).id);
    await logout(page);
  }

  await login(page, provider.email, provider.password);
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

  // Mark all as seen → the bulk button disappears and the badge reads 0 unread. Safe against
  // parallel workers precisely because this bell belongs to the throwaway alone.
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

  // Tidy the provider's triage queue: reject both requests. (A mid-run death before this point
  // strands open requests on the throwaway only — never on a seed pair.)
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
