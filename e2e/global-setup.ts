import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_URL } from "./playwright.config";

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
  "aaa-one@lettuce.local",
  "aaa-two@lettuce.local",
  "aaa-three@lettuce.local",
];

async function apiLogin(email: string): Promise<string | null> {
  // Retry through the per-IP /login bucket (10/min) like helpers.login() does.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/v1/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "changeme" }),
    });
    if (res.ok) return ((await res.json()) as { token: string }).token;
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
  const token = await apiLogin(email);
  if (token == null) return 0;
  const headers = { Authorization: `Bearer ${token}` };
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

async function clearSeedLeftovers(): Promise<void> {
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
