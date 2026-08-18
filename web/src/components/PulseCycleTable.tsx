import type { ParseKeys } from "i18next";
import { Alert, Button, Group, Modal, Skeleton, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconHeartRateMonitor } from "@tabler/icons-react";
import {
  cancelPulseCycle,
  closePulseCycle,
  openPulseCycle,
  updatePulseCycleDates,
  type PulseCycle,
} from "../api/pulse";
import ConfirmActionModal from "./ConfirmActionModal";
import EmptyState from "./EmptyState";
import PulseCycleStatusBadge from "./PulseCycleStatusBadge";
import { formatIsoDate, isValidIsoDate } from "../utils/datetime";
import { pickLocalized } from "../utils/localized";
import { invalidatePulse } from "../utils/pulseQueries";
import { saveErrorMessage, type SaveErrorKeys } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

type CycleAction = "open" | "close" | "cancel";

const ACTION_API: Record<CycleAction, (id: number) => Promise<void>> = {
  open: openPulseCycle,
  close: closePulseCycle,
  cancel: cancelPulseCycle,
};

const CONFIRM_KEY: Record<CycleAction, ParseKeys> = {
  open: "pulse.admin.confirmOpen",
  close: "pulse.admin.confirmClose",
  cancel: "pulse.admin.confirmCancel",
};

const ACTION_TOAST: Record<CycleAction, ParseKeys> = {
  open: "pulse.toast.opened",
  close: "pulse.toast.closed",
  cancel: "pulse.toast.cancelled",
};

const ERROR_KEYS: SaveErrorKeys = {
  conflict: "pulse.error.conflict",
  invalid: "pulse.error.invalid",
  failedStatus: "pulse.error.failedStatus",
  failed: "pulse.error.failed",
};

/**
 * The cycle registry of the admin PulseCycles page: the per-status lifecycle actions behind
 * their confirmations, and the date-edit ("extend" while OPEN) modal.
 */
