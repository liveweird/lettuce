import { charCountDescription } from "../utils/charCount";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, Group, Paper, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconCalendarOff, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
              <TextInput
                type="date"
                label={t("daysOff.holidays.date")}
                value={date}
                onChange={(e) => setDate(e.currentTarget.value)}
                w={180}
              />
              <TextInput
                label={t("daysOff.holidays.name")}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                maxLength={MAX_NAME}
                description={charCountDescription(name.length, MAX_NAME)}
                inputWrapperOrder={["label", "input", "description", "error"]}
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

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("daysOff.holidays.date")}</Table.Th>
            <Table.Th>{t("daysOff.holidays.name")}</Table.Th>
            {admin && <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : holidays && holidays.length > 0 ? (
            holidays.map((h) => (
              <Table.Tr key={h.id}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <Group gap={6} wrap="nowrap">
                    <DateCell value={h.date} mode="date" />
                    <Text size="xs" c="dimmed" span>
                      {formatIsoWeekday(h.date, i18n.language)}
                    </Text>
                  </Group>
                </Table.Td>
                {/* The fluid column (v3.4.0): takes the table's slack and truncates first. */}
                <Table.Td style={{ width: "100%", maxWidth: 0 }}>
                  <Text size="sm" truncate title={h.name}>
                    {h.name}
                  </Text>
                </Table.Td>
                {admin && (
                  <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
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
                  </Table.Td>
                )}
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconCalendarOff size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t(admin ? "daysOff.holidays.empty" : "daysOff.holidays.emptyReadOnly")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

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
