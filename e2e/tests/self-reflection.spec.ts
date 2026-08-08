import { AAA_TWO, expect, expectStatus, login, sortNewestFirst, test, typeContent, uniqueText } from "./helpers";

// Self-reflection: feedback where the caller is both provider and subject. Entered from the
// dedicated left-menu screen; the saved row lands in the ordinary Provided feedback tab.

test("a user writes and sends a self-reflection where both parties are themselves", async ({ page }) => {
  const body = uniqueText("E2E self-reflection");

  await login(page, AAA_TWO);
  await page.getByRole("link", { name: "Self-reflection" }).click();
  await expect(page).toHaveURL(/\/feedback\/self/);
  await expect(page.getByRole("heading", { name: "Self-reflection" })).toBeVisible();

  // Both parties are the caller.
  expect(await page.getByText("You", { exact: true }).count()).toBeGreaterThanOrEqual(2);

  // Visibility offers exactly the no-requester pair, defaulting to Provider + subject.
  const visibility = page.getByRole("combobox", { name: "Visibility" });
  await expect(visibility).toHaveValue("Provider + subject");
  await visibility.click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.filter({ hasText: "Provider + subject" })).toHaveCount(1);
  await expect(options.filter({ hasText: "Public" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  await typeContent(page, body);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  const id = (await created.json()).id as number;

  // Save lands on the Provided tab and the new row is there. Sort newest-first before the
  // row assert: the shared dev DB accumulates provided rows for AAA Two across runs, so under
  // the default sort the fresh row eventually falls off page 1 (residue class #3).
  await expect(page).toHaveURL(/\/feedback\?tab=provided/);
  await sortNewestFirst(page);
  await expect(page.locator(`a[href*="/feedback/${id}/"]`).first()).toBeVisible();

  // The document is delivered and readable by its author.
  await expectStatus(page, id, "Sent");
  await expect(page.getByText(body)).toBeVisible();
});
