import { AAA_ONE, ADMIN, expect, login, logout, openFilters, PASSWORD, test, typeContent, uniqueText } from "./helpers";

// Alerts: admin-managed broadcast banners every user sees. The management pages are
// admin-only; the banner renders in the header on every authenticated page. The spec
// cleans up its alert — a leaked active alert would overlay the header for every later
// spec, so a safety net below also deletes it via the API if the test dies mid-way.

let leftoverAlertId: number | null = null;

test.afterEach(async ({ request }) => {
  if (leftoverAlertId == null) return;
  const res = await request.post("/api/v1/login", {
    data: { email: ADMIN, password: PASSWORD },
  });
  if (res.ok()) {
    const token = (await res.json()).token as string;
    await request.delete(`/api/v1/alerts/${leftoverAlertId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  leftoverAlertId = null;
});

test("admin creates an alert; users see, hide, and re-show the banner; deactivation and delete remove it", async ({ page }) => {
  const title = uniqueText("E2E-Alert");
  const content = uniqueText("E2E alert body");

  await login(page, ADMIN);
  await page.goto("/alerts");
  await page.getByRole("link", { name: "New alert" }).click();
  await expect(page).toHaveURL(/\/alerts\/new/);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await typeContent(page, content); // both window bounds stay unchecked: visible immediately
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/alerts") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create", exact: true }).click(),
  ]);
  const id = (await created.json()).id as number;
  leftoverAlertId = id; // cleared once the test's own delete succeeds

  // The management list has it (filter by title — default sort would page it away).
  await expect(page).toHaveURL(/\/alerts$/);
  await openFilters(page);
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await expect(page.getByRole("table").getByText(title, { exact: true })).toBeVisible();

  // A regular user can show and hide the banner. The hidden state is device-level
  // (localStorage), and logout() collapses the banner to reach the header — so after the
  // user switch the strip shows first, and the alert content is one "Show alerts" away.
  await logout(page);
  await login(page, AAA_ONE);
  await expect(page.getByText(/alerts? hidden/)).toBeVisible();
  await page.getByRole("button", { name: "Show alerts" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText(content)).toBeVisible();
  await page.getByRole("button", { name: "Hide alerts" }).click();
  await expect(page.getByText(/alerts? hidden/)).toBeVisible();
  await expect(page.getByText(content)).toBeHidden();
  await page.getByRole("button", { name: "Show alerts" }).click();
  await expect(page.getByText(content)).toBeVisible();
  // Alert management is invisible to non-admins.
  await expect(page.locator('a[href="/alerts"]')).toHaveCount(0);

  // Admin renames and deactivates — the banner disappears.
  await logout(page);
  await login(page, ADMIN);
  await page.goto(`/alerts/${id}/edit`);
  await page.getByRole("textbox", { name: "Title" }).fill(`${title}-v2`);
  const active = page.getByRole("switch", { name: "Active" });
  await expect(active).toBeChecked();
  await active.click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/alerts/${id}`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save", exact: true }).click(),
  ]);
  await page.goto("/");
  await expect(page.getByText(`${title}-v2`)).toHaveCount(0);

  // Delete from the management list (confirmation modal); the row is gone.
  await page.goto("/alerts");
  await openFilters(page);
  await page.getByRole("textbox", { name: "Title" }).fill(`${title}-v2`);
  await expect(page.getByRole("table").getByText(`${title}-v2`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Delete ${title}-v2` }).click();
  const dialog = page.getByRole("dialog");
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/alerts/${id}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(page.getByText("No alerts")).toBeVisible();
});
