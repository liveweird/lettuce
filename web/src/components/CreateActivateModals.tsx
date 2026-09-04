import { useTranslation } from "react-i18next";
import ConfirmActionModal from "./ConfirmActionModal";
import type { CreateThenActivateArea } from "../hooks/useCreateThenActivate";

/**
 * The create screens' post-create activate prompt for the `useCreateThenActivate` flow: Yes
 * activates the fresh draft, No — or dismissing — keeps it; either way the user returns to
 * the screen they came from. (The Cancel discard confirm that used to live here is the
 * shared `useDiscardGuard` since v3.5.0.)
 */
export default function CreateActivateModals({
  area,
  createdId,
  promptClosed,
  activating,
  onFinishAsDraft,
  onActivate,
}: {
  area: CreateThenActivateArea;
  createdId: number | null;
  promptClosed: boolean;
  activating: boolean;
  onFinishAsDraft: () => void;
  onActivate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmActionModal
      opened={createdId != null && !promptClosed}
      onClose={onFinishAsDraft}
      title={t(`${area}.activatePromptTitle`)}
      message={t(`${area}.activatePromptQuestion`)}
      cancelLabel={t("common.state.no")}
      confirmLabel={t("common.state.yes")}
      confirmColor="teal"
      onConfirm={onActivate}
      loading={activating}
    />
  );
}
