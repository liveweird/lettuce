import { useDisclosure } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBeforeUnloadGuard, type DirtyReader } from "./useBeforeUnloadGuard";

export type DiscardGuardOptions = {
  /** Whether leaving now would lose work — a value or a fresh reader (`() => form.isDirty()`). */
  isDirty: DirtyReader;
  /** Where Cancel goes. */
  to: string;
  /** The confirm modal's copy; defaults to the generic `common.discard.*` pair. */
  title?: string;
  message?: string;
};

/**
 * The ONE cancel guard for forms (v3.5.0): `requestCancel` navigates straight away while the
 * form is clean and opens a discard confirm once it is dirty; a `beforeunload` prompt
 * (`useBeforeUnloadGuard`) covers the browser's own reload/close while dirty. Render the
 * returned `modalProps` through `ConfirmActionModal`. (Sidebar navigation while dirty stays a documented gap — the
 * data-router `useBlocker` is its own release.)
 */
export function useDiscardGuard({ isDirty, to, title, message }: DiscardGuardOptions) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [opened, { open, close }] = useDisclosure(false);
  // The beforeunload half lives in its own hook (v3.5.2); it hands back the fresh reader.
  const dirty = useBeforeUnloadGuard(isDirty);

  return {
    requestCancel: () => {
      if (dirty()) open();
      else void navigate(to);
    },
    modalProps: {
      opened,
      onClose: close,
      title: title ?? t("common.discard.title"),
      message: message ?? t("common.discard.message"),
      cancelLabel: t("common.action.keepEditing"),
      confirmLabel: t("common.action.discard"),
      confirmTo: to,
    },
  };
}
