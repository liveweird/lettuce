import {
  test,
  expect,
  login,
  typeContent,
  sortNewestFirst,
  uniqueText,
  MANAGER_AAA,
} from "./helpers";

// Manager oversight surfaces: the "My team" feedback tab (view=team) and the per-user
// two-way feedbacks screen reached from the dashboard.
test("manager sees a delivered team feedback in the team tab and the per-user screen", async ({
  page,
}) => {
  const body = uniqueText("E2E oversight");
  await login(page, MANAGER_AAA);

  // Deliver a feedback about AAA One (create directly as SENT); capture both ids.
  await page.goto("/users");
  await page.getByRole("link", { name: "Provide feedback for AAA One" }).click();
  await typeContent(page, body);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  const { id, subjectId } = (await created.json()) as { id: number; subjectId: number };

  // "My team" tab (manager-only) lists the delivered row (newest-first to stay on page 1).
  await page.goto("/feedback?tab=team");
  await expect(page.getByRole("tab", { name: "My team" })).toBeVisible();
  await sortNewestFirst(page);
  await expect(page.locator(`a[href*="/feedback/${id}/view"]`).first()).toBeVisible();

  // The per-user screen renders both directions; our feedback sits in "From you to AAA One".
  await page.goto(`/users/${subjectId}/feedbacks?name=${encodeURIComponent("AAA One")}&from=subordinates`);
  await expect(page.getByRole("heading", { name: "Feedbacks with AAA One" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From AAA One to you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "From you to AAA One" })).toBeVisible();
  // Our feedback lives in the second table ("From you to AAA One") — sort that one newest-first.
  await sortNewestFirst(page, 1);
  await expect(page.locator(`a[href*="/feedback/${id}/view"]`).first()).toBeVisible();
});
