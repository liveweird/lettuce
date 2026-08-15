import { useState } from "react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Timeline,
  Title,
} from "@mantine/core";
import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  createCareerPosition,
  deleteCareerPosition,
  listCareerPositions,
  updateCareerPosition,
  type CareerPosition,
} from "../api/client";
import CareerProfileSelect from "../components/CareerProfileSelect";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { pickDictionaryValue } from "../utils/dictionaryForm";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

type Draft = {
  startDate: string;
  // Dictionary-entry ids as strings ("" = not picked yet). All three are REQUIRED on submit
  // (v2.15.1 — a position IS the full triple); the submit stays disabled until they are set.
  careerPathId: string;
  careerSpecializationId: string;
  seniorityLevelId: string;
};

function draftOf(p: CareerPosition): Draft {
  return {
    startDate: p.startDate,
    careerPathId: p.careerPath ? String(p.careerPath.id) : "",
    careerSpecializationId: p.careerSpecialization ? String(p.careerSpecialization.id) : "",
    seniorityLevelId: p.seniorityLevel ? String(p.seniorityLevel.id) : "",
  };
}

// The ADD form starts from the CURRENT position (a new position is usually a one-field
// delta — promotion, path switch); only the start date begins empty. No positions yet =
// a blank triple.
function addDraftOf(current?: CareerPosition): Draft {
  return {
    startDate: "",
    careerPathId: current?.careerPath ? String(current.careerPath.id) : "",
    careerSpecializationId: current?.careerSpecialization
      ? String(current.careerSpecialization.id)
      : "",
    seniorityLevelId: current?.seniorityLevel ? String(current.seniorityLevel.id) : "",
  };
}

// The triple as a comparable key ("" when any field is unset). Mirrors the server's
// adjacent-sameness 409 (v2.15.2): a position identical to its neighbor is not a step.
function tripleKey(d: Pick<Draft, "careerPathId" | "careerSpecializationId" | "seniorityLevelId">) {
  if (d.careerPathId === "" || d.careerSpecializationId === "" || d.seniorityLevelId === "") return "";
  return `${d.careerPathId}|${d.careerSpecializationId}|${d.seniorityLevelId}`;
}

// A neighbor's triple key, or null when it is a legacy partial row (which never blocks).
function neighborTripleKey(p: CareerPosition | undefined): string | null {
  if (p == null) return null;
  const key = tripleKey(draftOf(p));
  return key === "" ? null : key;
}

// draftValid guarantees all three are set, so the body always carries the complete triple
// (the wire type requires it since v2.15.1).
function toBody(draft: Draft) {
  return {
    startDate: draft.startDate,
    careerPathId: Number(draft.careerPathId),
    careerSpecializationId: Number(draft.careerSpecializationId),
    seniorityLevelId: Number(draft.seniorityLevelId),
  };
}

