import { AAA_ONE, ADMIN, expect, login, logout, test, uniqueText } from "./helpers";

// Integration clients: the admin key registry behind the read-only GraphQL integration API
// (v3.0.0; the compose stack ships INTEGRATION_ENABLED=true so /integration/graphql is live).
// The spec owns only its own uniquely-named clients; the revoke at the end is the cleanup —
// revoked rows are inert residue (no key works, nothing renders outside this admin page),
// so no sweep is needed.

test("admin creates an integration client, syncs through the GraphQL API with its key, and revokes it", async ({
  page,
  request,
}) => {
  const name = uniqueText("E2E-Client");

  // 1. Admin opens the Config → Integration clients screen and registers a client.
  await login(page, ADMIN);
  await page.getByRole("button", { name: "Config" }).click();
  await page.getByRole("link", { name: "Integration clients" }).click();
  await expect(page.getByRole("heading", { name: "Integration clients" })).toBeVisible();
  await page.getByLabel("Client name").fill(name);
  await page.getByRole("button", { name: "Add client" }).click();

  // 2. The key panel appears exactly once: masked until revealed, prefixed lettuce_int_.
  await expect(page.getByText(`API key for "${name}" — shown only once`)).toBeVisible();
  const panel = page.getByRole("alert").filter({ hasText: "shown only once" });
  await panel.getByLabel("Show password").click();
  const apiKey = (await panel.locator("code").innerText()).trim();
  expect(apiKey).toMatch(/^lettuce_int_/);

  // 3. The key authenticates the GraphQL endpoint (a machine client's bulk read).
  const query = { query: "{ teams { total } reviewPeriods { id } }" };
  const ok = await request.post("/integration/graphql", {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: query,
  });
  expect(ok.status()).toBe(200);
  const body = (await ok.json()) as { data: { teams: { total: number } }; errors?: unknown[] };
  expect(body.errors).toBeUndefined();
  expect(body.data.teams.total).toBeGreaterThan(0);

  // 4. Revoke is confirmed, toasts, flips the badge, and kills the key immediately.
  await page.getByLabel(`Revoke API key of ${name}`).click();
  await expect(page.getByText("Revoke this API key?")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("API key revoked")).toBeVisible();
  const row = page.locator("tr", { hasText: name }).getByText("Revoked");
  await expect(row).toBeVisible();
  await expect(page.getByLabel(`Revoke API key of ${name}`)).toHaveCount(0);
  const rejected = await request.post("/integration/graphql", {
    headers: { Authorization: `Bearer ${apiKey}` },
    data: query,
  });
  expect(rejected.status()).toBe(401);

  // 5. A regular user has no nav entry (Config expanded to prove absence) and the page
  // bounces them home.
  await logout(page);
  await login(page, AAA_ONE);
  await page.getByRole("button", { name: "Config" }).click();
  await expect(page.getByRole("link", { name: "Integration clients" })).toHaveCount(0);
  await page.goto("/integration-clients");
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { name: "Integration clients" })).toHaveCount(0);
});
