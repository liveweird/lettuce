import {
  test,
  expect,
  login,
  createUserViaUi,
  fillDate,
  pickSelectOption,
  uniqueText,
  ADMIN,
  openFilters,
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
  // Deliberately the HISTORICAL url — v2.5.7 renamed the page to /details and this goto
  // doubles as the redirect regression check.
  await page.goto(`/teams/${teamId}/members`);
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/details`));
  await expect(page.getByRole("heading", { name: "Team details" })).toBeVisible();
  await expect(page.getByText(teamName, { exact: true })).toBeVisible();
  await pickSelectOption(page, "Add a user", userB.name);
  await Promise.all([
    // The member add is a PUT /teams/{id}/members/{userId} (see web/src/api/teams.ts).
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "PUT" && r.ok(),
    ),
    page.getByRole("button", { name: "Add", exact: true }).click(),
  ]);
  // Query by text, not cell name — the PersonaChip's avatar initials are part of the cell's
  // accessible name (see the testing note in CLAUDE.md), so an exact cell-name match misses.
  await expect(page.getByRole("table").getByText(userB.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `More actions for ${userB.name}` }).click();
  await page.getByRole("menuitem", { name: `Remove ${userB.name}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/members/`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click(),
  ]);
  await expect(page.getByRole("table").getByText(userB.name, { exact: true })).toHaveCount(0);

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
  await openFilters(page);
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  // The filter is debounced; the row's ⋯ menu auto-waits for the filtered row to render.
  await page.getByRole("button", { name: `More actions for ${renamed}` }).click();
  await page.getByRole("menuitem", { name: `Delete ${renamed}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/teams/${teamId}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  // Verify against a fresh load — the in-place list can lose a refetch race with a stale
  // in-flight response.
  await page.goto("/teams");
  await openFilters(page);
  await page.getByLabel("Name", { exact: true }).fill(renamed);
  await expect(page.getByText("No teams")).toBeVisible();
});

