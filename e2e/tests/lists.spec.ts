import { test, expect, login, createUserViaUi, ADMIN , openFilters } from "./helpers";

// List-page plumbing on the Users page as the representative (all lists share usePagedSort /
// FilterPanel / SortHeader / PaginationBar): filtering, clearing, sort toggling, page size.
// Two throwaway users sharing a unique stamp give the filter a deterministic two-row result.
test("users list filters, sorts, and changes page size", async ({ page }) => {
  // Short stamp: createUserViaUi appends its own unique suffix and names must stay ≤ 50 chars.
  // The random tail keeps the stamp unique even against a parallel worker in the same ms.
  const stamp = `E2E-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await login(page, ADMIN);
  const first = await createUserViaUi(page, `${stamp}-AAAA`);
  const last = await createUserViaUi(page, `${stamp}-ZZZZ`);

  await page.goto("/users");
  await openFilters(page);

  // Name filter → exactly our two rows, default-sorted by name ascending.
  await page.getByLabel("Name", { exact: true }).fill(stamp);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("tbody tr").first()).toContainText(first.name);

  // Toggling the Name header flips to descending.
  await page.getByRole("button", { name: "Name", exact: true }).click();
  await expect(page.locator("tbody tr").first()).toContainText(last.name);

  // Email filter composes (both rows share the stamp in their emails too).
  await page.getByLabel("Email", { exact: true }).fill(last.email);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear email filter" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(2);

  // Flip the sort back to ascending, then clear the name filter: the unfiltered list reappears
  // with seeded "AAA One" on page 1 — stable forever under name-asc, unlike the old descending
  // "Manager CCC" assert, which the accumulating throwaway users (e.g. users-import's fixed
  // "Re Import" rows) would eventually push off page 1.
  await page.getByRole("button", { name: "Name", exact: true }).click();
  await page.getByRole("button", { name: "Clear name filter" }).click();
  await expect(page.getByText("AAA One", { exact: true }).first()).toBeVisible();

  // Page-size change re-queries with pageSize=40.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("pageSize=40") && r.ok()),
    (async () => {
      await page.getByRole("combobox", { name: "Rows per page" }).click();
      await page.getByRole("option", { name: "40 / page" }).click();
    })(),
  ]);
});
