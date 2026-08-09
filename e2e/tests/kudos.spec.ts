import {
  test,
  expect,
  login,
  gotoUserRow,
  clickProvideFeedback,
  typeContent,
  uniqueText,
  AAA_TWO,
  MANAGER_CCC,
} from "./helpers";

// The Kudos wall end to end: a provider sends a PUBLIC feedback and a caller who is no party to
// it finds it on /kudos and expands the card. Exclusive state (see README "Parallel execution"):
// this file owns the (AAA Three ← AAA Two) triple, created directly as SENT — no open window.
// Wall asserts go by this run's unique content, never by position: the shared DB accumulates rows.
test("a public feedback lands on the Kudos wall for a non-party viewer", async ({ page }) => {
  const body = uniqueText("E2E kudos");
  await login(page, AAA_TWO);

  // Provide PUBLIC feedback about AAA Three and send it in one step.
  await gotoUserRow(page, "AAA Three");
  await clickProvideFeedback(page, "AAA Three");
  await expect(page).toHaveURL(/\/feedback\/new/);
  await page.getByRole("combobox", { name: "Visibility" }).click();
  await page.getByRole("option", { name: "Public" }).click();
  await typeContent(page, body);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);

  // Manager CCC is neither provider nor subject — the wall is org-wide by design.
  await login(page, MANAGER_CCC);
  await page.getByRole("link", { name: "Kudos" }).click();
  await expect(page).toHaveURL(/\/kudos/);

  // The collapsed card is an expandable button carrying the content; expanding swaps it for the
  // rendered markdown plus the collapse control.
  const card = page
    .getByRole("button", { name: "Show the full content" })
    .filter({ hasText: body });
  await expect(card).toBeVisible();
  await expect(page.getByText("AAA Two").first()).toBeVisible();
  await expect(page.getByText("AAA Three").first()).toBeVisible();
  await card.click();
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();
});
