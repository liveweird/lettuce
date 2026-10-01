import {
  test,
  expect,
  login,
  logout,
  createUserViaUi,
  fillDate,
  openBell,
  notificationCard,
  openFilters,
  pickMultiSelectOptions,
  rowByTitle,
  uniqueText,
  ADMIN,
} from "./helpers";
import { apiToken, authHeader } from "./api";

// Document sharing (v4.8.0), end to end on a throwaway trio: a provider P sends a feedback about a
// subject S (PROVIDER_SUBJECT — so a bystander cannot read it), then shares it with a bystander X
// until a future date. X is notified, opens it read-only through the bell, finds it on the Shared
// screen; P withdraws from the dialog and X is locked out again. Owns all its state: three
// throwaway users and one feedback (P -> S), plus one share; nothing else in the suite touches
// them, and the residue sweep removes the users.

/** `YYYY-MM-DD`, 30 days from now — a future end date that the server accepts at any time of day. */
function futureIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("a provider shares a feedback, the sharee reads it read-only, and withdrawing ends the access", async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);

  // Setup: three throwaway people (passwords from the one-time reveal modal), then P's SENT
  // feedback about S over the API (setup only — the journey under test starts at the Share button).
  await login(page, ADMIN);
  const provider = await createUserViaUi(page, "E2E Share Provider");
  const subject = await createUserViaUi(page, "E2E Share Subject");
  const sharee = await createUserViaUi(page, "E2E Share Sharee");
  await logout(page);

  const body = uniqueText("E2E share body");
  const providerToken = await apiToken(request, provider.email, provider.password);
  const created = await request.post("/api/v1/feedbacks", {
    headers: authHeader(providerToken),
    data: {
      providerId: provider.id,
      subjectId: subject.id,
      visibility: "PROVIDER_SUBJECT",
      status: "SENT",
      content: body,
    },
  });
  expect(created.ok()).toBeTruthy();
  const feedbackId = ((await created.json()) as { id: number }).id;

  // 1. P shares it with X until a future date.
  await login(page, provider.email, provider.password);
  await page.goto(`/feedback/${feedbackId}/view`);
  await expect(page.getByText(body)).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share this document" });
  await expect(dialog).toBeVisible();
  await pickMultiSelectOptions(page, "Share with", [sharee.name]);
  await fillDate(dialog, "Until", futureIso());
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/shares") && r.request().method() === "POST" && r.ok(),
    ),
    dialog.getByRole("button", { name: "Share", exact: true }).click(),
  ]);
  await expect(page.getByText("Document shared")).toBeVisible();
  // The current shares list (this throwaway document has exactly one share) names X as an active
  // share with its end date, and offers its withdrawal.
  await expect(dialog.getByText("Active", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Until /)).toBeVisible();
  await expect(dialog.getByRole("button", { name: `Withdraw the share with ${sharee.name}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 2. X: the bell announces the share; following it opens the feedback read-only.
  await login(page, sharee.email, sharee.password);
  const bell = await openBell(page);
  const card = notificationCard(bell, `${provider.name} shared feedback with you.`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /^Go to notification \d+$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/feedback/${feedbackId}/view`));
  await expect(page.getByText(`Shared with you by ${provider.name}`)).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
  // Read-only: no Share (X holds the document only through the share), no lifecycle action.
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Withdraw", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Close" })).toBeVisible();

  // 3. X's Shared screen lists it under "Shared with me".
  await page.goto("/shares");
  await expect(page.getByRole("heading", { level: 2, name: "Shared" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Shared with me" })).toHaveAttribute("aria-selected", "true");
  const sharedRow = rowByTitle(page, `From ${provider.name} to ${subject.name}`);
  await expect(sharedRow).toBeVisible();
  await expect(sharedRow.getByText("Active", { exact: true })).toBeVisible();
  await expect(sharedRow.getByText(provider.name).first()).toBeVisible();
  await logout(page);

  // 4. P withdraws from the dialog's current shares (the confirm names the sharee).
  await login(page, provider.email, provider.password);
  await page.goto(`/feedback/${feedbackId}/view`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("button", { name: `Withdraw the share with ${sharee.name}` }).click();
  await expect(page.getByText("Withdraw this share?")).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (r) => /\/api\/v1\/shares\/\d+\/withdraw$/.test(r.url()) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Withdraw", exact: true }).click(),
  ]);
  await expect(page.getByText("Share withdrawn")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Share this document" }).getByText("Withdrawn", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await logout(page);

  // 5. X is locked out again: the Active-filtered Shared list is empty and the direct URL is refused.
  await login(page, sharee.email, sharee.password);
  await page.goto("/shares");
  await openFilters(page);
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Active", exact: true }).click();
  await expect(page.getByText("No shares match these filters.")).toBeVisible();
  await expect(rowByTitle(page, `From ${provider.name}`)).toHaveCount(0);
  await page.goto(`/feedback/${feedbackId}/view`);
  await expect(page.getByText("You don't have permission to view this feedback.")).toBeVisible();
  await expect(page.getByText(body)).toHaveCount(0);
});
