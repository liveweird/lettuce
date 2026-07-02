import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

export type DeleteConfirm<T> = {
  target: T | null;
  opened: boolean;
  requestDelete: (row: T) => void;
  cancelDelete: () => void;
  confirmDelete: () => void;
  mutation: UseMutationResult<unknown, Error, T>;
};

// Shared confirm-before-delete flow for the list pages: `requestDelete(row)` opens the
// confirmation modal for that row, `confirmDelete` runs the mutation, and on success
// the modal closes and the target clears before `onSuccess(row)` runs (cache
// invalidation and any page-specific follow-up stay at the call site). Cancelling is
// blocked while the mutation is pending; the mutation error is reset on open/cancel.
// Pair with <ConfirmDeleteModal>.
export function useDeleteConfirm<T>({
  mutationFn,
  onSuccess,
}: {
  mutationFn: (row: T) => Promise<unknown>;
  onSuccess: (row: T) => Promise<unknown> | void;
}): DeleteConfirm<T> {
  const [target, setTarget] = useState<T | null>(null);
  const [opened, { open, close }] = useDisclosure(false);

  const mutation = useMutation({
    mutationFn,
    onSuccess: async (_result: unknown, row: T) => {
      close();
      setTarget(null);
      await onSuccess(row);
    },
  });

  function requestDelete(row: T) {
    setTarget(row);
    mutation.reset();
    open();
  }

  function cancelDelete() {
    if (mutation.isPending) return;
    close();
    setTarget(null);
    mutation.reset();
  }

  function confirmDelete() {
    if (target) mutation.mutate(target);
  }

  return { target, opened, requestDelete, cancelDelete, confirmDelete, mutation };
}