// The editor (add or correct). Owns the draft; the PARENT remounts it via `key` whenever the
// seed changes (a row enters/leaves edit mode, the current position changes after a submit),
// which is what prefills the fields — no state-syncing effect, and a background refetch that
// changes nothing keeps the key stable, so in-progress input is never clobbered.
function PositionForm({
  initial,
  seedPosition,
  forbiddenTriples,
  editing,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  /** The position whose values seeded [initial] — its (possibly soft-deleted) entries keep displaying. */
  seedPosition?: CareerPosition;
  /** The neighboring positions' triple keys the draft must differ from (the server's v2.15.2 409). */
  forbiddenTriples: string[];
  editing: boolean;
  submitting: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(initial);
  const draftKey = tripleKey(draft);
  // "" = not all three set yet — the required-fields rule already blocks that case.
  const sameAsNeighbor = draftKey !== "" && forbiddenTriples.includes(draftKey);
  const draftValid = draft.startDate !== "" && draftKey !== "" && !sameAsNeighbor;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {t(editing ? "users.career.editTitle" : "users.career.startTitle")}
      </Text>
      <Text size="xs" c="dimmed">
        {t(editing ? "users.career.editHint" : "users.career.startHint")}
      </Text>
      <Group align="flex-start" gap="md" wrap="wrap">
        <TextInput
          type="date"
          withAsterisk
          label={t("users.career.startDate")}
          value={draft.startDate}
          max={todayIsoDate()}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setDraft((d) => ({ ...d, startDate: value }));
          }}
          w={170}
        />
        <CareerProfileSelect
          slug="career-paths"
          withAsterisk
          label={t("common.field.careerPath")}
          current={seedPosition?.careerPath}
          value={draft.careerPathId}
          onChange={(value) => setDraft((d) => ({ ...d, careerPathId: value ?? "" }))}
          w={210}
        />
        <CareerProfileSelect
          slug="career-specializations"
          withAsterisk
          label={t("common.field.careerSpecialization")}
          current={seedPosition?.careerSpecialization}
          value={draft.careerSpecializationId}
          onChange={(value) => setDraft((d) => ({ ...d, careerSpecializationId: value ?? "" }))}
          w={210}
        />
        <CareerProfileSelect
          slug="seniority-levels"
          withAsterisk
          label={t("common.field.seniorityLevel")}
          current={seedPosition?.seniorityLevel}
          value={draft.seniorityLevelId}
          onChange={(value) => setDraft((d) => ({ ...d, seniorityLevelId: value ?? "" }))}
          w={210}
        />
      </Group>
      {sameAsNeighbor && (
        <Text size="xs" c="dimmed">
          {t(editing ? "users.career.sameAsNeighborEdit" : "users.career.sameAsNeighbor")}
        </Text>
      )}
      <Group justify="flex-end" gap="sm">
        {onCancel != null && (
          <Button variant="default" disabled={submitting} onClick={onCancel}>
            {t("common.action.cancel")}
          </Button>
        )}
        <Button
          leftSection={editing ? undefined : <IconPlus size={16} />}
          onClick={() => onSubmit(draft)}
          loading={submitting}
          disabled={!draftValid}
        >
          {t(editing ? "common.action.save" : "users.career.startAction")}
        </Button>
      </Group>
    </Stack>
  );
}

// One position's triple, small: dimmed label + value in the viewer's language (or a dash).
function PositionValue({
  label,
  entry,
}: {
  label: string;
  entry: { id: number; valueEn: string; valuePl: string } | null;
}) {
  const { i18n } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ minWidth: "max-content" }}>
        {label}
      </Text>
      {entry ? (
        <Text size="sm">{pickDictionaryValue(entry, i18n.resolvedLanguage)}</Text>
      ) : (
        <Text size="sm" c="dimmed">
          —
        </Text>
      )}
    </Group>
  );
}

/**
 * The per-user career progression drill-down (`/users/:userId/career`, v2.15.0): the position
 * timeline, newest first, the current (open-ended) position emphasized. Readable by ANY
 * authenticated caller — deliberately NO manager redirect (the new-position notification
 * deep-links the person here with a bare URL); `callerManages` (the `manages=1` link
 * assertion — the server's 403s are the real enforcement) only reveals the chain-manager
 * editor: start a new position (concluding the current one), correct a row, delete a row.
 */
