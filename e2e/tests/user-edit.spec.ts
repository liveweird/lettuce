import { test, expect, login, uniqueText, ADMIN } from "./helpers";

// Validates POST /users + PUT /users/{id} through the UI. Creates its own throwaway user so it
// never mutates a seeded account other specs reference by name.
test("admin creates then renames a user", async ({ page }) => {
  const email = `${uniqueText("e2e")}@lettuce.local`.toLowerCase();
  const name1 = uniqueText("E2E Created");
  const name2 = uniqueText("E2E Renamed");
  await login(page, ADMIN);

  // Create (role defaults to USER).
  await page.goto("/users/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name1);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("changeme1");
  await page.getByRole("textbox", { name: "Confirm password" }).fill("changeme1");
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/users") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const id: number = (await created.json()).id;

  // Rename via PUT /users/{id}.
  await page.goto(`/users/${id}/edit`);
  await page.getByRole("textbox", { name: "Name" }).fill(name2);
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/users\/\d+$/.test(r.url()) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);

  // Reopen the user; the persisted name is the one we set.
  await page.goto(`/users/${id}/edit`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(name2);
});
