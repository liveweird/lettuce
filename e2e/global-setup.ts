import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL } from "./playwright.config";
import type { LoginBody } from "./sessions";
import { sweepResidue } from "./sweep-residue";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
export const STARTED_MARKER = resolve(here, ".playwright", "stack-started");

async function responds(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "manual" });
    // Any HTTP response (the SPA index or a redirect) means the server is accepting connections.
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForUp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await responds(url)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for the app at ${url}`);
}

// The seed accounts the specs create feedbacks with. The server's no-duplicate invariant
// (v1.13) rejects creating a feedback while an open DRAFT/REQUESTED with the same
// (subject, provider, requester) triple exists — so leftovers from earlier runs in the shared
// volume would block the fixed seed pairs. Clear each account's open PROVIDED feedbacks
// up-front: drafts are deleted (provider-only), pending requests rejected (terminal, never
// blocks). Extra notifications this mints are tolerated like all shared-DB dirt.
const SEED_ACCOUNTS = [
  "admin@lettuce.local",
  "manager-aaa@lettuce.local",
  "manager-ccc@lettuce.local",
  "aaa-one@lettuce.local",
  "aaa-two@lettuce.local",
  "aaa-three@lettuce.local",
];

// A seed account left MFA-ENABLED (v2.4.0 drift — e.g. flipped in the feature-flags UI, or a
// pre-fix run's reset) answers the login with a challenge instead of tokens. Self-heal by
// pulling the emailed 6-digit code out of the Mailpit catcher and finishing the second step;
// without Mailpit the account is skipped with a warning (and the specs will fail loudly).
async function completeMfa(email: string, challengeId: string): Promise<LoginBody | null> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const list = (await fetch("http://localhost:8025/api/v1/messages").then((r) => r.json())) as {
        messages?: { ID: string; Subject?: string; To?: { Address: string }[] }[];
      };
      // Newest-first: the first match is the code this challenge just triggered.
      const msg = list.messages?.find(
        (m) => m.To?.some((t) => t.Address === email) && m.Subject?.includes("sign-in code"),
      );
      if (msg) {
        const text: string = (
          await fetch(`http://localhost:8025/api/v1/message/${msg.ID}`).then((r) => r.json())
        ).Text;
        const code = text.match(/^\d{6}$/m)?.[0];
        if (code) {
          const res = await fetch(`${BASE_URL}/api/v1/login/mfa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ challengeId, code }),
          });
          if (res.ok) return (await res.json()) as LoginBody;
        }
      }
    } catch {
      // Mailpit unreachable — keep polling until the deadline, then give up.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`[e2e] ${email} is MFA-enabled and no sign-in code could be fetched from Mailpit.`);
  return null;
}

async function apiLogin(email: string): Promise<LoginBody | null> {
  // Retry through the per-IP /login bucket like helpers.login() does. Development stacks lift
  // that bucket (security.rateLimit.loginPerMinute), so this normally succeeds first try.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "changeme" }),
    });
    if (res.ok) {
      const body = (await res.json()) as LoginBody & { mfaRequired?: boolean; challengeId?: string };
      if (body.mfaRequired && body.challengeId) return completeMfa(email, body.challengeId);
      return body;
    }
    if (res.status !== 429) {
      // e.g. a rotated seed password in an old volume — skip this account, don't fail the run.
      console.warn(`[e2e] Skipping open-feedback cleanup for ${email}: login answered ${res.status}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, 7000));
  }
  return null;
}

