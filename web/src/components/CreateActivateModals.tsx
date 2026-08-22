import { useTranslation } from "react-i18next";
import ConfirmActionModal from "./ConfirmActionModal";
import type { CreateThenActivateArea } from "../hooks/useCreateThenActivate";

/**
 * The create screens' modal pair for the `useCreateThenActivate` flow: the discard confirm
 * guarding Cancel (house convention for MarkdownEditor forms) and the post-create activate
 * prompt (Yes activates the fresh draft, No — or dismissing — keeps it; either way the user
 * returns to the screen they came from).
 */
export default function CreateActivateModals({
  area,
  backTo,
  cancelOpen,
  onCancelClose,
  createdId,
  promptClosed,
  activating,
  onFinishAsDraft,
  onActivate,
}: {
  area: CreateThenActivateArea;
  backTo: string;
  cancelOpen: boolean;
  onCancelClose: () => void;
  createdId: number | null;
  promptClosed: boolean;
  activating: boolean;
  onFinishAsDraft: () => void;
  onActivate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ConfirmActionModal
        opened={cancelOpen}
        onClose={onCancelClose}
        title={t(`${area}.discardTitle`)}
        message={t(`${area}.discardMessage`)}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
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
    </>
  );
}