// The dated structure (v4.17.0): a team's History page, a back-dated manager period, a past
// membership, the person's own team history and the org chart as of a past day — on a
// throwaway team and three throwaway users, so the seeded org is never touched.
test("admin records a team's manager and membership history and sees it on the person's page and the as-of org chart", async ({
  page,
}) => {
  await login(page, ADMIN);
  const manager = await createUserViaUi(page, "E2E HistMgr");
  const earlierManager = await createUserViaUi(page, "E2E HistOldMgr");
  const pastMember = await createUserViaUi(page, "E2E HistMember");
  const teamName = uniqueText("E2E-HistTeam");

  // The team starts today with one manager (the create form dates the manager today).
  await page.goto("/teams/new");
  await page.getByRole("textbox", { name: "Name" }).fill(teamName);
  await pickSelectOption(page, "Manager", manager.name);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/teams") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const teamId: number = (await created.json()).id;

  // Team details links to the History page.
  await page.goto(`/teams/${teamId}/details`);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}/history`));
  await expect(page.getByRole("heading", { name: `History of ${teamName}` })).toBeVisible();

  // One manager row, and it is the current one.
  const managers = page.getByRole("region", { name: "Managers" });
  const editManagerButtons = managers.getByRole("button", { name: /^Edit manager period of / });
  await expect(editManagerButtons).toHaveCount(1);
  await expect(editManagerButtons.first()).toHaveAttribute(
    "aria-label",
    new RegExp(`^Edit manager period of ${manager.name}, `),
  );
  await expect(managers.getByText("Current", { exact: true })).toHaveCount(1);

  // A back-dated manager period lands before the current one and the timeline shows two rows.
  // 2023: early enough that the line also covers the 2024 as-of day used below.
  await pickSelectOption(page, "Manager", earlierManager.name);
  await fillDate(page, "Starts on", "2023-01-01");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/teams/${teamId}/managers`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Add manager period" }).click(),
  ]);
  await expect(page.getByText("Manager period added")).toBeVisible();
  await expect(editManagerButtons).toHaveCount(2);
  await expect(
    managers.getByRole("button", { name: new RegExp(`^Edit manager period of ${earlierManager.name}, `) }),
  ).toBeVisible();

  // A past membership: 2024-01-01 -> 2024-06-30 reads Past.
  const memberships = page.getByRole("region", { name: "Membership history" });
  await pickSelectOption(page, "Person", pastMember.name);
  await fillDate(page, "From", "2024-01-01");
  await fillDate(page, "Until", "2024-06-30");
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith(`/teams/${teamId}/memberships`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Add membership period" }).click(),
  ]);
  await expect(page.getByText("Membership period added")).toBeVisible();
  const memberRow = memberships.getByRole("row").filter({ hasText: pastMember.name });
  await expect(memberRow).toHaveCount(1);
  await expect(memberRow).toContainText("Past");

  // The admin's own activity log (v4.18.0) records the change under the Team membership area —
  // actor-only, so it is the admin's log, and the row links back to the team's history.
  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 2, name: "My activity" })).toBeVisible();
  await openFilters(page);
  await page.getByRole("combobox", { name: "Area", exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/users\/\d+\/activity\?/.test(r.url()) && r.url().includes("area=TEAM_MEMBERSHIP") && r.ok(),
    ),
    page.getByRole("option", { name: "Team membership", exact: true }).click(),
  ]);
  const activityRow = page.getByText(`Added a membership period of ${pastMember.name} in ${teamName}`);
  await expect(activityRow).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Added a manager period of ${teamName}: ${earlierManager.name} manages`)),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the team history" }).first()).toBeVisible();

  // The person's own page lists it under Team history (Memberships)...
  await page.goto(`/users/${pastMember.id}/teams`);
  await expect(page.getByRole("heading", { name: "Team history", exact: true })).toBeVisible();
  await expect(page.getByText("Memberships", { exact: true })).toBeVisible();
  await expect(page.getByText("Teams managed", { exact: true })).toBeVisible();
  const historyLink = page.getByRole("link", { name: `Team history of ${teamName}` });
  await expect(historyLink).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: teamName })).toContainText("Past");
  // ...and the earlier manager's page lists the team under Teams managed.
  await page.goto(`/users/${earlierManager.id}/teams`);
  await expect(page.getByRole("link", { name: `Team history of ${teamName}` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: teamName })).toContainText("Past");

  // The org chart as of 2024-03-01: the team with its then-manager and its then-member. (Today's
  // manager is not asserted absent: the as-of chart still lists today's directory under "Not in
  // any team", so M legitimately appears there.)
  await page.goto("/org?asOf=2024-03-01");
  await expect(page.getByRole("button", { name: `Members of ${teamName}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `User details for ${earlierManager.name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `User details for ${pastMember.name}` })).toBeVisible();

  // Corrections: delete the membership (row menu) and the back-dated manager period (dialog).
  await page.goto(`/teams/${teamId}/history`);
  await page.getByRole("button", { name: `More actions for ${pastMember.name}` }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^Delete membership of ${pastMember.name}, `) }).click();
  await expect(page.getByRole("dialog").getByText("Delete membership period?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/teams/${teamId}/memberships/`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(memberships.getByRole("row").filter({ hasText: pastMember.name })).toHaveCount(0);
  await managers
    .getByRole("button", { name: new RegExp(`^Delete manager period of ${earlierManager.name}, `) })
    .click();
  await expect(page.getByRole("dialog").getByText("Delete manager period?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/teams/${teamId}/managers/`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await expect(editManagerButtons).toHaveCount(1);

  // Delete the team from the filtered list (the existing flow).
  await page.goto("/teams");
  await openFilters(page);
  await page.getByLabel("Name", { exact: true }).fill(teamName);
  await page.getByRole("button", { name: `More actions for ${teamName}` }).click();
  await page.getByRole("menuitem", { name: `Delete ${teamName}` }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/teams/${teamId}`) && r.request().method() === "DELETE" && r.ok(),
    ),
    page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click(),
  ]);
  await page.goto("/teams");
  await openFilters(page);
  await page.getByLabel("Name", { exact: true }).fill(teamName);
  await expect(page.getByText("No teams")).toBeVisible();

  // Earlier days still show the deleted team, tagged.
  await page.goto("/org?asOf=2024-03-01");
  await expect(page.getByText(`${teamName} (deleted)`)).toBeVisible();
});
