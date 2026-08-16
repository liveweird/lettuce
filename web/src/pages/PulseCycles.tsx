import type { ParseKeys } from "i18next";
import {
  Alert,
  Button,
  Container,
  Group,
  Modal,
  NumberInput,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { hasFeature, isAdmin } from "../api/session";
import { cancelPulseCycle, closePulseCycle, createPulseCycle, getPulseSettings, listPulseCycles, openPulseCycle, updatePulseCycleDates, updatePulseSettings, type PulseCycle, type PulseSettings } from "../api/pulse";
import ConfirmActionModal from "../components/ConfirmActionModal";
import EmptyState from "../components/EmptyState";
import PulseCycleStatusBadge from "../components/PulseCycleStatusBadge";
import { IconHeartRateMonitor } from "@tabler/icons-react";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { addIsoDays } from "../utils/pulseResults";
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

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

/**
 * The ADMIN cycle-management screen (Config nav; the ReviewPeriods blueprint): the advisory
 * settings, the scheduling form (dates prefilled from the latest cycle + cadence — opening
 * and closing stay manual), and the cycle registry with the per-status lifecycle actions.
 */
export default function PulseCycles() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const queryClient = useQueryClient();

  const settings = useQuery({ queryKey: ["pulseSettings"], queryFn: getPulseSettings, enabled: isAdmin() });
  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles, enabled: isAdmin() });

  // Settings editor.
  const settingsForm = useForm<PulseSettings>({ initialValues: { cadenceWeeks: 4, openDays: 7 } });
  if (settings.isSuccess && !settingsForm.initialized) settingsForm.initialize(settings.data);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Scheduling form: the dates are DERIVED defaults (latest non-cancelled cycle + cadence;
  // close = open + openDays) that a manual edit overrides — null input = "not touched", so
  // no set-state-in-effect and the close date keeps following an edited open date until the
  // admin touches it themselves.
  const [openDateInput, setOpenDateInput] = useState<string | null>(null);
  const [closeDateInput, setCloseDateInput] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const latestCycle = cycles.data?.find((c) => c.status !== "CANCELLED");
  const defaultOpenDate =
    settings.data && cycles.data
      ? latestCycle
        ? addIsoDays(latestCycle.plannedOpenDate, settings.data.cadenceWeeks * 7)
        : todayIsoDate()
      : "";
  const openDate = openDateInput ?? defaultOpenDate;
  const closeDate =
    closeDateInput ??
    (settings.data && isValidIsoDate(openDate) ? addIsoDays(openDate, settings.data.openDays) : "");

  const adminErrorKeys: SaveErrorKeys = {
    conflict: "pulse.error.conflict",
    invalid: "pulse.error.invalid",
    failedStatus: "pulse.error.failedStatus",
    failed: "pulse.error.failed",
  };

  // Lifecycle confirmations + the dates modal.
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
      setActionError(saveErrorMessage(err, t, adminErrorKeys));
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
    onError: (err) => setEditError(saveErrorMessage(err, t, adminErrorKeys)),
  });

  if (!hasFeature("PULSE_SURVEYS") || !isAdmin()) return <Navigate to="/" replace />;

  async function saveSettings(values: PulseSettings) {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      await updatePulseSettings(values);
      showSuccessToast(t("pulse.toast.settingsSaved"));
      await invalidatePulse(queryClient);
    } catch (err) {
      setSettingsError(saveErrorMessage(err, t, adminErrorKeys));
    } finally {
      setSavingSettings(false);
    }
  }

  async function schedule() {
    if (!isValidIsoDate(openDate)) {
      setScheduleError(t("pulse.validation.openDateInvalid"));
      return;
    }
    if (!isValidIsoDate(closeDate) || closeDate <= openDate) {
      setScheduleError(t("pulse.validation.closeDateInvalid"));
      return;
    }
    setScheduling(true);
    setScheduleError(null);
    try {
      await createPulseCycle({ plannedOpenDate: openDate, plannedCloseDate: closeDate });
      showSuccessToast(t("pulse.toast.scheduled"));
      // Back to derived defaults — the next cycle's prefill follows the one just created.
      setOpenDateInput(null);
      setCloseDateInput(null);
      await invalidatePulse(queryClient);
    } catch (err) {
      setScheduleError(
        saveErrorMessage(err, t, { ...adminErrorKeys, conflict: "pulse.admin.scheduleConflict" }),
      );
    } finally {
      setScheduling(false);
    }
  }

  const rows = cycles.data ?? [];

  return (
    <Container size="sm" px={0}>
      <Stack gap="lg">
        <Title order={2} data-tour="config-pulse-cycles">
          {t("pulse.admin.title")}
        </Title>

        <Paper withBorder shadow="sm" p="lg" radius="md">
          <form onSubmit={settingsForm.onSubmit(saveSettings)} noValidate>
            <Stack gap="sm">
              <Title order={4}>{t("pulse.admin.settingsTitle")}</Title>
              <Text size="sm" c="dimmed">
                {t("pulse.admin.settingsHint")}
              </Text>
              <Group grow>
                <NumberInput
                  label={t("pulse.admin.cadenceWeeks")}
                  min={1}
                  max={52}
                  allowDecimal={false}
                  {...settingsForm.getInputProps("cadenceWeeks")}
                />
                <NumberInput
                  label={t("pulse.admin.openDays")}
                  min={1}
                  max={90}
                  allowDecimal={false}
                  {...settingsForm.getInputProps("openDays")}
                />
              </Group>
              {settingsError && (
                <Alert color="red" variant="light">
                  {settingsError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button type="submit" loading={savingSettings} variant="default">
                  {t("pulse.admin.saveSettings")}
                </Button>
              </Group>
            </Stack>
          </form>
        </Paper>

        <Paper withBorder shadow="sm" p="lg" radius="md">
          <Stack gap="sm">
            <Title order={4}>{t("pulse.admin.scheduleTitle")}</Title>
            <Text size="sm" c="dimmed">
              {t("pulse.admin.scheduleHint")}
            </Text>
            <Group grow>
              <TextInput
                type="date"
                label={t("pulse.admin.openDate")}
                value={openDate}
                onChange={(event) => setOpenDateInput(event.currentTarget.value)}
              />
              <TextInput
                type="date"
                label={t("pulse.admin.closeDate")}
                value={closeDate}
                onChange={(event) => setCloseDateInput(event.currentTarget.value)}
              />
            </Group>
            {scheduleError && (
              <Alert color="red" variant="light">
                {scheduleError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button onClick={schedule} loading={scheduling}>
                {t("pulse.admin.schedule")}
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Stack gap="sm">
          <Title order={4}>{t("pulse.admin.cycleListTitle")}</Title>
          {actionError && (
            <Alert color="red" variant="light">
              {actionError}
            </Alert>
          )}
          {cycles.isLoading && <Skeleton height={160} radius="md" />}
          {cycles.isError && (
            <Alert color="red" variant="light">
              {t("pulse.error.loadFailed")}
            </Alert>
          )}
          {cycles.isSuccess && rows.length === 0 && (
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
                        title={(locale === "pl" ? cycle.rotatingQuestionPl : cycle.rotatingQuestionEn) ?? undefined}
                      >
                        {(locale === "pl" ? cycle.rotatingQuestionPl : cycle.rotatingQuestionEn) ?? "—"}
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
    </Container>
  );
}
