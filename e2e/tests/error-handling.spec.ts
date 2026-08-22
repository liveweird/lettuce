import type { Page, Route } from "@playwright/test";
import { ADMIN, expect, login, test, uniqueText, userMenu } from "./helpers";

// The error-hardening arc (v2.22–v2.24) verified in a real browser via network interception —
// the suite's FIRST page.route specs (v2.34.0). Read-only: no request that mutates server
// state ever reaches the server (failures are injected client-side), so this file owns
// nothing. All globs anchor at **/api/v1/ so static assets and the SPA index pass through.

// A realistic RFC 7807 body, so ApiError.detail/safeJson behave exactly as in production.
function problem(status: number): Parameters<Route["fulfill"]>[0] {
  return {
    status,
    contentType: "application/problem+json",
    body: JSON.stringify({ type: "about:blank", title: "Injected by e2e", status, detail: "Injected failure" }),
  };
}

// The templates LIST fetch — the cheapest single-query page (its create screen doubles as
// the cheapest mutation form). The glob needs the "?" so the query-less POST never matches.
const LIST_GLOB = "**/api/v1/templates?*";

async function gotoTemplates(page: Page): Promise<void> {
  await page.goto("/templates");
}

test("a failing list load shows the error alert instead of an empty table", async ({ page }) => {
  await login(page, ADMIN);
  // No { times: 1 } — React Query retries a 5xx twice (shouldRetryQuery), so the route must
  // keep answering through all three attempts before the alert renders (~3s of backoff).
  await page.route(LIST_GLOB, (route) => route.fulfill(problem(500)));
  await gotoTemplates(page);
  await expect(page.getByText("Failed to load templates")).toBeVisible();
  await expect(page.getByText("Loading failed (500).")).toBeVisible();
});

test("an unreachable server on a list load says so", async ({ page }) => {
  await login(page, ADMIN);
  await page.route(LIST_GLOB, (route) => route.abort("failed"));
  await gotoTemplates(page);
  await expect(page.getByText("Failed to load templates")).toBeVisible();
  await expect(
    page.getByText("Can't reach the server. Check your connection and try again."),
  ).toBeVisible();
});

test("a failing save shows the inline error and keeps the form", async ({ page }) => {
  await login(page, ADMIN);
  const name = uniqueText("E2E-error-probe");
  await page.goto("/templates/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  // The editor content is irrelevant to the injected failure — the name alone proves the
  // form survived. Intercept the CREATE POST only (query-less URL, method-matched).
  await page.route("**/api/v1/templates", (route) =>
    route.request().method() === "POST" ? route.fulfill(problem(500)) : route.fallback(),
  );
  // Mutations are never retried, and the response is deliberately not ok — click and assert
  // on the alert directly (no waitForResponse(ok) idiom here).
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Create failed (500)")).toBeVisible();
  await expect(page).toHaveURL(/\/templates\/new/);
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(name);
});

test("a transient refresh failure keeps the session", async ({ page }) => {
  await login(page, ADMIN);
  // The first templates fetch answers 401 ONCE, driving authedFetch into the silent-refresh
  // branch; the refresh itself answers 500 — a TRANSIENT outcome, so the session must be
  // KEPT and the original 401 becomes the page's load error (not retried — a 4xx).
  await page.route(LIST_GLOB, (route) => route.fulfill(problem(401)), { times: 1 });
  await page.route("**/api/v1/refresh", (route) => route.fulfill(problem(500)));
  await gotoTemplates(page);
  await expect(page.getByText("Loading failed (401).")).toBeVisible();
  await expect(userMenu(page)).toBeVisible();
  await expect(page).toHaveURL(/\/templates/);
  // Remove the stubs: a plain reload now loads normally — proof the tokens survived.
  await page.unroute(LIST_GLOB);
  await page.unroute("**/api/v1/refresh");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await expect(page.getByText("Loading failed (401).")).toHaveCount(0);
});

test("a rejected refresh signs the user out", async ({ page }) => {
  await login(page, ADMIN);
  // The same 401-once trigger, but the refresh answers 401 — DEFINITIVE: the session is
  // cleared, RequireAuth redirects to /login, and the signed-out banner explains why.
  await page.route(LIST_GLOB, (route) => route.fulfill(problem(401)), { times: 1 });
  await page.route("**/api/v1/refresh", (route) => route.fulfill(problem(401)));
  await gotoTemplates(page);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("You've been signed out.")).toBeVisible();
});
