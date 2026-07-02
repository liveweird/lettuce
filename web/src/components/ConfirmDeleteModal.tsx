import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { DeleteConfirm } from "../hooks/useDeleteConfirm";

// The confirmation modal half of useDeleteConfirm. `title`/`errorTitle`/`unknownError`
// arrive already translated (their keys are page-local); `body` renders the lead text
// for the row being deleted. The Cancel/Delete labels are the shared common.action.*.
export default function ConfirmDeleteModal<T>({
  confirm,
  title,
  errorTitle,
  unknownError,
  body,
}: {
  confirm: DeleteConfirm<T>;
  title: string;
  errorTitle: string;
  unknownError: string;
  body: (target: T) => ReactNode;
}) {
  const { t } = useTranslation();
  const { target, opened, cancelDelete, confirmDelete, mutation } = confirm;
  return (
    <Modal opened={opened} onClose={cancelDelete} title={title} centered>
      <Stack gap="md">
        {target && <Text>{body(target)}</Text>}
        {mutation.isError && (
          <Alert color="red" title={errorTitle}>
            {mutation.error instanceof Error ? mutation.error.message : unknownError}
          </Alert>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={cancelDelete} disabled={mutation.isPending}>
            {t("common.action.cancel")}
          </Button>
          <Button color="red" onClick={confirmDelete} loading={mutation.isPending}>
            {t("common.action.delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
