import {
  test,
  expect,
  login,
  logout,
  typeContent,
  gotoUserRow,
  uniqueText,
  MANAGER_AAA,
  AAA_ONE,
  AAA_TWO,
} from "./helpers";

// Requester asks a provider for feedback (creates REQUESTED); returns the new feedback's id.
async function ask(page: import("@playwright/test").Page, requester: string): Promise<number> {
  await login(page, requester);
  await gotoUserRow(page, "Manager AAA");
  await page.getByRole("link", { name: "Ask Manager AAA for feedback" }).click();
  await expect(page).toHaveURL(/\/feedback\/ask/);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Send request" }).click(),
  ]);
  return (await created.json()).id;
}

test("provider accepts a request, then drafts and sends it", async ({ page }) => {
  const body = uniqueText("E2E accepted");
  const id = await ask(page, AAA_ONE);

  await logout(page);
  await login(page, MANAGER_AAA);

  // Triage screen for a REQUESTED feedback the caller provides → Accept (POST /pick-up).
  await page.goto(`/feedback/${id}/edit`);
  await expect(page.getByRole("heading", { name: "Feedback request" })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/pick-up`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Accept" }).click(),
  ]);

  // Reloads in place as the DRAFT editor → write content and send (content PUT + POST /send).
  await typeContent(page, body);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/send`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);

  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByLabel("Status")).toHaveValue("Sent");
});

test("provider rejects a request", async ({ page }) => {
  const id = await ask(page, AAA_TWO);

  await logout(page);
  await login(page, MANAGER_AAA);

  await page.goto(`/feedback/${id}/edit`);
  await expect(page.getByRole("heading", { name: "Feedback request" })).toBeVisible();
  await page.getByRole("button", { name: "Reject" }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}/reject`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Reject" }).click(),
  ]);

  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByLabel("Status")).toHaveValue("Rejected");
});
