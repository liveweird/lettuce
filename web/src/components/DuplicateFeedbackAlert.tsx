import { Alert, Anchor } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";

// The early no-duplicate warning on the create screens: a feedback by the same provider for
// the same requester that includes this recipient is already in progress, so the server would
// 409 — tell the user up-front, before they fill anything, and link to the existing record.
// The caller owns the duplicate-check query and the link target (`/feedback/{id}/edit` when
// the viewer is the provider, `/feedback/{id}/view` otherwise). `recipientName` prefixes the
// message on the multi-recipient create screens, where one alert renders per affected pick.
export default function DuplicateFeedbackAlert({
  status,
  to,
  recipientName,
}: {
  /** The existing feedback's status — picks the wording (draft in progress vs pending request). */
  status: "DRAFT" | "REQUESTED";
  /** SPA route of the existing feedback. */
  to: string;
  /** Names the recipient the warning is about (multi-recipient picker mode only). */
  recipientName?: string;
}) {
  const { t } = useTranslation();
  return (
    <Alert color="orange" variant="light" icon={<IconCopy size={18} />}>
      {recipientName != null && (
        <>
          <strong>{t("feedback.duplicate.forRecipient", { name: recipientName })}</strong>{" "}
        </>
      )}
      {status === "DRAFT" ? t("feedback.duplicate.draft") : t("feedback.duplicate.requested")}{" "}
      <Anchor component={RouterLink} to={to} fw={600} c="var(--lettuce-ink-warning)">
        {t("feedback.duplicate.open")}
      </Anchor>
    </Alert>
  );
}
