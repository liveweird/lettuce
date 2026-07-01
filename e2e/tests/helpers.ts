import { test as base, expect, type Page } from "@playwright/test";

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
export const PASSWORD = "changeme";

/** Log in through the real login form and wait for the dashboard to render. */
export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  // Target by textbox role: getByLabel("Password") also matches the visibility-toggle button.
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Authenticated: the app shell (with Logout) is up. Don't assert a specific landing route —
  // the app may restore a previously-intended page after sign-in.
  await expect(page.getByRole("button", { name: "Logout" })).toBeVisible();
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
