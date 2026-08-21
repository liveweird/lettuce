import {
  test,
  expect,
  login,
  pickSelectOption,
  typeContent,
  uniqueText,
  AAA_ONE,
} from "./helpers";

// Exercises, through the real UI, the create + content PUT + POST /send + POST /withdraw path.
// We capture the created feedback's id from the API response so the test acts on exactly its own
// row regardless of any other data in the shared database.
test("provider drafts, sends, and withdraws a feedback", async ({ page }) => {
  const body = uniqueText("E2E provide");
  // AAA One provides about AAA Two: the provider lifecycle is provider-generic, and under
  // parallel workers this file must own its (subject, provider) pair exclusively (see README).
  await login(page, AAA_ONE);

  // Enter via the "New feedback" button under the Provided list (v2.28.1 placement) and pick
  // AAA Two in the subject picker — the picker-mode create screen (the users-row "Provide
  // feedback" entry stays covered by manager-oversight.spec / templates.spec).
  await page.goto("/feedback?tab=provided");
  await page.getByRole("link", { name: "New feedback" }).click();
  await expect(page).toHaveURL(/\/feedback\/new/);
  await pickSelectOption(page, "Subject", "AAA Two");
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
