import { Alert } from "@mantine/core";
import { IconShare } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/**
 * The "Shared with you by {name}" note a view page shows when the document reached the caller
 * through a share (`sharedBy` on the detail DTO — the sharer's display name). Informational
 * only: the Share button is gated on `canShare`, never on this.
 */
export default function SharedByBanner({ name }: { name: string | null | undefined }) {
  const { t } = useTranslation();
  if (name == null || name === "") return null;
  return (
    // role="status" (a polite live region): Mantine's Alert defaults to role="alert" (assertive),
    // which would interrupt a screen reader for what is plain informational text.
    <Alert color="blue" variant="light" role="status" icon={<IconShare size={16} />}>
      {t("sharing.banner", { name })}
    </Alert>
  );
}
