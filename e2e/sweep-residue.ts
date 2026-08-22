// Sweeps the residue previous e2e runs left on the shared compose volume (globalSetup-only —
// it runs before any worker starts, so it can never race a live spec's throwaway entities).
// The marker contract (documented in README.md "Parallel execution"): every e2e-created USER
// carries `e2e` in the email (createUserViaUi derives the email from the E2E-prefixed name;
// the import fixtures hard-code e2e-import/e2e-reimport addresses), and every e2e-created
// TEAM carries `E2E` in the name. Both keys are collision-free against the V6/V9 seeds
// (admin@/aaa-*/bbb-*/manager-*@lettuce.local; teams AAA/BBB/CCC). Teams go FIRST: a deleted
// manager's name rides the team row, so users-first would strand "(deleted)" org-chart nodes.
// Rationale: unbounded residue is what broke org-chart.spec (the 708-user grid pushed the
// seeded nodes off-viewport past fitView's minZoom) — the row count must be bounded at the
// source; the spec's locators were already maximally hardened.

const USER_EMAIL_MARKER = "e2e";
const TEAM_NAME_MARKER = "E2E";

type ListPage<T> = { items: T[]; total: number };

async function sweepEntity(
  baseUrl: string,
  headers: Record<string, string>,
  listUrl: string,
  deletePath: (id: number) => string,
): Promise<number> {
  let swept = 0;
  // The list shrinks as we delete, so re-fetch page 1 until it comes back empty; stop when a
  // pass deletes nothing (a stuck row must not loop forever — leave it and report).
  for (;;) {
    const res = await fetch(`${baseUrl}${listUrl}`, { headers });
    if (!res.ok) return swept;
    const page = (await res.json()) as ListPage<{ id: number }>;
    if (page.items.length === 0) return swept;
    let deletedThisPass = 0;
    for (const item of page.items) {
      const del = await fetch(`${baseUrl}${deletePath(item.id)}`, { method: "DELETE", headers });
      if (del.ok) deletedThisPass += 1;
    }
    swept += deletedThisPass;
    if (deletedThisPass === 0) return swept;
  }
}

/** Soft-deletes marker-matching teams, then users, via the admin API. Returns nothing it
 * doesn't log; failures degrade to a smaller sweep, never a failed run. */
export async function sweepResidue(baseUrl: string, adminToken: string): Promise<void> {
  const headers = { Authorization: `Bearer ${adminToken}` };
  const teams = await sweepEntity(
    baseUrl,
    headers,
    `/api/v1/teams?name=${TEAM_NAME_MARKER}&pageSize=100`,
    (id) => `/api/v1/teams/${id}`,
  );
  const users = await sweepEntity(
    baseUrl,
    headers,
    `/api/v1/users?email=${USER_EMAIL_MARKER}&pageSize=100`,
    (id) => `/api/v1/users/${id}`,
  );
  if (teams > 0 || users > 0) {
    console.log(`[e2e] Swept ${teams} residue team(s) and ${users} residue user(s) from earlier runs.`);
  }
}
