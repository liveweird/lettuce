import {
  test,
  expect,
  login,
  pickSelectOption,
  typeContent,
  uniqueText,
  AAA_TWO,
  MANAGER_CCC,
} from "./helpers";

// The Kudos wall end to end: a provider creates a kudo from the wall's own "New kudo" screen
// (v2.27.0 — recipient picker, visibility pinned to Public) and a caller who is no party to
// it finds it on /kudos and expands the card. Exclusive state (see README "Parallel execution"):
// this file owns the (AAA Three ← AAA Two) triple, created directly as SENT — no open window.
// Wall asserts go by this run's unique content, never by position: the shared DB accumulates rows.
test("a kudo created from the wall's New kudo screen lands there for a non-party viewer", async ({ page }) => {
  // Long enough to overflow the three-line preview clamp, so the Show more toggle appears.
  const marker = uniqueText("E2E kudos");
  const body = `${marker} ${"Great teamwork all around, thank you for the support and the dedication shown. ".repeat(8)}`.trim();
  await login(page, AAA_TWO);

  // The wall's sticky header carries the create entry point.
  await page.getByRole("link", { name: "Kudos" }).click();
  await expect(page).toHaveURL(/\/kudos$/);
  await page.getByRole("link", { name: "New kudo" }).click();
  await expect(page).toHaveURL(/\/kudos\/new/);

  // Visibility is pinned to Public and read-only — no combobox, just the badge. Exact match:
  // the nav's "Public holidays" link would trip strict mode otherwise.
  await expect(page.getByRole("combobox", { name: "Visibility" })).toHaveCount(0);
  await expect(page.getByText("Public", { exact: true })).toBeVisible();

  await pickSelectOption(page, "Recipient", "AAA Three");
  await typeContent(page, body);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  // Save & send returns to the wall, where the fresh kudo already shows.
  await expect(page).toHaveURL(/\/kudos$/);
  await expect(
    page.locator(".mantine-Timeline-item").filter({ hasText: marker }),
  ).toBeVisible();

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
