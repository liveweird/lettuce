import { Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconShare } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { ShareableResourceType } from "../api/shares";
import ShareDialog from "./ShareDialog";

/**
 * The view pages' Share action (v4.8.0). Renders ONLY when the detail response's server-computed
 * `canShare` is true — never derived from `sharedBy` (an upgraded read carries both, and a
 * share-only reader has `sharedBy` without the right to re-share). Owns the dialog's open state.
 */
export default function ShareButton({
  canShare,
  resourceType,
  resourceId,
}: {
  canShare: boolean | undefined;
  resourceType: ShareableResourceType;
  resourceId: number;
}) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  if (canShare !== true) return null;
  return (
    <>
      <Button variant="default" leftSection={<IconShare size={16} />} onClick={open}>
        {t("sharing.button")}
      </Button>
      <ShareDialog opened={opened} onClose={close} resourceType={resourceType} resourceId={resourceId} />
    </>
  );
}
