import {
  userMenu,
  test,
  expect,
  ADMIN,
  login,
  logout,
  createUserViaUi,
  gotoUserRow,
  openFilters,
  pickSelectOption,
  uniqueText,
} from "./helpers";

// Per-user feature flags (v1.53.0): admin disables Goals for a fresh user via the per-user
// editor (/users/:id/features, reached from the Modify ▾ menu), the victim loses the feature
// end to end (nav link gone, direct URL bounces home), then the admin re-enables it via the
// per-feature screen (/feature-flags) and the victim gets it back. Fresh prefix-unique user
// per run — no shared-DB residue, nothing to sweep.
test("admin toggles a user's Goals feature via both surfaces; the user's UI follows", async ({ page }) => {
  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E FeatureFlag");

  // Disable Goals via the per-user editor.
  await gotoUserRow(page, user.name);
  await page.getByRole("button", { name: `Modify actions for ${user.name}` }).click();
  await page.getByRole("menuitem", { name: `Features of ${user.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${user.id}/features$`));
  const goalsSwitch = page.getByRole("switch", { name: "Goals" });
  await expect(goalsSwitch).toBeChecked();
  await goalsSwitch.click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/users/${user.id}/features`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);

  // The victim: no Goals nav link, and the direct URL bounces to the dashboard.
  await login(page, user.email, user.password);
  await expect(page.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Goals", exact: true })).toHaveCount(0);
  await page.goto("/goals");
  await expect(userMenu(page)).toBeVisible();
  await expect(page).not.toHaveURL(/\/goals/);
  await logout(page);

  // Re-enable via the per-feature screen: pick Goals, filter to disabled users + the unique
  // email (shared-DB rule: never assume page 1), flip the row switch.
  await login(page, ADMIN);
  await page.goto("/feature-flags");
  await openFilters(page);
  await page.getByRole("combobox", { name: "Feature" }).click();
  await page.getByRole("option", { name: "Goals" }).click();
  await page.getByRole("combobox", { name: "State" }).click();
  await page.getByRole("option", { name: "Disabled" }).click();
  // Wait for the email-filtered list fetch to land before touching the row: the debounced
  // refetch re-mounts the table, and a click racing that re-render dies silently (the PUT
  // below then never fires — observed flake, 2026-08-12).
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("email=") && r.url().includes("/api/v1/users") && r.ok()),
    page.getByLabel("Email", { exact: true }).fill(user.email),
  ]);
  const rowSwitch = page.getByRole("switch", { name: `Toggle Goals for ${user.name}` });
  await expect(rowSwitch).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/api/v1/users/${user.id}/features`) && r.request().method() === "PUT" && r.ok(),
    ),
    // force: the bare-label row Switch keeps its role=switch input visually hidden under the
    // track, so an actionability-checked click retries forever (the labeled editor switches
    // above don't need this).
    rowSwitch.click({ force: true }),
  ]);
  await logout(page);

  // The victim again: Goals restored (fresh login carries the fresh flags).
  await login(page, user.email, user.password);
  await expect(page.getByRole("link", { name: "Goals", exact: true })).toBeVisible();
  await page.goto("/goals");
  await expect(page).toHaveURL(/\/goals/);
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
});

// v2.1.0: the team dimension on /feature-flags — filter the table to a fresh team and flip a
// flag for everyone on it at once (the bulk buttons act on ALL rows matching the filters,
// behind a count-stating confirm). Fresh users + a fresh team per run (exclusive state — safe
// in the parallel phase; flag changes mint no notifications); the team is deleted at the end
// so the Team filter dropdown doesn't accumulate run residue.
test("bulk toggle by team: filter to a fresh team, disable Goals for all members, re-enable", async ({
  page,
}) => {
  await login(page, ADMIN);
  const userA = await createUserViaUi(page, "E2E FlagTeamA");
  const userB = await createUserViaUi(page, "E2E FlagTeamB");

  // A fresh team with both as members. The admin manages it — the members page's "Add a
  // user" pool deliberately EXCLUDES the team's manager, so the manager must be a third
  // party for both fresh users to be addable (and the team filter is membership-only anyway).
  const teamName = uniqueText("E2E FlagTeam");
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", "Administrator");
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await created.json()).id;
  await page.goto(`/teams/${teamId}/details`);
  for (const member of [userA, userB]) {
    await pickSelectOption(page, "Add a user", member.name);
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
      ),
      page.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
  }

  // Filter the flags table to the team: exactly the two members, with their team badges.
  await page.goto("/feature-flags");
  await openFilters(page);
  await page.getByRole("combobox", { name: "Feature" }).click();
  await page.getByRole("option", { name: "Goals" }).click();
  await pickSelectOption(page, "Team", teamName);

  const switchA = page.getByRole("switch", { name: `Toggle Goals for ${userA.name}` });
  const switchB = page.getByRole("switch", { name: `Toggle Goals for ${userB.name}` });
  await expect(switchA).toBeChecked();
  await expect(switchB).toBeChecked();
  await expect(page.getByRole("table").getByText(teamName, { exact: true }).first()).toBeVisible();

  // Bulk disable: the confirm states the affected count; both rows flip.
  await page.getByRole("button", { name: "Disable for all matching" }).click();
  await expect(page.getByText("This will disable Goals for 2 users.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Disable", exact: true }).click();
  await expect(switchA).not.toBeChecked();
  await expect(switchB).not.toBeChecked();

  // Bulk enable brings both back.
  await page.getByRole("button", { name: "Enable for all matching" }).click();
  await expect(page.getByText("This will enable Goals for 2 users.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Enable", exact: true }).click();
  await expect(switchA).toBeChecked();
  await expect(switchB).toBeChecked();

  // Tidy up: delete the fresh team (the fresh users stay, like the first test's).
  await page.goto("/teams");
  await openFilters(page);
  await page.getByLabel("Name", { exact: true }).fill(teamName);
  await page.getByRole("button", { name: `Delete ${teamName}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/teams/${teamId}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await logout(page);
});
