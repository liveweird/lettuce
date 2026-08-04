import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";

/**
 * The one success-toast entry point (host: `<Notifications />` in main.tsx). Success only —
 * errors stay inline (red Alerts next to the form/list). Teal is the semantic-success color
 * (v1.35.0 design rules; stock green would impersonate the brand).
 *
 * Content rule: pass fixed vocabulary (`t("<area>.toast.*")`) only — NEVER user-entered
 * names/values. Toasts overlay the page for a moment, so interpolated data would break
 * strict-mode `getByText` locators in e2e specs and could leak content across screens.
 */
export function showSuccessToast(message: string) {
  notifications.show({
    message,
    color: "teal",
    icon: <IconCheck size={16} />,
  });
}
