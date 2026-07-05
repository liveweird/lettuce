import {
  test,
  expect,
  login,
  logout,
  provideFeedback,
  openBell,
  notificationCard,
  sortNewestFirst,
  uniqueText,
  MANAGER_AAA,
  AAA_ONE,
} from "./helpers";

// The receiving side, end to end: a draft stays invisible to its subject; once sent, the subject
// finds it in their "Received" list AND gets an in-app notification whose "Go to" link opens it.
test("subject cannot see a draft, then receives and reads the sent feedback via the bell", async ({
  page,
}) => {
  const body = uniqueText("E2E delivery");

  // Provider drafts about AAA One.
  await login(page, MANAGER_AAA);
  const id = await provideFeedback(page, "AAA One", body, "Save draft");
  await logout(page);

  // Subject: the draft is hidden — no row in "Received" carries its id.
  await login(page, AAA_ONE);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("view=received") && r.ok()),
    page.goto("/feedback?tab=received"),
  ]);
  // Newest-first, so a leaked draft would be at the top of page 1.
  await sortNewestFirst(page);
  await expect(page.locator(`a[href*="/feedback/${id}/"]`)).toHaveCount(0);
  await logout(page);

  // Provider sends it (content PUT + POST /send from the editor).
  await login(page, MANAGER_AAA);
  await page.goto(`/feedback/${id}/edit`);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/send`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  await logout(page);

  // Subject: the sent feedback now appears in "Received"…
  await login(page, AAA_ONE);
  await page.goto("/feedback?tab=received");
  await sortNewestFirst(page);
  await expect(page.locator(`a[href*="/feedback/${id}/view"]`).first()).toBeVisible();

  // …and the bell holds the delivery notification; its "Go to" opens the feedback.
  const dialog = await openBell(page);
  const card = notificationCard(dialog, "Feedback from Manager AAA about AAA One has been sent.");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Go to" }).click();
  await expect(page).toHaveURL(new RegExp(`/feedback/${id}/view`));
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("Sent");
});
