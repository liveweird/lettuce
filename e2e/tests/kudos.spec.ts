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
  // Long enough to overflow the three-line preview clamp, so the Show more toggle appears.
  const marker = uniqueText("E2E kudos");
  const body = `${marker} ${"Great teamwork all around, thank you for the support and the dedication shown. ".repeat(8)}`.trim();
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

  // The card renders the content as markdown inside the read-only frame at all times; a long
  // body is clamped to three lines with a Show more/Show less toggle below (short cards get no
  // toggle at all). Scope to this run's card via its unique marker — the wall accumulates rows.
  // The exact class token — a [class*=…] substring match would also hit the nested
  // Timeline-itemBody/-itemContent wrappers and trip strict mode.
  const card = page.locator(".mantine-Timeline-item").filter({ hasText: marker });
  await expect(card).toBeVisible();
  await expect(page.getByText("AAA Two").first()).toBeVisible();
  await expect(page.getByText("AAA Three").first()).toBeVisible();

  const showMore = card.getByRole("button", { name: "Show more" });
  await expect(showMore).toBeVisible();
  await showMore.click();
  const showLess = card.getByRole("button", { name: "Show less" });
  await expect(showLess).toBeVisible();
  await showLess.click();
  await expect(card.getByRole("button", { name: "Show more" })).toBeVisible();
});
