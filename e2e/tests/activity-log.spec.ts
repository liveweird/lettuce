import {
  test,
  expect,
  login,
  logout,
  gotoUserRow,
  uniqueText,
  ADMIN,
  PASSWORD,
} from "./helpers";
import { apiToken, authHeader } from "./api";
import type { APIRequestContext } from "@playwright/test";

// The per-person activity log (v4.9.0), end to end on a throwaway cast: an employee E reporting to
// a manager M (in a new E2E team), an unrelated peer P and an HR auditor H. E signs in and drafts a
// feedback about M (PROVIDER_SUBJECT); E's own "My activity" shows both. M reads E's log from the
// subordinates card and sees the sign-in but NOT the draft (M cannot read an undelivered draft in
// their own right); H audits it from the Audit section and sees everything; once E sends the
// feedback — M is its subject, so now a reader in their own right — M sees the draft's rows too.
// P, outside E's chain, gets no Activity button and the permission message at the URL. Owns all its
// state: five throwaway users, one team and one feedback (E -> M); nothing else in the suite
// touches them, and the residue sweep removes the users and the team.

type Person = { id: number; name: string; email: string; password: string };

async function createPerson(
  request: APIRequestContext,
  adminToken: string,
  prefix: string,
  roles: string[] = [],
): Promise<Person> {
  const name = uniqueText(prefix);
  const email = `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`;
  const password = `e2e-${uniqueText("pw")}`;
  const response = await request.post("/api/v1/users", {
    headers: authHeader(adminToken),
    data: { name, email, password, roles },
  });
  expect(response.ok(), `create ${email}`).toBeTruthy();
  return { id: ((await response.json()) as { id: number }).id, name, email, password };
}

test("a manager sees only the readable part of a report's activity log, HR sees all, a peer is refused", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);

  // Setup: the cast, the E2E team (M manages E), and E's DRAFT feedback about M.
  const adminToken = await apiToken(request, ADMIN, PASSWORD);
  const employee = await createPerson(request, adminToken, "E2E Act Employee");
  const manager = await createPerson(request, adminToken, "E2E Act Manager");
  const peer = await createPerson(request, adminToken, "E2E Act Peer");
  const auditor = await createPerson(request, adminToken, "E2E Act Auditor", ["HR"]);
  const team = await request.post("/api/v1/teams", {
    headers: authHeader(adminToken),
    data: { name: uniqueText("E2E Act Team"), managerId: manager.id, memberIds: [employee.id] },
  });
  expect(team.ok()).toBeTruthy();

  const body = uniqueText("E2E activity draft");
  const employeeToken = await apiToken(request, employee.email, employee.password);
  const created = await request.post("/api/v1/feedbacks", {
    headers: authHeader(employeeToken),
    data: {
      providerId: employee.id,
      subjectId: manager.id,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: body,
    },
  });
  expect(created.ok()).toBeTruthy();
  const feedbackId = ((await created.json()) as { id: number }).id;

  const isActivityOf = (userId: number) => (r: { url(): string; request(): { method(): string }; ok(): boolean }) =>
    new RegExp(`/api/v1/users/${userId}/activity\\?`).test(r.url()) && r.request().method() === "GET" && r.ok();
  const draftRow = "Feedback created as a draft.";
  const sentRow = "Status changed from Draft to Sent.";

  // 1. E signs in through the form (a SIGNED_IN row) and finds both the sign-in and the draft in
  //    "My activity" — the draft's label links to the document.
  await login(page, employee.email, employee.password);
  await Promise.all([page.waitForResponse(isActivityOf(employee.id)), page.goto("/activity")]);
  await expect(page.getByRole("heading", { level: 2, name: "My activity" })).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(draftRow)).toBeVisible();
  await expect(page.getByRole("link", { name: `From ${employee.name} to ${manager.name}` })).toBeVisible();
  await logout(page);

  // 2. M opens E's log from the subordinates card: the sign-in is there, the draft is not (hidden,
  //    never redacted — the page does not even hint that a feedback exists).
  await login(page, manager.email, manager.password);
  await page.goto("/?tab=subordinates");
  await Promise.all([
    page.waitForResponse(isActivityOf(employee.id)),
    page.getByRole("link", { name: `Activity log of ${employee.name}` }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 2, name: `Activity of ${employee.name}` })).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(draftRow)).toHaveCount(0);
  // No Feedback area pill either (scoped to the page body — the nav also says "Feedback").
  await expect(page.locator("#main-content").getByText("Feedback", { exact: true })).toHaveCount(0);
  await logout(page);

  // 3. H audits E from the user-details Audit section: the draft is in the log (HR reads all).
  await login(page, auditor.email, auditor.password);
  await gotoUserRow(page, employee.name);
  await page.getByRole("link", { name: `User details for ${employee.name}` }).click();
  await expect(page.getByText("Audit", { exact: true })).toBeVisible();
  await Promise.all([
    page.waitForResponse(isActivityOf(employee.id)),
    page.getByRole("link", { name: `Audit the activity log of ${employee.name}` }).click(),
  ]);
  await expect(page.getByText(`The auditor view: everything ${employee.name} did`, { exact: false })).toBeVisible();
  await expect(page.getByText(draftRow)).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true }).first()).toBeVisible();
  await logout(page);

  // 4. E sends the feedback from the editor (the status change joins E's log).
  await login(page, employee.email, employee.password);
  await page.goto(`/feedback/${feedbackId}/edit`);
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith(`/feedbacks/${feedbackId}/send`) && r.request().method() === "POST" && r.ok(),
    ),
    page.getByRole("button", { name: "Save & send" }).click(),
  ]);
  await Promise.all([page.waitForResponse(isActivityOf(employee.id)), page.goto("/activity")]);
  await expect(page.getByText(sentRow)).toBeVisible();
  await logout(page);

  // 5. M — now the subject of a DELIVERED feedback, a reader in their own right — sees its rows.
  await login(page, manager.email, manager.password);
  await Promise.all([
    page.waitForResponse(isActivityOf(employee.id)),
    page.goto(`/users/${employee.id}/activity?name=${encodeURIComponent(employee.name)}&from=subordinates&manages=1`),
  ]);
  await expect(page.getByText(draftRow)).toBeVisible();
  await expect(page.getByText(sentRow)).toBeVisible();
  await logout(page);

  // 6. P, outside E's chain: no Activity button on E's details, and the direct URL is refused.
  await login(page, peer.email, peer.password);
  await page.goto(`/users/${employee.id}/details?name=${encodeURIComponent(employee.name)}`);
  await expect(page.getByText(employee.email)).toBeVisible();
  await expect(page.getByRole("link", { name: /^(Audit the )?[Aa]ctivity log of / })).toHaveCount(0);
  await Promise.all([
    page.waitForResponse(
      (r) => new RegExp(`/api/v1/users/${employee.id}/activity\\?`).test(r.url()) && r.status() === 403,
    ),
    page.goto(`/users/${employee.id}/activity?name=${encodeURIComponent(employee.name)}`),
  ]);
  await expect(page.getByText("You don't have permission to view this activity log.")).toBeVisible();
  await expect(page.getByText(draftRow)).toHaveCount(0);
});
