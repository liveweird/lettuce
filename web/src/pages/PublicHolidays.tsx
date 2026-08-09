import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconCalendarOff, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  createPublicHoliday,
  deletePublicHoliday,
  hasFeature,
  isAdmin,
  listPublicHolidays,
} from "../api/client";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import EmptyState from "../components/EmptyState";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const MAX_NAME = 100;

/**
 * The global public-holiday registry (the ReviewPeriods shape): readable by everyone —
 * non-admins get the read-only date list — while adding and deleting stay ADMIN-only. On these
 * dates everyone is off and no paid budget is deducted; existing request costs are frozen, so
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
  const { data: holidays, isLoading, isError } = useQuery({
    queryKey: ["publicHolidays"],
    queryFn: listPublicHolidays,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME;

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
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Title order={2} data-tour="config-public-holidays">
            {t("daysOff.holidays.title")}
          </Title>
          <Text size="sm" c="dimmed">
            {t(admin ? "daysOff.holidays.hint" : "daysOff.holidays.hintReadOnly")}
          </Text>

          {isError && (
            <Alert color="red" variant="light" title={t("daysOff.holidays.loadError")}>
              {t("daysOff.unknownError")}
            </Alert>
          )}
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {holidays && holidays.length === 0 && (
            <EmptyState
              icon={<IconCalendarOff size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
              label={t(admin ? "daysOff.holidays.empty" : "daysOff.holidays.emptyReadOnly")}
            />
          )}
          {holidays && holidays.length > 0 && (
            <Stack gap="xs">
              {holidays.map((h) => (
                <Paper key={h.id} withBorder p="sm" radius="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <Text size="sm" fw={500} style={{ whiteSpace: "nowrap" }}>
                        {formatIsoDate(h.date, i18n.language)}
                      </Text>
                      <Text size="sm" c="dimmed" lineClamp={1}>
                        {h.name}
                      </Text>
                    </Group>
                    {admin && (
                      <Button
                        color="red"
                        variant="light"
                        size="xs"
                        onClick={() => deleteConfirm.requestDelete(h.id)}
                        aria-label={t("daysOff.holidays.deleteAria", { name: h.name })}
                      >
                        {t("common.action.delete")}
                      </Button>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          {/* The append form (an in-form adder, hence "Add …" wording) — ADMIN-only. */}
          {admin && (
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
          )}
        </Stack>
      </Paper>

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("daysOff.holidays.deleteTitle")}
        errorTitle={t("daysOff.holidays.deleteFailed")}
        unknownError={t("daysOff.error.saveFailed")}
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
    </Container>
  );
}
