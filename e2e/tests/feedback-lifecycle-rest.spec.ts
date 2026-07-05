import {
  test,
  expect,
  login,
  provideFeedback,
  expectStatus,
  uniqueText,
  MANAGER_AAA,
} from "./helpers";

// Completes the state-machine coverage the other feedback specs leave out: create directly as
// SENT ("Save & send" on the create form → one POST, no separate /send), the provider-only
// DRAFT soft-delete, and the History/Lifecycle tabs on the view screen.
// (DRAFT → WITHDRAWN exists in the backend but has no UI affordance, so it is not e2e-testable.)

test("provider creates a feedback directly as Sent; History and Lifecycle tabs render", async ({
  page,
}) => {
  const body = uniqueText("E2E direct-send");
  await login(page, MANAGER_AAA);
  const id = await provideFeedback(page, "AAA Two", body, "Save & send");

  await expectStatus(page, id, "Sent");
  await expect(page.getByText(body)).toBeVisible();

  // History tab: the single created-as-SENT audit event, rendered in the viewer's language.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Feedback created and sent.")).toBeVisible();
  await expect(page.getByText("Manager AAA").first()).toBeVisible();

  // Lifecycle tab: the state diagram with its caption.
  await page.getByRole("tab", { name: "Lifecycle" }).click();
  await expect(
    page.getByText("How a feedback moves from request to delivery. Rejected and Withdrawn are final."),
  ).toBeVisible();
});

test("provider deletes a draft (soft-delete) via the editor's Delete action", async ({ page }) => {
  const body = uniqueText("E2E draft-delete");
  await login(page, MANAGER_AAA);
  const id = await provideFeedback(page, "AAA Two", body, "Save draft");

  await page.goto(`/feedback/${id}/edit`);
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Delete this draft feedback?", { exact: false })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete" }).click(),
  ]);

  // Soft-deleted: the row drops out of reads — the view page 404s even for its provider.
  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByText("Feedback not found.")).toBeVisible();

  // And it is gone from the "Provided" list (no action link carries its id).
  await page.goto("/feedback?tab=provided");
  await expect(page.getByRole("tab", { name: "Provided" })).toBeVisible();
  await expect(page.locator(`a[href*="/feedback/${id}/"]`)).toHaveCount(0);
});