async function clearOpenProvidedFeedbacks(email: string): Promise<number> {
  const session = await apiLogin(email);
  if (session == null) return 0;
  const headers = { Authorization: `Bearer ${session.token}` };
  let cleared = 0;
  const closers: [string, (id: number) => Promise<unknown>][] = [
    ["DRAFT", (id) => fetch(`${BASE_URL}/api/v1/feedbacks/${id}`, { method: "DELETE", headers })],
    ["REQUESTED", (id) => fetch(`${BASE_URL}/api/v1/feedbacks/${id}/reject`, { method: "POST", headers })],
  ];
  for (const [status, close] of closers) {
    const res = await fetch(
      `${BASE_URL}/api/v1/feedbacks?view=provided&status=${status}&pageSize=100`,
      { headers },
    );
    if (!res.ok) continue;
    const page = (await res.json()) as { items: { id: number }[] };
    for (const item of page.items) {
      await close(item.id);
      cleared += 1;
    }
  }
  return cleared;
}

// The specs log in as the seed accounts and assume every feature AREA is enabled for them —
// a disabled flag (left by exploring the v1.53.0 feature-flags UI on the shared dev stack)
// hides nav links/card rows/tour steps and 403s the APIs, failing most of the suite at
// timeout speed. Reset the seed accounts to the pristine state up-front, as admin. Since
// v2.4.0 pristine is ["MFA"], NOT [] — MFA is the inverted-default opt-in flag, and an empty
// set would ENABLE email MFA so every seed login answers a code challenge instead of tokens
// (which fails the whole suite exactly the same way). Must run BEFORE the feedback cleanup
// below: that cleanup lists feedbacks AS each seed account, which itself 403s while
// FEEDBACKS is disabled.
const PRISTINE_DISABLED_FEATURES = ["MFA"];

async function resetSeedFeatureFlags(): Promise<void> {
  const admin = await apiLogin("admin@lettuce.local");
  if (admin == null) return;
  const headers = { Authorization: `Bearer ${admin.token}`, "Content-Type": "application/json" };
  let reset = 0;
  for (const email of SEED_ACCOUNTS) {
    const res = await fetch(
      `${BASE_URL}/api/v1/users?email=${encodeURIComponent(email)}&pageSize=100`,
      { headers },
    );
    if (!res.ok) continue;
    const page = (await res.json()) as {
      items: { id: number; email: string; disabledFeatures: string[] }[];
    };
    const user = page.items.find((u) => u.email === email);
    if (
      user == null ||
      [...user.disabledFeatures].sort().join() === PRISTINE_DISABLED_FEATURES.join()
    ) {
      continue;
    }
    await fetch(`${BASE_URL}/api/v1/users/${user.id}/features`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ disabledFeatures: PRISTINE_DISABLED_FEATURES }),
    });
    reset += 1;
  }
  if (reset > 0) console.log(`[e2e] Reset feature flags to pristine on ${reset} seed account(s).`);
}

async function clearSeedLeftovers(): Promise<void> {
  // Residue sweep first (v2.34.0): previous runs' E2E-marked teams/users off the shared
  // volume, before anything else touches the lists. Safe here — no worker has started yet.
  const admin = await apiLogin("admin@lettuce.local");
  if (admin != null) await sweepResidue(BASE_URL, admin.token);
  await resetSeedFeatureFlags();
  let total = 0;
  for (const email of SEED_ACCOUNTS) total += await clearOpenProvidedFeedbacks(email);
  console.log(`[e2e] Cleared ${total} open seed feedback(s) left over from earlier runs.`);
}

export default async function globalSetup(): Promise<void> {
  // Reuse a stack that's already up (fast local iteration); don't tear it down afterward.
  if (await responds(BASE_URL)) {
    console.log(`[e2e] Reusing the app already running at ${BASE_URL}`);
    await clearSeedLeftovers();
    return;
  }

  console.log("[e2e] Starting the stack: docker compose up -d --build …");
  execSync("docker compose up -d --build", { cwd: repoRoot, stdio: "inherit" });

  console.log(`[e2e] Waiting for ${BASE_URL} …`);
  await waitForUp(BASE_URL, 240_000);

  mkdirSync(dirname(STARTED_MARKER), { recursive: true });
  writeFileSync(STARTED_MARKER, "started-by-e2e");
  console.log("[e2e] Stack is up.");

  await clearSeedLeftovers();
}
