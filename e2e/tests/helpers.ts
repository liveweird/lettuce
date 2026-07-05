import { test as base, expect, type Locator, type Page } from "@playwright/test";

// Suppress the first-run onboarding tour (react-joyride) — its overlay intercepts clicks. The app
// starts it only when `hasSeenTour(userId)` is false (localStorage key `lettuce.tour.seen.<id>`);
// forcing that read to "1" keeps the tour from ever launching, deterministically and with no wait.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const orig = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (typeof key === "string" && key.startsWith("lettuce.tour.seen.")) return "1";
        return orig.call(this, key);
      };
    });
    await use(page);
  },
});

export { expect };

export const ADMIN = "admin@lettuce.local";
export const MANAGER_AAA = "manager-aaa@lettuce.local";
export const AAA_ONE = "aaa-one@lettuce.local";
export const AAA_TWO = "aaa-two@lettuce.local";
export const AAA_THREE = "aaa-three@lettuce.local";
export const PASSWORD = "changeme";

// POST /login is rate-limited per IP (10 requests / 60 s, auth/AuthRoutes.kt) and the serial
// suite fires logins faster than that in bursts. The SPA surfaces any 429 as the lockout alert,
// so on that alert we wait for the bucket to refill and resubmit rather than failing the spec.
const RATE_LIMIT_ALERT = "Too many failed login attempts";
const RATE_LIMIT_RETRIES = 9;
const RATE_LIMIT_WAIT_MS = 10_000;

/** Log in through the real login form and wait for the dashboard to render. */
export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  // Target by textbox role: getByLabel("Password") also matches the visibility-toggle button.
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  const loggedIn = page.getByRole("button", { name: "Logout" });
  const limited = page.getByText(RATE_LIMIT_ALERT);
  for (let attempt = 0; attempt < RATE_LIMIT_RETRIES; attempt++) {
    await page.getByRole("button", { name: "Sign in" }).click();
    // Authenticated: the app shell (with Logout) is up.
    await expect(loggedIn.or(limited).first()).toBeVisible({ timeout: 15_000 });
    if (await loggedIn.isVisible()) {
      // The app may restore a "previously-intended page" after sign-in (React Router's
      // location.state.from survives a same-URL goto("/login") because browsers keep
      // history.state across reloads). Land deterministically on the dashboard instead.
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
      return;
    }
    await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
  }
  throw new Error(`Login for ${email} still rate-limited after ${RATE_LIMIT_RETRIES} attempts`);
}

/**
 * Assert that credentials are rejected as invalid (not merely rate-limited): on the 429 alert,
 * wait out the per-IP login bucket and resubmit until the server actually evaluates them.
 */
export async function expectLoginRejected(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  const invalid = page.getByText(/invalid email or password/i);
  const limited = page.getByText(RATE_LIMIT_ALERT);
  for (let attempt = 0; attempt < RATE_LIMIT_RETRIES; attempt++) {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(invalid.or(limited).first()).toBeVisible({ timeout: 15_000 });
    if (await invalid.isVisible()) return;
    await page.waitForTimeout(RATE_LIMIT_WAIT_MS);
  }
  throw new Error(`Login for ${email} still rate-limited after ${RATE_LIMIT_RETRIES} attempts`);
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}

/** The feedback content editor (MDXEditor) is a Lexical contenteditable. */
export function contentEditor(page: Page) {
  return page.locator('[contenteditable="true"]').first();
}

/** Type into the WYSIWYG content editor (contenteditable doesn't accept `fill`). */
export async function typeContent(page: Page, text: string): Promise<void> {
  const editor = contentEditor(page);
  await editor.click();
  await editor.pressSequentially(text);
}

/** Collision-free text so specs never depend on absolute counts or clean state. */
export function uniqueText(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Open /users filtered by `name`, so the row is on page 1 regardless of how many throwaway
 * E2E users prior runs have accumulated in the shared database.
 */
export async function gotoUserRow(page: Page, name: string): Promise<void> {
  await page.goto("/users");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

/**
 * Create a feedback about `subjectName` through the real UI ("Provide feedback for …" on /users).
 * `action` picks the create button: "Save draft" (→ DRAFT) or "Save & send" (→ SENT, a single
 * create-as-SENT POST). Returns the new feedback's id captured from the API response.
 */
export async function provideFeedback(
  page: Page,
  subjectName: string,
  body: string,
  action: "Save draft" | "Save & send" = "Save draft",
): Promise<number> {
  await gotoUserRow(page, subjectName);
  await page.getByRole("link", { name: `Provide feedback for ${subjectName}` }).click();
  await expect(page).toHaveURL(/\/feedback\/new/);
  await typeContent(page, body);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/feedbacks") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: action }).click(),
  ]);
  return (await created.json()).id;
}

/** Open /feedback/{id}/view and assert the header's Status badge shows `expected`. */
export async function expectStatus(page: Page, id: number, expected: string): Promise<void> {
  await page.goto(`/feedback/${id}/view`);
  await expect(page.getByLabel("Status")).toHaveText(expected);
}

/** Open the notifications bell modal; returns the dialog locator. */
export async function openBell(page: Page) {
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Notifications")).toBeVisible();
  return dialog;
}

/**
 * The notification row whose message contains `text`. Notification texts interpolate only party
 * names (not unique content), so identical messages accumulate across runs — the list is sorted
 * newest-first, so `.first()` is the one this spec just minted.
 */
export function notificationCard(dialog: Locator, text: string) {
  return dialog.getByRole("listitem").filter({ hasText: text }).first();
}

/**
 * Create a throwaway user through the real UI (admin must be logged in) and capture the
 * generated password from the one-time reveal modal. Never mutate seeded accounts — use this.
 */
export async function createUserViaUi(
  page: Page,
  namePrefix = "E2E User",
): Promise<{ id: number; name: string; email: string; password: string }> {
  const name = uniqueText(namePrefix);
  const email = `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`;
  await page.goto("/users/new");
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/users") && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Create" }).click(),
  ]);
  const id: number = (await created.json()).id;
  const dialog = page.getByRole("dialog");
  const password = (await dialog.locator("code").textContent()) ?? "";
  await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page).toHaveURL(/\/users$/);
  return { id, name, email, password };
}

/**
 * Sort a feedback table newest-first by clicking its "Last modified" header twice (asc → desc).
 * The tables default-sort by person name, so a freshly created row can fall off page 1 once the
 * shared database accumulates feedbacks from prior runs. `nth` picks the table on pages that
 * render more than one (e.g. the per-user two-way screen).
 */
export async function sortNewestFirst(page: Page, nth = 0): Promise<void> {
  const header = page.getByRole("button", { name: "Last modified" }).nth(nth);
  await header.click();
  await header.click();
}

/**
 * Pick an option in a searchable Mantine Select by typing, then clicking the option.
 * Target by combobox role: Mantine keeps the (aria-labelled) listbox div in the DOM even while
 * closed, so getByLabel on a Select is always ambiguous.
 */
export async function pickSelectOption(page: Page, label: string, optionName: string): Promise<void> {
  const input = page.getByRole("combobox", { name: label });
  await input.click();
  await input.fill(optionName);
  await page.getByRole("option", { name: optionName }).click();
}