export default function PulseCycleTable({
  cycles,
  isLoading,
  isError,
}: {
  cycles: PulseCycle[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const queryClient = useQueryClient();

  const [pendingAction, setPendingAction] = useState<{ action: CycleAction; id: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PulseCycle | null>(null);
  const [editOpen, setEditOpen] = useState("");
  const [editClose, setEditClose] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const runAction = useMutation({
    mutationFn: ({ action, id }: { action: CycleAction; id: number }) => ACTION_API[action](id),
    onSuccess: async (_data, { action }) => {
      showSuccessToast(t(ACTION_TOAST[action]));
      setPendingAction(null);
      setActionError(null);
      await invalidatePulse(queryClient);
    },
    onError: (err) => {
      setPendingAction(null);
      setActionError(saveErrorMessage(err, t, ERROR_KEYS));
    },
  });

  const saveDates = useMutation({
    mutationFn: ({ id, open, close }: { id: number; open: string; close: string }) =>
      updatePulseCycleDates(id, { plannedOpenDate: open, plannedCloseDate: close }),
    onSuccess: async () => {
      showSuccessToast(t("pulse.toast.datesSaved"));
      setEditing(null);
      await invalidatePulse(queryClient);
    },
    onError: (err) => setEditError(saveErrorMessage(err, t, ERROR_KEYS)),
  });

  const rows = cycles ?? [];

  return (
    <>
      <Stack gap="sm">
        <Title order={4}>{t("pulse.admin.cycleListTitle")}</Title>
        {actionError && (
          <Alert color="red" variant="light">
            {actionError}
          </Alert>
        )}
        {isLoading && <Skeleton height={160} radius="md" />}
        {isError && (
          <Alert color="red" variant="light">
            {t("pulse.error.loadFailed")}
          </Alert>
        )}
        {cycles != null && rows.length === 0 && (
          <EmptyState icon={<IconHeartRateMonitor size={32} />} label={t("pulse.admin.noCycles")} />
        )}
        {rows.length > 0 && (
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("common.field.status")}</Table.Th>
                <Table.Th>{t("pulse.admin.openDate")}</Table.Th>
                <Table.Th>{t("pulse.admin.closeDate")}</Table.Th>
                <Table.Th>{t("pulse.admin.question")}</Table.Th>
                <Table.Th>{t("pulse.admin.participation")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((cycle) => (
                <Table.Tr key={cycle.id}>
                  <Table.Td>
                    <PulseCycleStatusBadge status={cycle.status} />
                  </Table.Td>
                  <Table.Td>{formatIsoDate(cycle.plannedOpenDate, locale)}</Table.Td>
                  <Table.Td>{formatIsoDate(cycle.plannedCloseDate, locale)}</Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      truncate
                      maw={220}
                      title={cycle.rotatingQuestion ? pickLocalized(cycle.rotatingQuestion, locale) : undefined}
                    >
                      {cycle.rotatingQuestion ? pickLocalized(cycle.rotatingQuestion, locale) : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {cycle.participantCount != null
                      ? `${cycle.responseCount ?? 0}/${cycle.participantCount}`
                      : "—"}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      {cycle.status === "SCHEDULED" && (
                        <Button
                          size="compact-sm"
                          aria-label={t("pulse.admin.openAria", { id: cycle.id })}
                          onClick={() => setPendingAction({ action: "open", id: cycle.id })}
                        >
                          {t("pulse.admin.openNow")}
                        </Button>
                      )}
                      {cycle.status === "OPEN" && (
                        <Button
                          size="compact-sm"
                          aria-label={t("pulse.admin.closeAria", { id: cycle.id })}
                          onClick={() => setPendingAction({ action: "close", id: cycle.id })}
                        >
                          {t("pulse.admin.closeNow")}
                        </Button>
                      )}
                      {(cycle.status === "SCHEDULED" || cycle.status === "OPEN") && (
                        <>
                          <Button
                            size="compact-sm"
                            variant="default"
                            aria-label={t("pulse.admin.editDatesAria", { id: cycle.id })}
                            onClick={() => {
                              setEditing(cycle);
                              setEditOpen(cycle.plannedOpenDate);
                              setEditClose(cycle.plannedCloseDate);
                              setEditError(null);
                            }}
                          >
                            {cycle.status === "OPEN"
                              ? t("pulse.admin.extend")
                              : t("pulse.admin.editDates")}
                          </Button>
                          <Button
                            size="compact-sm"
                            color="red"
                            variant="subtle"
                            aria-label={t("pulse.admin.cancelAria", { id: cycle.id })}
                            onClick={() => setPendingAction({ action: "cancel", id: cycle.id })}
                          >
                            {t("pulse.admin.cancelCycle")}
                          </Button>
                        </>
                      )}
                      {cycle.status === "CLOSED" && (
                        <Button
                          size="compact-sm"
                          color="red"
                          variant="subtle"
                          aria-label={t("pulse.admin.cancelAria", { id: cycle.id })}
                          onClick={() => setPendingAction({ action: "cancel", id: cycle.id })}
                        >
                          {t("pulse.admin.cancelCycle")}
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <ConfirmActionModal
        opened={pendingAction != null}
        onClose={() => setPendingAction(null)}
        title={t("pulse.admin.title")}
        message={pendingAction != null ? t(CONFIRM_KEY[pendingAction.action]) : ""}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={
          pendingAction?.action === "open"
            ? t("pulse.admin.openNow")
            : pendingAction?.action === "close"
              ? t("pulse.admin.closeNow")
              : t("pulse.admin.cancelCycle")
        }
        confirmColor={pendingAction?.action === "cancel" ? "red" : "lettuce"}
        onConfirm={() => pendingAction && runAction.mutate(pendingAction)}
        loading={runAction.isPending}
      />

      <Modal
        opened={editing != null}
        onClose={() => setEditing(null)}
        title={t("pulse.admin.datesTitle")}
        centered
      >
        <Stack gap="sm">
          <TextInput
            type="date"
            label={t("pulse.admin.openDate")}
            value={editOpen}
            disabled={editing?.status === "OPEN"}
            onChange={(event) => setEditOpen(event.currentTarget.value)}
          />
          <TextInput
            type="date"
            label={t("pulse.admin.closeDate")}
            value={editClose}
            onChange={(event) => setEditClose(event.currentTarget.value)}
          />
          {editError && (
            <Alert color="red" variant="light">
              {editError}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setEditing(null)}>
              {t("common.action.cancel")}
            </Button>
            <Button
              loading={saveDates.isPending}
              onClick={() => {
                if (!editing) return;
                if (!isValidIsoDate(editOpen)) {
                  setEditError(t("pulse.validation.openDateInvalid"));
                  return;
                }
                if (!isValidIsoDate(editClose) || editClose <= editOpen) {
                  setEditError(t("pulse.validation.closeDateInvalid"));
                  return;
                }
                saveDates.mutate({ id: editing.id, open: editOpen, close: editClose });
              }}
            >
              {t("common.action.save")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
