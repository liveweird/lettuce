import { test, expect, expectLoginRejected, login, logout, createUserViaUi, ADMIN, uniqueText } from "./helpers";

// Self-service password reset (v1.3): the "Forgot password?" flow on the login screen.
// The full email roundtrip needs the compose stack's Mailpit catcher (http://localhost:8025);
// when it is unreachable (e.g. a dev stack on the log transport) that one test skips itself.

const MAILPIT = "http://localhost:8025";

test("the forgot-password link leads to the reset form; unknown emails get the neutral answer", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/reset-password$/);
  // Lazy route: wait for an element unique to the reset page before interacting.
  await expect(page.getByRole("button", { name: "Send new password" })).toBeVisible();

  await page
    .getByRole("textbox", { name: "Email" })
    .fill(`${uniqueText("e2e-reset-nobody").toLowerCase().replace(/[^a-z0-9-]/g, "-")}@lettuce.local`);
  await page.getByRole("button", { name: "Send new password" }).click();
  await expect(page.getByText(/if an account with this address exists/i)).toBeVisible();

  // A second request for the same address within a minute is throttled with a clear message.
  await page.goto("/reset-password");
  const again = page.getByRole("textbox", { name: "Email" });
  await again.fill("e2e-reset-throttle@lettuce.local");
  await page.getByRole("button", { name: "Send new password" }).click();
  await expect(page.getByText(/if an account with this address exists/i)).toBeVisible();
  await page.goto("/reset-password");
  await page.getByRole("textbox", { name: "Email" }).fill("e2e-reset-throttle@lettuce.local");
  await page.getByRole("button", { name: "Send new password" }).click();
  await expect(page.getByText(/only one reset request per minute/i)).toBeVisible();
});

test("a reset email delivers a working new password and kills the old one", async ({ page }) => {
  const mailpitUp = await fetch(`${MAILPIT}/api/v1/messages`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!mailpitUp, "Mailpit (compose stack) is not reachable — email roundtrip untestable");

  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Reset");
  await logout(page);

  await page.goto("/reset-password");
  await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("button", { name: "Send new password" }).click();
  await expect(page.getByText(/if an account with this address exists/i)).toBeVisible();

  // Pull the new password out of the Mailpit catcher (delivery is asynchronous).
  let newPassword: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json());
        const msg = list.messages?.find((m: { To?: { Address: string }[] }) =>
          m.To?.some((t) => t.Address === user.email),
        );
        if (!msg) return undefined;
        const text: string = (
          await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json())
        ).Text;
        newPassword = text.match(/^[A-Za-z0-9_-]{16}$/m)?.[0];
        return newPassword;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  await login(page, user.email, newPassword!);
  await logout(page);

  // The old password no longer works. Via the retrying helper — a one-shot click can land
  // on the per-IP login bucket's 429 message instead of the rejection (roaming-429 shape).
  await expectLoginRejected(page, user.email, user.password);
});
