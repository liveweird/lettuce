import type { ParseKeys } from "i18next";
import { useState } from "react";
import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import EmojiTextarea from "./EmojiTextarea";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createDaysOffCorrection, deleteDaysOffCorrection, listDaysOffCorrections, updateDaysOffCorrection, type DaysOffCorrection, type DaysOffCorrectionOperation } from "../api/daysoff";
import { formatDate } from "../utils/datetime";
import { formatDays } from "../utils/daysOffCost";
import { invalidateDaysOffCorrections } from "../utils/daysOffQueries";
import { saveErrorMessage } from "../utils/saveError";
import ReadOnlyField from "./ReadOnlyField";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "./ConfirmActionModal";

const OPERATIONS = ["ADD", "SUBTRACT"] as const;
const MAX_COMMENT = 1000;

type Draft = {
  year: number;
  operation: DaysOffCorrectionOperation;
  days: number | "";
  comment: string;
  /** The paid pool kind (v3.2.0); null = the default pool. */
  poolTypeId: number | null;
};

function emptyDraft(defaultYear: number, poolTypeId: number | null): Draft {
  return { year: defaultYear, operation: "ADD", days: "", comment: "", poolTypeId };
}

function signedDays(c: DaysOffCorrection, locale: string): string {
  const sign = c.operation === "ADD" ? "+" : "−";
  return `${sign}${formatDays(c.days, locale)}`;
}

/**
 * The one corrections UI (rendered inside a Modal by the budget surfaces): the read-only list
 * for every permitted viewer (subordinate, chain, HR), plus — with [canManage] (a manager in
 * the subordinate's chain, v2.33.0) — an add form and per-row edit/soft-delete. A correction
 * adjusts the paid budget of ONE pool (v3.2.0 — the Pool select appears once the user holds
 * more than one; the pool is fixed on edit) for its year immediately; there is no approval
 * workflow.
 */
