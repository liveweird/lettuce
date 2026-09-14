import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  Text,
} from "@mantine/core";
import ResponsiveTable from "./ResponsiveTable";
import { IconCheck, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import DateField from "./DateField";
import { addTeamKpiValue, deleteTeamKpiValue, listTeamKpiValues, updateTeamKpiValue, type TeamKpiResponse, type TeamKpiValue } from "../api/teamkpis";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import ConfirmDeleteModal from "./ConfirmDeleteModal";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { formatGoalValue, TargetDelta } from "../utils/goalValues";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

// One row is being edited at a time; its draft inputs live here.
type RowDraft = { id: number; date: string; value: number | string };

/**
 * The KPI data tab: the collected data points (date + value), newest first. Whoever the server
 * granted `canRecordValues` (v2.26.0 — the team's manager, the chain above them, and the
 * team's current members) may add, correct, and remove points while the KPI is ACTIVE — every
 * operation persists immediately (there is no Save button on the screen); everyone else (and
 * every other status) gets the read-only list. One value per date: a duplicate date is caught
 * client-side against the loaded list, and a racing 409 from the server maps to the same
 * wording.
 */
export default function TeamKpiValuesEditor({ kpi }: { kpi: TeamKpiResponse }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const locale = i18n.language;

  const canEdit = kpi.canRecordValues && kpi.status === "ACTIVE";

  const { data: values, isLoading, isError } = useQuery({
    queryKey: ["teamKpiValues", kpi.id],
    queryFn: () => listTeamKpiValues(kpi.id),
  });

  const [addDate, setAddDate] = useState(todayIsoDate());
  const [addValue, setAddValue] = useState<number | string>("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const deleteConfirm = useDeleteConfirm<TeamKpiValue>({
    mutationFn: (row) => deleteTeamKpiValue(kpi.id, row.id),
    onSuccess: () => invalidateTeamKpi(queryClient, kpi.id),
    successMessage: t("teamKpi.toast.valueRemoved"),
  });

  // Shared field validation, mirroring the server's rules (finite, 0–100 for PERCENTAGE;
  // strict date, today or past; one value per date). Returns the error message or null.
  function validate(date: string, value: number | string, excludeId?: number): string | null {
    const num = typeof value === "number" ? value : Number(value);
    if (value === "" || !Number.isFinite(num)) return t("teamKpi.validation.valueRequired");
    if (kpi.type === "PERCENTAGE" && (num < 0 || num > 100)) {
      return t("teamKpi.validation.percentageRange");
    }
    if (!date) return t("teamKpi.validation.dateRequired");
    if (date > todayIsoDate()) return t("teamKpi.validation.dateInFuture");
    if (values?.some((v) => v.date === date && v.id !== excludeId)) {
      return t("teamKpi.validation.duplicateDate");
    }
    return null;
  }

  function requestErrorMessage(err: unknown): string {
    return saveErrorMessage(err, t, {
      conflict: "teamKpi.error.valueConflict",
      forbidden: "teamKpi.error.savePermission",
      // An unmapped 4xx/5xx names its status (v2.26.1) instead of masquerading as a network
      // failure — the UTC-midnight 400 hid behind the generic wording for a whole debugging
      // session once.
      failedStatus: "teamKpi.error.updateFailedStatus",
      failed: "teamKpi.error.updateFailed",
    });
  }

  async function submitAdd() {
    const error = validate(addDate, addValue);
    if (error) {
      setAddError(error);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await addTeamKpiValue(kpi.id, { date: addDate, value: Number(addValue) });
      setAddDate(todayIsoDate());
      setAddValue("");
      await invalidateTeamKpi(queryClient, kpi.id);
      showSuccessToast(t("teamKpi.toast.valueAdded"));
    } catch (err) {
      setAddError(requestErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function submitDraft() {
    if (!draft) return;
    const error = validate(draft.date, draft.value, draft.id);
    if (error) {
      setDraftError(error);
      return;
    }
    setSavingDraft(true);
    setDraftError(null);
    try {
      await updateTeamKpiValue(kpi.id, draft.id, { date: draft.date, value: Number(draft.value) });
      setDraft(null);
      await invalidateTeamKpi(queryClient, kpi.id);
      showSuccessToast(t("teamKpi.toast.valueSaved"));
    } catch (err) {
      setDraftError(requestErrorMessage(err));
    } finally {
      setSavingDraft(false);
    }
  }

  if (isLoading) return <Loader size="sm" />;
  if (isError || !values) {
    return (
      <Alert color="red" variant="light">
        {t("teamKpi.error.loadFailed")}
      </Alert>
    );
  }

  const valueInputProps =
    kpi.type === "PERCENTAGE" ? { min: 0, max: 100, suffix: "%" } : {};

  return (
    <>
      {kpi.canRecordValues && !canEdit && (
        <Text size="sm" c="dimmed" mb="sm">
          {t("teamKpi.valuesInactiveHint")}
        </Text>
      )}
      {canEdit && (
        <Group align="flex-end" gap="sm" mb="md" wrap="wrap">
          <DateField
            label={t("teamKpi.date")}
            value={addDate}
            maxIso={todayIsoDate()}
            onChange={(iso) => setAddDate(iso)}
            w={180}
          />
          <NumberInput
            label={t("teamKpi.value")}
            value={addValue}
            onChange={setAddValue}
            w={160}
            {...valueInputProps}
          />
          <Button onClick={() => void submitAdd()} loading={adding}>
            {t("teamKpi.addValue")}
          </Button>
          {addError && (
            <Text size="sm" c="var(--lettuce-ink-error)">
              {addError}
            </Text>
          )}
        </Group>
      )}

      {values.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("teamKpi.noValues")}
        </Text>
      ) : (
        <ResponsiveTable density="compact">
          <ResponsiveTable.Thead>
            <ResponsiveTable.Tr>
              <ResponsiveTable.Th>{t("teamKpi.date")}</ResponsiveTable.Th>
              <ResponsiveTable.Th>{t("teamKpi.value")}</ResponsiveTable.Th>
              <ResponsiveTable.Th>{t("teamKpi.vsTarget")}</ResponsiveTable.Th>
              {canEdit && <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />}
            </ResponsiveTable.Tr>
          </ResponsiveTable.Thead>
          <ResponsiveTable.Tbody>
            {values.map((row) =>
              draft?.id === row.id ? (
                <ResponsiveTable.Tr key={row.id}>
                  <ResponsiveTable.Td label={t("teamKpi.date")}>
                    <DateField
                      aria-label={t("teamKpi.date")}
                      value={draft.date}
                      maxIso={todayIsoDate()}
                      onChange={(iso) => setDraft({ ...draft, date: iso })}
                      w={160}
                    />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("teamKpi.value")}>
                    <NumberInput
                      aria-label={t("teamKpi.value")}
                      value={draft.value}
                      onChange={(value) => setDraft({ ...draft, value })}
                      w={140}
                      {...valueInputProps}
                    />
                    {draftError && (
                      <Text size="sm" c="var(--lettuce-ink-error)">
                        {draftError}
                      </Text>
                    )}
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("teamKpi.vsTarget")} />
                  <ResponsiveTable.Td actions>
                    <Group gap="xs" wrap="nowrap">
                      <ActionIcon
                        variant="light"
                        aria-label={t("teamKpi.saveValueAria", {
                          date: formatIsoDate(row.date, locale),
                        })}
                        loading={savingDraft}
                        onClick={() => void submitDraft()}
                      >
                        <IconCheck size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="gray"
                        aria-label={t("teamKpi.cancelValueEditAria", {
                          date: formatIsoDate(row.date, locale),
                        })}
                        disabled={savingDraft}
                        onClick={() => {
                          setDraft(null);
                          setDraftError(null);
                        }}
                      >
                        <IconX size={16} />
                      </ActionIcon>
                    </Group>
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              ) : (
                <ResponsiveTable.Tr key={row.id}>
                  <ResponsiveTable.Td label={t("teamKpi.date")}>{formatIsoDate(row.date, locale)}</ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("teamKpi.value")}>{formatGoalValue(kpi.type, row.value, locale)}</ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("teamKpi.vsTarget")}>
                    <TargetDelta
                      type={kpi.type}
                      value={row.value}
                      target={kpi.targetValue}
                      direction={kpi.targetDirection}
                      locale={locale}
                    />
                  </ResponsiveTable.Td>
                  {canEdit && (
                    <ResponsiveTable.Td actions>
                      <Group gap="xs" wrap="nowrap">
                        <ActionIcon
                          variant="light"
                          aria-label={t("teamKpi.editValueAria", {
                            date: formatIsoDate(row.date, locale),
                          })}
                          disabled={draft != null}
                          onClick={() => {
                            setDraft({ id: row.id, date: row.date, value: row.value });
                            setDraftError(null);
                          }}
                        >
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="light"
                          color="red"
                          aria-label={t("teamKpi.deleteValueAria", {
                            date: formatIsoDate(row.date, locale),
                          })}
                          disabled={draft != null}
                          onClick={() => deleteConfirm.requestDelete(row)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </ResponsiveTable.Td>
                  )}
                </ResponsiveTable.Tr>
              ),
            )}
          </ResponsiveTable.Tbody>
        </ResponsiveTable>
      )}

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("teamKpi.deleteValueTitle")}
        errorTitle={t("teamKpi.error.updateFailed")}
        body={(row) => t("teamKpi.deleteValueMessage", { date: formatIsoDate(row.date, locale) })}
      />
    </>
  );
}
