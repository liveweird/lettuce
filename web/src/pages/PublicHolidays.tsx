import { charCountDescription } from "../utils/charCount";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { IconCalendarOff, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import DateField from "../components/DateField";
import { ApiError } from "../api/http";
import { hasFeature, isAdmin } from "../api/session";
import { createPublicHoliday, deletePublicHoliday, listPublicHolidays } from "../api/daysoff";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import RowActions from "../components/RowActions";
import TableLoadingRow from "../components/TableLoadingRow";
import { formatIsoWeekday, todayIsoDate } from "../utils/datetime";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const MAX_NAME = 100;

/**
 * The global public-holiday registry (the registry list-page shape, v3.4.0): readable by
 * everyone — non-admins get the read-only date table — while adding and deleting stay
 * ADMIN-only; the add form is the always-visible strip above the table. On these dates
 * everyone is off and no paid budget is deducted; existing request costs are frozen, so
 * registry edits never reprice them.
 */
export default function PublicHolidays() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIsoDate());
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const deleteConfirm = useDeleteConfirm<number>({
    mutationFn: (holidayId) => deletePublicHoliday(holidayId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publicHolidays"] }),
    successMessage: t("daysOff.holidays.toastDeleted"),
  });

  const admin = isAdmin();
  const { data: holidays, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["publicHolidays"],
    queryFn: listPublicHolidays,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME;
  const columnCount = admin ? 3 : 2;

  async function add() {
    setSubmitting(true);
    setError(null);
    try {
      await createPublicHoliday({ date, name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: ["publicHolidays"] });
      showSuccessToast(t("daysOff.holidays.toastAdded"));
      setName("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("daysOff.holidays.duplicateDate")
          : saveErrorMessage(err, t, {
              forbidden: "daysOff.error.actionPermission",
              invalid: "daysOff.holidays.invalid",
              failedStatus: "daysOff.error.saveFailedStatus",
              failed: "daysOff.error.saveFailed",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t("daysOff.holidays.title")}
        tourId="config-public-holidays"
        description={t(admin ? "daysOff.holidays.hint" : "daysOff.holidays.hintReadOnly")}
      />

      {/* The add strip (an in-form adder, hence "Add …" wording) — ADMIN-only. */}
      {admin && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group align="flex-end" gap="md" wrap="wrap">
              <DateField
                label={t("daysOff.holidays.date")}
                value={date}
                onChange={(iso) => setDate(iso)}
                w={180}
              />
              <TextInput
                label={t("daysOff.holidays.name")}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                maxLength={MAX_NAME}
                description={charCountDescription(name.length, MAX_NAME)}
                w={260}
              />
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => void add()}
                loading={submitting}
                disabled={!nameValid || !date}
              >
                {t("daysOff.holidays.addHoliday")}
              </Button>
            </Group>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("daysOff.holidays.loadError")}>
          {loadErrorMessage(loadError, t)}
        </Alert>
      )}

      <ResponsiveTable density="compact">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th>{t("daysOff.holidays.date")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("daysOff.holidays.name")}</ResponsiveTable.Th>
            {admin && <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />}
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : holidays && holidays.length > 0 ? (
            holidays.map((h) => (
              <ResponsiveTable.Tr key={h.id}>
                <ResponsiveTable.Td label={t("daysOff.holidays.date")}>
                  <Group gap={6} wrap="nowrap">
                    <DateCell value={h.date} mode="date" />
                    <Text size="xs" c="dimmed" span>
                      {formatIsoWeekday(h.date, i18n.language)}
                    </Text>
                  </Group>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("daysOff.holidays.name")} primary>
                  <Text size="sm">
                    {h.name}
                  </Text>
                </ResponsiveTable.Td>
                {admin && (
                  <ResponsiveTable.Td actions>
                    <RowActions
                      name={h.name}
                      primary={{
                        icon: <IconTrash size={16} />,
                        label: t("common.action.delete"),
                        ariaLabel: t("daysOff.holidays.deleteAria", { name: h.name }),
                        color: "red",
                        onClick: () => deleteConfirm.requestDelete(h.id),
                      }}
                    />
                  </ResponsiveTable.Td>
                )}
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconCalendarOff size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t(admin ? "daysOff.holidays.empty" : "daysOff.holidays.emptyReadOnly")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("daysOff.holidays.deleteTitle")}
        errorTitle={t("daysOff.holidays.deleteFailed")}
        body={() => t("daysOff.holidays.deleteMessage")}
        errorMessage={(err) =>
          saveErrorMessage(err, t, {
            forbidden: "daysOff.error.actionPermission",
            notFound: "daysOff.error.gone",
            failedStatus: "daysOff.error.saveFailedStatus",
            failed: "daysOff.error.saveFailed",
          })
        }
      />
    </Stack>
  );
}