export default function UserCareer() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { userId, idIsValid, name, origin, callerManages } = useDashboardDrillDown("career");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["careerPositions", userId],
    queryFn: () => listCareerPositions(userId),
    enabled: idIsValid,
  });

  const currentPosition = data && data.length > 0 ? data[data.length - 1] : undefined;

  if (!idIsValid) return <Navigate to="/" replace />;

  const who = name ?? t("users.career.userFallback", { id: userId });
  // Server order is chronological; the timeline reads newest-first like every history surface.
  const newestFirst = data ? [...data].reverse() : [];
  const editingPosition = editingId != null ? data?.find((p) => p.id === editingId) : undefined;
  // The triples the draft must differ from (the adjacent-sameness rule, v2.15.2): the current
  // position when adding; the chronological neighbors of the edited row when correcting.
  // Legacy partial neighbors resolve to null and never block.
  const editingIndex = editingPosition != null && data ? data.indexOf(editingPosition) : -1;
  const forbiddenTriples = (
    editingIndex >= 0
      ? [neighborTripleKey(data?.[editingIndex - 1]), neighborTripleKey(data?.[editingIndex + 1])]
      : [neighborTripleKey(currentPosition)]
  ).filter((k): k is string => k != null);

  async function run(action: () => Promise<unknown>, successKey: string) {
    setSubmitting(true);
    setError(null);
    try {
      await action();
      // The current-position triple feeds the person cards and user rows — refresh them too.
      await queryClient.invalidateQueries({ queryKey: ["careerPositions", userId] });
      await queryClient.invalidateQueries({ queryKey: ["teamMembers"] });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", userId] });
      showSuccessToast(t(successKey));
      // Back to the ADD form; the refetched data changes the form's key, so it remounts
      // prefilled from the (possibly just-changed) current position.
      setEditingId(null);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      setError(
        saveErrorMessage(err, t, {
          forbidden: "users.career.errorPermission",
          notFound: "users.career.errorGone",
          conflict: "users.career.errorOrder",
          invalid: "users.career.errorInvalid",
          failedStatus: "users.career.saveFailedStatus",
          failed: "users.career.saveFailed",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function submit(draft: Draft) {
    if (editingId != null) {
      void run(
        () => updateCareerPosition(userId, editingId, toBody(draft)),
        "users.career.toastUpdated",
      );
    } else {
      void run(() => createCareerPosition(userId, toBody(draft)), "users.career.toastAdded");
    }
  }

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("users.career.title", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(callerManages ? "users.career.hintManage" : "users.career.hint", { who })}
        </Text>
      </Stack>

      <Paper withBorder p="md" radius="md">
        {isError ? (
          <Alert color="red" variant="light">
            {t("users.career.loadError")}
          </Alert>
        ) : isLoading || !data ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : newestFirst.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            {t("users.career.empty")}
          </Text>
        ) : (
          <Timeline active={0} bulletSize={14} lineWidth={2}>
            {newestFirst.map((p) => (
              <Timeline.Item
                key={p.id}
                title={
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm" fw={600} span>
                      {p.endDate != null
                        ? `${formatIsoDate(p.startDate, i18n.language)} – ${formatIsoDate(p.endDate, i18n.language)}`
                        : t("users.career.since", { date: formatIsoDate(p.startDate, i18n.language) })}
                    </Text>
                    {p.endDate == null && (
                      <Badge size="sm" variant="light" color="lettuce">
                        {t("users.career.currentBadge")}
                      </Badge>
                    )}
                  </Group>
                }
              >
                <Stack gap={2} mt={2}>
                  <PositionValue label={t("users.profile.path")} entry={p.careerPath} />
                  <PositionValue
                    label={t("users.profile.specialization")}
                    entry={p.careerSpecialization}
                  />
                  <PositionValue label={t("users.profile.seniority")} entry={p.seniorityLevel} />
                  {callerManages && (
                    <Group gap={4} mt={4}>
                      <Button
                        variant="subtle"
                        size="xs"
                        leftSection={<IconPencil size={14} />}
                        disabled={submitting}
                        onClick={() => setEditingId(p.id)}
                        aria-label={t("users.career.editAria", { date: p.startDate })}
                      >
                        {t("common.action.edit")}
                      </Button>
                      <Button
                        variant="subtle"
                        color="red"
                        size="xs"
                        leftSection={<IconTrash size={14} />}
                        disabled={submitting}
                        onClick={() => setDeleteTarget(p.id)}
                        aria-label={t("users.career.deleteAria", { date: p.startDate })}
                      >
                        {t("common.action.delete")}
                      </Button>
                    </Group>
                  )}
                </Stack>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Paper>

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      {callerManages && (
        <Paper withBorder p="md" radius="md">
          <PositionForm
            // Remounting IS the prefill: a fresh key on entering/leaving edit mode or when
            // the current position changes (after a submit's refetch) reseeds the fields;
            // an unchanged key across background refetches preserves in-progress input.
            key={
              editingPosition != null
                ? `edit-${editingPosition.id}-${editingPosition.lastModified}`
                : `add-${currentPosition?.id ?? 0}`
            }
            initial={editingPosition != null ? draftOf(editingPosition) : addDraftOf(currentPosition)}
            seedPosition={editingPosition ?? currentPosition}
            forbiddenTriples={forbiddenTriples}
            editing={editingPosition != null}
            submitting={submitting}
            onSubmit={submit}
            onCancel={editingPosition != null ? () => setEditingId(null) : undefined}
          />
        </Paper>
      )}

      <ConfirmActionModal
        opened={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title={t("users.career.deleteTitle")}
        message={t("users.career.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        onConfirm={() => {
          if (deleteTarget != null) {
            void run(() => deleteCareerPosition(userId, deleteTarget), "users.career.toastDeleted");
          }
        }}
        loading={submitting}
      />
    </Stack>
  );
}
