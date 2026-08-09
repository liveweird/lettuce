import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { DeleteConfirm } from "../hooks/useDeleteConfirm";

// The confirmation modal half of useDeleteConfirm. `title`/`errorTitle`/`unknownError`
// arrive already translated (their keys are page-local); `body` renders the lead text
// for the row being deleted. Cancel is the shared common.action.cancel; the confirm
// button defaults to common.action.delete but pages whose action reads differently
// (e.g. "Remove" on membership rows) pass their own translated `confirmLabel`.
export default function ConfirmDeleteModal<T>({
  confirm,
  title,
  errorTitle,
  unknownError,
  body,
  confirmLabel,
  errorMessage,
}: {
  confirm: DeleteConfirm<T>;
  title: string;
  errorTitle: string;
  unknownError: string;
  body: (target: T) => ReactNode;
  confirmLabel?: string;
  /** Optional status→message mapper (pair with utils/saveError.ts) — pages whose delete can
   *  fail meaningfully (e.g. a registry 409) map it here instead of showing the raw error. */
  errorMessage?: (error: unknown) => string;
}) {
  const { t } = useTranslation();
  const { target, opened, cancelDelete, confirmDelete, mutation } = confirm;
  return (
    <Modal opened={opened} onClose={cancelDelete} title={title} centered>
      <Stack gap="md">
        {target && <Text>{body(target)}</Text>}
        {mutation.isError && (
          <Alert color="red" variant="light" title={errorTitle}>
            {errorMessage
              ? errorMessage(mutation.error)
              : mutation.error instanceof Error
                ? mutation.error.message
                : unknownError}
          </Alert>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={cancelDelete} disabled={mutation.isPending}>
            {t("common.action.cancel")}
          </Button>
          <Button color="red" onClick={confirmDelete} loading={mutation.isPending}>
            {confirmLabel ?? t("common.action.delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
