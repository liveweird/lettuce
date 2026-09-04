import { test, expect, login, logout, ADMIN, AAA_ONE, uniqueText } from "./helpers";

// Mass user import (v1.4): CSV upload, per-row statuses, masked one-time passwords.
// Runs without the email option so it works on any stack regardless of mail transport.

test("a mixed CSV imports row-by-row and an imported password signs in", async ({ page }) => {
  const slug = uniqueText("e2e-import").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const emailA = `${slug}-a@lettuce.local`;
  const emailB = `${slug}-b@lettuce.local`;
  const csv = [
    "name,email",
    `Import Alpha,${emailA}`,
    `Kowalski, Jan,${emailB}`, // a name containing a comma
    `Dup Seed,${AAA_ONE}`, // seeded demo user → duplicate
    "this line has no comma and fails parsing",
    "",
  ].join("\n");

  await login(page, ADMIN);
  await page.goto("/users");
  await page.getByRole("link", { name: "Mass import" }).click();
  await expect(page).toHaveURL(/\/users\/import$/);
  // Lazy route: wait for an element unique to the import page before interacting.
  await expect(page.getByRole("button", { name: "Import" })).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "team.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Import" }).click();

  // Per-row summary: 2 created, 1 duplicate, 1 parse error.
  await expect(page.getByText("Created: 2 · Duplicates: 1 · Errors: 1")).toBeVisible();
  await expect(page.getByText("Duplicate — skipped")).toBeVisible();
  await expect(page.getByText("Parse error")).toBeVisible();
  const rowB = page.locator("tr", { hasText: emailB });
  await expect(rowB).toContainText("Kowalski, Jan"); // last-comma split kept the name intact

  // Passwords are masked until revealed; the revealed one really works.
  const codeB = rowB.locator("code");
  await expect(codeB).toHaveText(/^\*+$/);
  await rowB.getByRole("button", { name: "Show password" }).click();
  const password = (await codeB.textContent()) ?? "";
  expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);

  await page.getByRole("link", { name: "← Back to Users" }).click();
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);
  await login(page, emailB, password);
});

test("re-importing the same rows yields duplicates, not new accounts", async ({ page }) => {
  const slug = uniqueText("e2e-reimport").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const csv = `Re Import,${slug}@lettuce.local`;

  await login(page, ADMIN);
  for (const expected of ["Created: 1 · Duplicates: 0 · Errors: 0", "Created: 0 · Duplicates: 1 · Errors: 0"]) {
    await page.goto("/users/import");
    await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
    await page.setInputFiles('input[type="file"]', {
      name: "again.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText(expected)).toBeVisible();
  }
});
