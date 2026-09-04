import { useRef } from "react";
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
 * (`useBeforeUnloadGuard`) covers the browser's own reload/close while dirty; and, since
 * v3.6.0, the returned `guardProps` rendered through `components/DiscardGuard` also block
 * in-app navigation away from a dirty form (the sidebar, the back button, any link) with the
 * same confirm — the data-router `useBlocker`. Post-save navigations use `replace: true`,
 * which the blocker deliberately lets through.
 */
export function useDiscardGuard({ isDirty, to, title, message }: DiscardGuardOptions) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [opened, { open, close }] = useDisclosure(false);
  // The beforeunload half lives in its own hook (v3.5.2); it hands back the fresh reader.
  const dirty = useBeforeUnloadGuard(isDirty);
  // Set right before the guard's own navigations (a clean Cancel, a confirmed Discard) so the
  // route blocker never prompts twice for a departure the user already chose.
  const bypassRef = useRef(false);

  return {
    requestCancel: () => {
      if (dirty()) open();
      else {
        bypassRef.current = true;
        void navigate(to);
      }
    },
    guardProps: {
      opened,
      onClose: close,
      title: title ?? t("common.discard.title"),
      message: message ?? t("common.discard.message"),
      cancelLabel: t("common.action.keepEditing"),
      confirmLabel: t("common.action.discard"),
      to,
      isDirty: dirty,
      bypassRef,
    },
  };
}
