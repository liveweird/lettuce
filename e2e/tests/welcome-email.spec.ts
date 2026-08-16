// Welcome email (admin create with the email option): the credentials are delivered to the
// mail catcher and actually work. Complements users-import.spec, which deliberately runs
// without the email option; the Mailpit roundtrip idiom is password-reset.spec's.
import { ADMIN, createUserViaUi, expect, login, loginWithPassword, logout, test, userMenu } from "./helpers";

const MAILPIT = "http://localhost:8025";

test("creating a user with the email option delivers working credentials", async ({ page }) => {
  const mailpitUp = await fetch(`${MAILPIT}/api/v1/messages`).then(
    (r) => r.ok,
    () => false,
  );
  test.skip(!mailpitUp, "Mailpit (compose stack) is not reachable — email roundtrip untestable");

  await login(page, ADMIN);
  const user = await createUserViaUi(page, "E2E-Welcome", { sendEmail: true });
  await logout(page);

  // Pull the generated password out of the welcome email (delivery is asynchronous). The
  // Subject filter keeps a shared Mailpit inbox from matching some other spec's message.
  let emailedPassword: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json());
        const msg = list.messages?.find(
          (m: { Subject?: string; To?: { Address: string }[] }) =>
            m.Subject?.includes("Your Lettuce account is ready") &&
            m.To?.some((t) => t.Address === user.email),
        );
        if (!msg) return undefined;
        const text: string = (
          await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`).then((r) => r.json())
        ).Text;
        emailedPassword = text.match(/^[A-Za-z0-9_-]{16}$/m)?.[0];
        return emailedPassword;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  // The reveal modal and the email carry the same one-time password, and it signs in.
  expect(emailedPassword).toBe(user.password);
  await loginWithPassword(page, user.email, emailedPassword);
  await expect(userMenu(page)).toBeVisible();
});
