import type { APIRequestContext } from "@playwright/test";
import {
  ADMIN,
  PASSWORD,
  expect,
  login,
  logout,
  notificationCard,
  openBell,
  openUserMenu,
  test,
  uniqueText,
} from "./helpers";
import { TEAMS_STUB_URL } from "../playwright.config";

// The v4.5.0 Microsoft Teams notification channel, exercised against the compose stack's
// `teams-stub` (a WireMock stand-in for Entra, Graph and the Bot Connector — see
// dev/teams-stub/). The stub's request journal is the "inbox": every direct message the app
// sends is a POST to .../v3/conversations/{id}/activities there. The spec skips itself when
// the stub is unreachable (the Mailpit posture of mfa.spec). It owns its state exclusively:
// throwaway users minted over the API, and only the journal entries naming THEIR email (the
// stub derives the Entra object id and the conversation id from it).

type JournalEntry = {
  request: { url: string; method: string; body: string };
  response: { status: number };
};

async function journalFor(email: string): Promise<JournalEntry[]> {
  const res = await fetch(`${TEAMS_STUB_URL}/__admin/requests`);
  const { requests } = (await res.json()) as { requests: JournalEntry[] };
  // Match the raw and the percent-encoded form rather than decoding the shared journal: another
  // entry's text may carry a bare "%" that decodeURIComponent would throw on.
  const encoded = encodeURIComponent(email);
  return requests.filter((r) => {
    const haystack = r.request.url + r.request.body;
    return haystack.includes(email) || haystack.includes(encoded);
  });
}

/**
 * Skips the scenario unless THIS app under test actually has a live Teams transport — the stub
 * being up is not enough (the dev stack's `:server:run` and a one-off container default to
 * `teams.transport=disabled`). Called once the target's flag is on, when `teamsAvailable`
 * reflects the deployment alone.
 */
async function skipUnlessTeamsLive(request: APIRequestContext, token: string, userId: number) {
  const res = await request.get(`/api/v1/users/${userId}/notification-preferences`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  const { teamsAvailable } = (await res.json()) as { teamsAvailable: boolean };
  test.skip(!teamsAvailable, "the app under test has no live Teams transport (teams.transport=disabled)");
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/v1/login", { data: { email: ADMIN, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

async function mintUser(request: APIRequestContext, token: string, namePrefix: string) {
  const name = uniqueText(namePrefix);
  const user = {
    name,
    email: `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`,
    password: `e2e-${uniqueText("pw")}`,
  };
  const created = await request.post("/api/v1/users", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name: user.name, email: user.email, password: user.password },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: number };
  return { id, ...user };
}

/** The user changes their own password over the API — PASSWORD_CHANGED is locked on for every channel. */
async function changeOwnPassword(request: APIRequestContext, user: { id: number; email: string; password: string }) {
  const loginRes = await request.post("/api/v1/login", { data: { email: user.email, password: user.password } });
  expect(loginRes.ok()).toBeTruthy();
  const { token } = (await loginRes.json()) as { token: string };
  const next = `${user.password}-2`;
  const res = await request.put(`/api/v1/users/${user.id}/password`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { password: next, currentPassword: user.password },
  });
  expect(res.status()).toBe(204);
  return next;
}

test.beforeEach(async () => {
  const stubUp = await fetch(`${TEAMS_STUB_URL}/__admin/health`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!stubUp, "teams-stub (compose stack) is not reachable — Teams delivery untestable");
});

test("an admin switches Microsoft Teams on for a user, the Teams column appears, and a notification arrives as a Teams direct message", async ({
  page,
  request,
}) => {
  const token = await adminToken(request);
  const owner = await mintUser(request, token, "E2E Teams");

  // Opt-in default: before an admin enables the flag, the preferences page has no Teams column.
  await login(page, owner.email, owner.password);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Notification preferences" }).click();
  await expect(page.getByRole("switch", { name: "My password was changed — In app" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "My password was changed — Microsoft Teams" })).toHaveCount(0);
  await logout(page);

  // The admin enables it on the per-user features editor; the switch starts OFF.
  await login(page, ADMIN);
  await page.goto(`/users/${owner.id}/features`);
  const teamsSwitch = page.getByRole("switch", { name: "Microsoft Teams notifications" });
  await expect(teamsSwitch).not.toBeChecked();
  await teamsSwitch.click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);
  await skipUnlessTeamsLive(request, token, owner.id);

  // The owner now sees the Teams column; the locked security type is on and cannot be turned off.
  await login(page, owner.email, owner.password);
  await openUserMenu(page);
  await page.getByRole("menuitem", { name: "Notification preferences" }).click();
  const lockedTeams = page.getByRole("switch", { name: "My password was changed — Microsoft Teams" });
  await expect(lockedTeams).toBeChecked();
  await expect(lockedTeams).toBeDisabled();
  await logout(page);

  // A real notification: the owner changes their own password. Delivery is asynchronous (the
  // fire-and-forget mirror), so poll the stub's journal for this owner's activity POST.
  await changeOwnPassword(request, owner);
  await expect
    .poll(
      async () =>
        (await journalFor(owner.email)).find(
          (r) => r.request.method === "POST" && /\/activities$/.test(r.request.url),
        )?.request.body ?? null,
      { timeout: 15_000 },
    )
    .toContain("Your password was changed.");

  const entries = await journalFor(owner.email);
  // The Graph lookup is by the Lettuce email; the conversation is created for the resolved id.
  expect(entries.some((r) => r.request.method === "GET" && r.request.url.includes("/graph/v1.0/users/"))).toBe(true);
  const conversation = entries.find((r) => r.request.method === "POST" && /\/v3\/conversations$/.test(r.request.url));
  expect(conversation).toBeDefined();
  expect(JSON.parse(conversation!.request.body)).toMatchObject({
    members: [{ id: `aad-${owner.email}` }],
  });
  const activity = entries.find((r) => r.request.method === "POST" && /\/activities$/.test(r.request.url));
  expect(JSON.parse(activity!.request.body)).toMatchObject({ type: "message" });
});

test("a user the Teams app was never installed for gets no Teams message, while the notification still reaches the bell", async ({
  page,
  request,
}) => {
  const token = await adminToken(request);
  // The stub answers the real 403 ForbiddenOperationException for any member id naming
  // "teams-not-installed" — the tenant never installed the Lettuce app for this person.
  const owner = await mintUser(request, token, "E2E teams-not-installed");
  const flags = await request.put(`/api/v1/users/${owner.id}/features`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { disabledFeatures: ["MFA"] },
  });
  expect(flags.status()).toBe(204);
  await skipUnlessTeamsLive(request, token, owner.id);

  const newPassword = await changeOwnPassword(request, owner);

  // The conversation attempt is answered 403 and no activity is ever posted.
  await expect
    .poll(
      async () =>
        (await journalFor(owner.email)).find(
          (r) => r.request.method === "POST" && /\/v3\/conversations$/.test(r.request.url),
        )?.response.status ?? null,
      { timeout: 15_000 },
    )
    .toBe(403);
  expect(
    (await journalFor(owner.email)).some((r) => r.request.method === "POST" && /\/activities$/.test(r.request.url)),
  ).toBe(false);

  // The unreachable Teams channel never costs the in-app one.
  await login(page, owner.email, newPassword);
  const bell = await openBell(page);
  await expect(notificationCard(bell, "Your password was changed.")).toBeVisible();
});
