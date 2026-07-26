import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Button, Group, Modal, Stack, Text, type MantineColor } from "@mantine/core";

// The shared confirm-before-acting modal (discard, reject, delete, withdraw, …): a message
// plus a neutral cancel and a red confirm (`confirmColor` overrides the red for the rare
// non-destructive question, e.g. CreateGoal's "activate immediately?"). The confirm is either
// a navigation (`confirmTo`, e.g. the discard flows' "leave this form" link) or an action
// button (`onConfirm`, with `loading` driving its spinner and blocking cancel/close while
// pending). Labels arrive already translated — they differ per flow (Keep editing/Cancel,
// Discard/Reject/Delete/…). Row-deletion flows paired with useDeleteConfirm keep using
// ConfirmDeleteModal instead.
export default function ConfirmActionModal({
  opened,
  onClose,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onConfirm,
  confirmTo,
  loading = false,
  confirmColor = "red",
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm?: () => void;
  confirmTo?: string;
  loading?: boolean;
  confirmColor?: MantineColor;
}) {
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      centered
    >
      <Stack gap="md">
        <Text>{message}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          {confirmTo != null ? (
            <Button color={confirmColor} component={RouterLink} to={confirmTo}>
              {confirmLabel}
            </Button>
          ) : (
            <Button color={confirmColor} onClick={onConfirm} loading={loading}>
              {confirmLabel}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
