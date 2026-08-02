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
import { IconCalendarStats, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  createReviewPeriod,
  deleteReviewPeriod,
  isAdmin,
  listReviewPeriods,
} from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import EmptyState from "../components/EmptyState";
import { formatMonthRange, nextIsoMonth } from "../utils/datetime";
import { saveErrorMessage } from "../utils/saveError";

/**
 * The global review-period timeline — ADMIN-only, including reads of this management page
 * (period pickers elsewhere consume the same registry read). The timeline is append-only and
 * gapless: once any period exists, the next one's start is fixed to the month after the latest
 * end (the input is locked to make the rule visible); only the latest, review-free period can
 * be deleted. Periods are immutable — there is no edit.
 */
export default function ReviewPeriods() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [endMonth, setEndMonth] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const admin = isAdmin();
  const { data: periods, isLoading, isError } = useQuery({
    queryKey: ["reviewPeriods"],
    queryFn: listReviewPeriods,
    enabled: admin,
  });
  if (!admin) return <Navigate to="/" replace />;

  const latest = periods && periods.length > 0 ? periods[periods.length - 1] : null;
  // Append-only: with a latest period the next start is not a choice — show it locked.
  const requiredStart = latest ? nextIsoMonth(latest.endMonth) : null;
  const effectiveStart = requiredStart ?? startMonth;
  const startValid = /^\d{4}-\d{2}$/.test(effectiveStart);
  const endValid = /^\d{4}-\d{2}$/.test(endMonth) && (!startValid || endMonth >= effectiveStart);

  async function append() {
    setSubmitting(true);
    setError(null);
    try {
      await createReviewPeriod({ startMonth: effectiveStart, endMonth });
      await queryClient.invalidateQueries({ queryKey: ["reviewPeriods"] });
      setStartMonth("");
      setEndMonth("");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("performanceReview.periods.adjacencyConflict")
          : saveErrorMessage(err, t, {
              forbidden: "performanceReview.error.savePermission",
              invalid: "performanceReview.periods.invalidMonths",
              failedStatus: "performanceReview.error.updateFailedStatus",
              failed: "performanceReview.error.updateFailed",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLatest() {
    if (deleteTarget == null) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteReviewPeriod(deleteTarget);
      await queryClient.invalidateQueries({ queryKey: ["reviewPeriods"] });
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setError(
        err instanceof ApiError && err.status === 409
          ? t("performanceReview.periods.deleteConflict")
          : saveErrorMessage(err, t, {
              forbidden: "performanceReview.error.savePermission",
              notFound: "performanceReview.error.gone",
              failedStatus: "performanceReview.error.updateFailedStatus",
              failed: "performanceReview.error.updateFailed",
            }),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Title order={2}>{t("performanceReview.periods.title")}</Title>
          <Text size="sm" c="dimmed">
            {t("performanceReview.periods.hint")}
          </Text>

          {isError && (
            <Alert color="red" variant="light" title={t("performanceReview.periods.loadError")}>
              {t("performanceReview.unknownError")}
            </Alert>
          )}
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {periods && periods.length === 0 && (
            <EmptyState
              icon={<IconCalendarStats size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
              label={t("performanceReview.periods.empty")}
            />
          )}
          {periods && periods.length > 0 && (
            <Stack gap="xs">
              {periods.map((p, index) => {
                const isLatest = index === periods.length - 1;
                return (
                  <Paper key={p.id} withBorder p="sm" radius="md">
                    <Group justify="space-between" wrap="nowrap">
                      <Stack gap={0}>
                        <Text size="sm" fw={500}>
                          {formatMonthRange(p.startMonth, p.endMonth, i18n.language)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {p.startMonth} – {p.endMonth}
                        </Text>
                      </Stack>
                      {isLatest && (
                        <Button
                          color="red"
                          variant="light"
                          size="xs"
                          onClick={() => setDeleteTarget(p.id)}
                          aria-label={t("performanceReview.periods.deleteAria", {
                            range: `${p.startMonth} – ${p.endMonth}`,
                          })}
                        >
                          {t("common.action.delete")}
                        </Button>
                      )}
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          {/* The append form — an in-form adder, hence "Add …" wording (the house tiers). */}
          <Group align="flex-end" gap="md">
            <TextInput
              type="month"
              label={t("performanceReview.periods.startMonth")}
              description={requiredStart != null ? t("performanceReview.periods.startLocked") : undefined}
              value={effectiveStart}
              onChange={(e) => setStartMonth(e.currentTarget.value)}
              disabled={requiredStart != null}
              w={200}
            />
            <TextInput
              type="month"
              label={t("performanceReview.periods.endMonth")}
              value={endMonth}
              onChange={(e) => setEndMonth(e.currentTarget.value)}
              min={startValid ? effectiveStart : undefined}
              w={200}
            />
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => void append()}
              loading={submitting}
              disabled={!startValid || !endValid}
            >
              {t("performanceReview.periods.addPeriod")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("performanceReview.periods.deleteTitle")}
        message={t("performanceReview.periods.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => void removeLatest()}
        loading={deleting}
      />
    </Container>
  );
}
