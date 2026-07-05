import {
  test,
  expect,
  login,
  createUserViaUi,
  pickSelectOption,
  uniqueText,
  ADMIN,
} from "./helpers";

// Team CRUD + member management + the admin-only manager handoff, all on throwaway users and a
// throwaway team so the seeded AAA/BBB/CCC org the feedback specs rely on is never touched.
test("admin creates a team, manages members, reassigns the manager, and deletes it", async ({
  page,
}) => {
  await login(page, ADMIN);
  const userA = await createUserViaUi(page, "E2E TeamMgr");
  const userB = await createUserViaUi(page, "E2E TeamMember");
  // Space-free so the list-filter query param needs no encoding gymnastics in assertions.
  const teamName = uniqueText("E2E-Team");
  const renamed = `${teamName}-renamed`;

  // Create (admin may designate anyone as manager).
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", userA.name);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await created.json()).id;

  // Members: add B, then remove B (confirmation modal).
  await page.goto(`/teams/${teamId}/members`);
  await expect(page.getByRole("heading", { name: `Members — ${teamName}` })).toBeVisible();
  await pickSelectOption(page, "Add a user", userB.name);
  await Promise.all([
    // The member add is a PUT /teams/{id}/members/{userId} (see web/src/api/client.ts).
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);
  await expect(page.getByRole("cell", { name: userB.name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Remove ${userB.name}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click(),
  ]);
  await expect(page.getByRole("cell", { name: userB.name, exact: true })).toHaveCount(0);

  // Edit: rename + reassign the manager (ADMIN-only path).
  await page.goto(`/teams/${teamId}/edit`);
  await page.getByRole("textbox", { name: "Name" }).fill(renamed);
  await pickSelectOption(page, "Manager", userB.name);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/teams/${teamId}`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await page.goto(`/teams/${teamId}/edit`);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(renamed);
  await expect(page.getByRole("combobox", { name: "Manager" })).toHaveValue(userB.name);

  // Delete from the filtered list; the filtered view then shows no teams.
  await page.goto("/teams");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  // The filter is debounced; the Delete button auto-waits for the filtered row to render.
  await page.getByRole("button", { name: `Delete ${renamed}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/teams/${teamId}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  // Verify against a fresh load — the in-place list can lose a refetch race with a stale
  // in-flight response.
  await page.goto("/teams");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await expect(page.getByText("No teams")).toBeVisible();
});