export default function DaysOffCorrections({
  userId,
  defaultYear,
  canManage,
  pools = [],
}: {
  userId: number;
  /** The year the add form pre-selects — the budget view's currently shown year. */
  defaultYear: number;
  canManage: boolean;
  /** The user's non-archived pools (from their budget rows) — the add form's Pool options;
   * the add form pre-selects the default (first) one. */
  pools?: { id: number; name: string }[];
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultYear, null));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffCorrections", userId],
    queryFn: () => listDaysOffCorrections(userId),
  });

  const yearOptions = Array.from({ length: 5 }, (_, i) => String(defaultYear - 3 + i));
  // Rows name their pool once more than one pool is in play — offered or already corrected
  // (a single-pool person's rows stay unlabelled, an archived pool's rows keep their name).
  const poolsInPlay = new Set([...pools.map((p) => p.id), ...(data ?? []).map((c) => c.poolTypeId)]).size > 1;
  const editingPoolName = editingId != null ? data?.find((c) => c.id === editingId)?.poolName : undefined;
  const draftValid =
    draft.days !== "" && draft.days > 0 && (draft.days * 2) % 1 === 0 && draft.comment.trim().length > 0;

  async function run(action: () => Promise<unknown>, successKey: ParseKeys) {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      await invalidateDaysOffCorrections(queryClient, userId);
      showSuccessToast(t(successKey));
      setDraft(emptyDraft(defaultYear, null));
      setEditingId(null);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setError(
        saveErrorMessage(err, t, {
          forbidden: "daysOff.error.actionPermission",
          notFound: "daysOff.error.gone",
          invalid: "daysOff.corrections.invalid",
          failedStatus: "daysOff.error.saveFailedStatus",
          failed: "daysOff.error.saveFailed",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (draft.days === "") return;
    const body = {
      userId,
      year: draft.year,
      operation: draft.operation,
      days: draft.days,
      comment: draft.comment.trim(),
      // The pool is create-only (immutable on PUT, ignored server-side like userId).
      ...(editingId == null && draft.poolTypeId != null ? { poolTypeId: draft.poolTypeId } : {}),
    };
    if (editingId != null) {
      void run(() => updateDaysOffCorrection(editingId, body), "daysOff.corrections.toastUpdated");
    } else {
      void run(() => createDaysOffCorrection(body), "daysOff.corrections.toastAdded");
    }
  }

  function startEdit(c: DaysOffCorrection) {
    setEditingId(c.id);
    setDraft({ year: c.year, operation: c.operation, days: c.days, comment: c.comment, poolTypeId: c.poolTypeId });
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t(canManage ? "daysOff.corrections.hint" : "daysOff.corrections.hintReadOnly")}
      </Text>

      {isError && (
        <Alert color="red" variant="light">
          {t("daysOff.corrections.loadError")}
        </Alert>
      )}
      {isLoading && (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      )}
      {data && data.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          {t("daysOff.corrections.empty")}
        </Text>
      )}
      {data && data.length > 0 && (
        <Stack gap="xs">
          {data.map((c) => (
            <Paper key={c.id} withBorder p="sm" radius="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={700} c={c.operation === "ADD" ? "teal" : "red"} span>
                      {signedDays(c, i18n.language)}
                    </Text>
                    <Text size="sm" fw={500} span>
                      {c.year}
                    </Text>
                    {poolsInPlay && (
                      <Text size="sm" c="dimmed" span>
                        {c.poolName}
                      </Text>
                    )}
                  </Group>
                  <Text size="sm" style={{ wordBreak: "break-word" }}>
                    {c.comment}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("daysOff.corrections.byLine", {
                      author: c.authorName,
                      date: formatDate(c.createdAt, i18n.language),
                    })}
                  </Text>
                </Stack>
                {canManage && (
                  <Group gap={4} wrap="nowrap">
                    <Button
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPencil size={14} />}
                      disabled={submitting}
                      onClick={() => startEdit(c)}
                      aria-label={t("daysOff.corrections.editAria", { year: c.year })}
                    >
                      {t("common.action.edit")}
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      disabled={submitting}
                      onClick={() => setDeleteTarget(c.id)}
                      aria-label={t("daysOff.corrections.deleteAria", { year: c.year })}
                    >
                      {t("common.action.delete")}
                    </Button>
                  </Group>
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

      {canManage && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t(editingId != null ? "daysOff.corrections.editTitle" : "daysOff.corrections.addTitle")}
          </Text>
          <Group align="flex-end" gap="md" wrap="wrap">
            {/* The pool is create-only: a read-only label while editing (an archived pool's
                correction would otherwise show a blank Select), the picker while adding. */}
            {editingId != null && poolsInPlay && (
              <ReadOnlyField label={t("daysOff.pool.label")}>
                <Text size="sm">{editingPoolName}</Text>
              </ReadOnlyField>
            )}
            {editingId == null && pools.length > 1 && (
              <Select
                label={t("daysOff.pool.label")}
                data={pools.map((p) => ({ value: String(p.id), label: p.name }))}
                value={draft.poolTypeId != null ? String(draft.poolTypeId) : String(pools[0].id)}
                onChange={(v) => v && setDraft((d) => ({ ...d, poolTypeId: Number(v) }))}
                allowDeselect={false}
                w={180}
              />
            )}
            <Select
              label={t("daysOff.budget.year")}
              data={yearOptions}
              value={String(draft.year)}
              onChange={(v) => v && setDraft((d) => ({ ...d, year: Number(v) }))}
              allowDeselect={false}
              w={110}
            />
            <Select
              label={t("daysOff.corrections.operation")}
              data={OPERATIONS.map((o) => ({ value: o, label: t(`daysOff.corrections.operation_${o}`) }))}
              value={draft.operation}
              onChange={(v) => v && setDraft((d) => ({ ...d, operation: v as DaysOffCorrectionOperation }))}
              allowDeselect={false}
              w={150}
            />
            <NumberInput
              label={t("daysOff.column.days")}
              min={0.5}
              max={365}
              step={0.5}
              allowNegative={false}
              value={draft.days}
              onChange={(v) => setDraft((d) => ({ ...d, days: typeof v === "number" ? v : "" }))}
              w={110}
            />
          </Group>
          <EmojiTextarea
            label={t("daysOff.corrections.comment")}
            description={t("daysOff.corrections.commentHint")}
            value={draft.comment}
            onChange={(value) => setDraft((d) => ({ ...d, comment: value }))}
            maxLength={MAX_COMMENT}
            autosize
            minRows={2}
          />
          <Group justify="flex-end" gap="sm">
            {editingId != null && (
              <Button
                variant="default"
                disabled={submitting}
                onClick={() => {
                  setEditingId(null);
                  setDraft(emptyDraft(defaultYear, null));
                }}
              >
                {t("common.action.cancel")}
              </Button>
            )}
            <Button
              leftSection={editingId == null ? <IconPlus size={16} /> : undefined}
              onClick={submit}
              loading={submitting}
              disabled={!draftValid}
            >
              {t(editingId != null ? "common.action.save" : "daysOff.corrections.addAction")}
            </Button>
          </Group>
        </Stack>
      )}

      <ConfirmActionModal
        opened={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("daysOff.corrections.deleteTitle")}
        message={t("daysOff.corrections.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => {
          if (deleteTarget != null) {
            void run(() => deleteDaysOffCorrection(deleteTarget), "daysOff.corrections.toastDeleted");
          }
        }}
        loading={submitting}
      />
    </Stack>
  );
}
