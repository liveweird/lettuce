import { test, expect, login, logout, uniqueText, AAA_TWO, MANAGER_AAA } from "./helpers";
import { apiToken, authHeader } from "./api";

// Impact log (v2.36.0): the per-employee accomplishment journal — owner-only writes,
// chain-manager reads. This file exclusively owns AAA Two's journal (the slot freed by the
// retired self-reflection spec); the entry is deleted in-test, with an API fallback so a
// failed run leaves no residue behind for the next one.
let entryId: number | null = null;

test.afterEach(async ({ request }) => {
  if (entryId == null) return;
  const id = entryId;
  entryId = null;
  const token = await apiToken(request, AAA_TWO);
  await request.delete(`/api/v1/impact-log/${id}`, { headers: authHeader(token) });
});

test("an employee journals an accomplishment, their manager reads it, and the owner deletes it", async ({
  page,
}) => {
  const title = uniqueText("E2E impact title");
  const happened = uniqueText("E2E impact happened");
  const contribution = uniqueText("E2E impact contribution");

  // 1. The owner creates an entry in their own journal.
  await login(page, AAA_TWO);
  await page.getByRole("link", { name: "Impact log" }).click();
  await expect(page.getByRole("heading", { name: "Impact log" })).toBeVisible();
  await page.getByRole("link", { name: "New entry" }).click();
  await expect(page.getByRole("heading", { name: "New journal entry" })).toBeVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Period start").fill("2026-07-01");
  await page.getByLabel("Period end").fill("2026-07-31");

  // The wizard (v2.37.0): one section per step, walked with Next — exactly ONE markdown
  // editor is mounted at a time. The step rail names all five steps up front.
  await expect(page.getByRole("button", { name: /Review/ })).toBeVisible();
  const sections = [happened, contribution, "It unblocked the quarter.", "Kudos from the whole team."];
  for (const text of sections) {
    const editor = page.locator('[contenteditable="true"]');
    await expect(editor).toHaveCount(1);
    await editor.click();
    await editor.pressSequentially(text);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  // The Review step shows the whole entry rendered, and the final Next must have LANDED here
  // without submitting — the submit is a type="button" precisely so the browser's click
  // activation re-hit-test (Next unmounts, the submit mounts under the pointer) stays inert.
  await expect(page.getByText(happened)).toBeVisible();
  await expect(page.getByText(contribution)).toBeVisible();
  const createButton = page.getByRole("button", { name: "Create", exact: true });
  await expect(createButton).toBeEnabled();
  const [created] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/impact-log") && r.request().method() === "POST" && r.ok(),
    ),
    // exact stays load-bearing: the markdown toolbar carries a "Create link" button.
    createButton.click(),
  ]);
  entryId = ((await created.json()) as { id: number }).id;

  // Back on the journal: the fresh row shows its period and preview.
  await expect(page.getByText("Journal entry created").first()).toBeVisible();
  const row = page.locator("tr", { hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("Jul 1, 2026 – Jul 31, 2026")).toBeVisible();

  // 2. The owner opens the entry: all four sections render, History holds the creation.
  await row.getByRole("link", { name: /^View entry/ }).click();
  await expect(page.getByRole("heading", { name: "Journal entry" })).toBeVisible();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByText(happened)).toBeVisible();
  await expect(page.getByText(contribution)).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(
    page.getByText("Entry created for the period Jul 1, 2026 – Jul 31, 2026."),
  ).toBeVisible();

  // 3. The owner edits one section — walking the wizard to "Why it mattered" (Back never
  //    loses input; pre-filled steps pass validation instantly), then on to Review to Save.
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit journal entry" })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  const whyEditor = page.locator('[contenteditable="true"]');
  await expect(whyEditor).toHaveText(/unblocked the quarter/);
  await whyEditor.click();
  await whyEditor.pressSequentially(" And it set next quarter's direction.");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("And it set next quarter's direction.")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Journal entry updated").first()).toBeVisible();

  await page.locator("tr", { hasText: title }).getByRole("link", { name: /^View entry/ }).click();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Entry updated: Why did it matter.")).toBeVisible();
  await logout(page);

  // 4. The manager reads it from the managed tab — strictly read-only.
  await login(page, MANAGER_AAA);
  await page.getByRole("link", { name: "Impact log" }).click();
  await page.getByRole("tab", { name: "My subordinates' journals" }).click();
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Author").fill("AAA Two");
  const managedRow = page.locator("tr", { hasText: title });
  await expect(managedRow).toBeVisible();
  await expect(managedRow.getByRole("link", { name: /^Edit entry/ })).toHaveCount(0);
  await managedRow.getByRole("link", { name: /^View entry/ }).click();
  await expect(page.getByText(happened)).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  // 4b. The person-card drill-down (v2.38.0): the subordinate card's Performance section
  //     links straight to this report's journal — pinned to them, no Author column.
  await page.goto("/?tab=subordinates");
  await page
    .locator("li", { hasText: "AAA Two" })
    .first()
    .getByRole("link", { name: "Impact log of AAA Two" })
    .click();
  await expect(page).toHaveURL(/\/users\/\d+\/impact-log/);
  await expect(page.getByRole("heading", { name: "Impact log — AAA Two" })).toBeVisible();
  const pinnedRow = page.locator("tr", { hasText: title });
  await expect(pinnedRow).toBeVisible();
  await expect(page.getByRole("button", { name: "Author" })).toHaveCount(0);
  await logout(page);

  // 5. The owner deletes the entry; the journal is empty of it again.
  await login(page, AAA_TWO);
  await page.getByRole("link", { name: "Impact log" }).click();
  const ownRow = page.locator("tr", { hasText: title });
  await ownRow.getByRole("button", { name: /^Delete entry/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Journal entry deleted").first()).toBeVisible();
  await expect(page.locator("tr", { hasText: title })).toHaveCount(0);
  entryId = null; // deleted in-test — the afterEach fallback has nothing to do
});
