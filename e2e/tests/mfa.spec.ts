import { test, expect, login, logout, createUserViaUi, ADMIN, userMenu } from "./helpers";

// Email MFA at login (v2.4.0): the admin enables the inverted-default MFA flag for a throwaway
// user; that user's next sign-in demands the 6-digit code emailed to them. The code roundtrip
// needs the compose stack's Mailpit catcher (the password-reset.spec posture) — the test skips
// itself when Mailpit is unreachable. The spec owns its state exclusively: a unique throwaway
// user and only that user's inbox; the seeded accounts stay MFA-off (V52), so every other
// spec's login path is untouched.

const MAILPIT = "http://localhost:8025";

test("an MFA-enabled user must enter the emailed code; a wrong code is rejected inline", async ({
  page,
}) => {
  const mailpitUp = await fetch(`${MAILPIT}/api/v1/messages`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!mailpitUp, "Mailpit (compose stack) is not reachable — email roundtrip untestable");

  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Mfa");

  // Enable MFA on the per-user features editor: the switch starts OFF (opt-in default).
  await page.goto(`/users/${user.id}/features`);
  const mfaSwitch = page.getByRole("switch", { name: "MFA (email sign-in code)" });
  await expect(mfaSwitch).not.toBeChecked();
  await mfaSwitch.click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/users$/);
  await logout(page);

  // The real form path: correct credentials land on the code step, not the dashboard.
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Enter your sign-in code" })).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();

  // Pull the 6-digit code out of Mailpit (delivery is asynchronous).
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json());
        const msg = list.messages?.find(
          (m: { To?: { Address: string }[]; Subject?: string }) =>
            m.To?.some((t) => t.Address === user.email) &&
            m.Subject?.includes("sign-in code"),
        );
        if (!msg) return undefined;
        const text: string = (
          await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json())
        ).Text;
        code = text.match(/^\d{6}$/m)?.[0];
        return code;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  const codeBoxes = page.getByLabel("Sign-in code").getByRole("textbox");
  const wrong = code === "000000" ? "000001" : "000000";

  // A wrong code stays on the code step with the inline error (uniform 401 server-side).
  await codeBoxes.first().click();
  await page.keyboard.type(wrong);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/invalid or expired code/i)).toBeVisible();

  // Burn the rest of the attempt cap (5): four more wrong submissions, same uniform wording
  // every time — the reason (wrong vs capped) lives only in the server's audit log.
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let i = 0; i < 6; i++) await codeBoxes.nth(i).fill(wrong[i]);
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/invalid or expired code/i)).toBeVisible();
  }

  // The cap killed the challenge: even the CORRECT code now gets the same rejection
  // (2026-08 audit round — the too-many-attempts path).
  for (let i = 0; i < 6; i++) await codeBoxes.nth(i).fill(code![i]);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/invalid or expired code/i)).toBeVisible();

  // A fresh sign-in mints a fresh challenge and code; that roundtrip completes.
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("textbox", { name: "Password" }).fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Enter your sign-in code" })).toBeVisible();
  const firstCode = code;
  await expect
    .poll(
      async () => {
        const list = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json());
        const msg = list.messages?.find(
          (m: { To?: { Address: string }[]; Subject?: string }) =>
            m.To?.some((t) => t.Address === user.email) &&
            m.Subject?.includes("sign-in code"),
        );
        if (!msg) return undefined;
        const text: string = (
          await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json())
        ).Text;
        const fresh = text.match(/^\d{6}$/m)?.[0];
        // Mailpit lists newest first — wait until the NEW challenge's mail is on top.
        if (fresh && fresh !== firstCode) code = fresh;
        return fresh !== firstCode ? fresh : undefined;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();
  const freshBoxes = page.getByLabel("Sign-in code").getByRole("textbox");
  for (let i = 0; i < 6; i++) await freshBoxes.nth(i).fill(code![i]);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(userMenu(page)).toBeVisible({ timeout: 15_000 });
  await logout(page);
});
