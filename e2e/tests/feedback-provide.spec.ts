import { test, expect, login, typeContent, gotoUserRow, uniqueText, MANAGER_AAA } from "./helpers";

// Exercises, through the real UI, the create + content PUT + POST /send + POST /withdraw path.
// We capture the created feedback's id from the API response so the test acts on exactly its own
// row regardless of any other data in the shared database.
test("provider drafts, sends, and withdraws a feedback", async ({ page }) => {
  const body = uniqueText("E2E provide");
  await login(page, MANAGER_AAA);

  // Provide feedback about AAA One → create editor → type content → Save draft.
  // (Filter by name first so the row is on page 1 even after runs accumulate E2E users.)
  await gotoUserRow(page, "AAA One");
  await page.getByRole("link", { name: "Provide feedback for AAA One" }).click();
  await expect(page).toHaveURL(/\/feedback\/new/);
  await typeContent(page, body);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save draft" }).click(),
  ]);
  const id: number = (await created.json()).id;

  // Send it (content PUT + POST /send) — wait for the transition to commit before navigating.
  await page.goto(`/feedback/${id}/edit`);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/send`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);

  // The now-Sent feedback shows our content read-only.
  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveText("Sent");

  // Withdraw it (POST /withdraw) via the confirmation modal.
  await page.getByRole("button", { name: "Withdraw" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/withdraw`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Withdraw" }).click(),
  ]);

  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByLabel("Status")).toHaveText("Withdrawn");
});
