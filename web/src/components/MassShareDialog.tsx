import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import {
  createShareBatches,
  MAX_BATCH_SHARE_RESOURCES,
  MAX_BATCH_SHARE_SHAREES,
  type ShareableResourceType,
  type ShareBatchItem,
  type ShareBatchOutcome,
} from "../api/shares";
import { useAllUsers } from "../hooks/useAllUsers";
import { todayIsoDate } from "../utils/datetime";
import {
  kindContext,
  selectedResourceIds,
  submittableRows,
  summarizeBatchResult,
  type MassShareKind,
  type MassShareRow,
} from "../utils/massShare";
import { invalidateShares } from "../utils/shareQueries";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import DateField from "./DateField";
import SharePeoplePicker from "./SharePeoplePicker";

// The warning names at most this many people before collapsing into "and N more".
const MAX_WARNED_NAMES = 5;

// Nobody is excluded up front: the picker already drops the caller and deactivated accounts, and
// the batch route answers ALREADY_SHARED per pair instead of refusing the whole call.
const NO_EXCLUDED_IDS: ReadonlySet<number> = new Set();

/** One whole-request failure → a readable reason (429 gets its own wording, the rest the shared chain). */
function failureMessage(err: unknown, t: TFunction, kind: MassShareKind): string {
  const context = kindContext(kind);
  if (err instanceof ApiError && err.status === 429) return t("sharing.batch.error.rateLimited");
  return saveErrorMessage(
    err,
    t,
    {
      forbidden: "sharing.batch.error.forbidden",
      notFound: "sharing.batch.error.notFound",
      invalid: "sharing.batch.error.invalid",
      failedStatus: "sharing.batch.error.failedStatus",
      failed: "sharing.batch.error.failed",
    },
    context,
  );
}

/** Retrying makes sense for a transient failure; a 400/403/404 would only answer the same again. */
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError && [400, 403, 404].includes(err.status));
}

type Run = {
  /** The rows as they were when the FIRST run started — a refetch must never rename the summary's people. */
  snapshot: MassShareRow[];
  /** Every item the server answered across the runs of this dialog session. */
  items: ShareBatchItem[];
  /** The last run's rejected tail, if any. */
  failure: ShareBatchOutcome["failure"];
};

function MassShareForm({
  resourceType,
  kind,
  rows,
  selected,
  submitting,
  setSubmitting,
  onSettled,
  onClose,
}: {
  resourceType: ShareableResourceType;
  kind: MassShareKind;
  rows: readonly MassShareRow[];
  selected: ReadonlySet<number>;
  /** Lifted to the dialog so it can refuse to close mid-submit (an unmounted form loses the report). */
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  onSettled: (items: readonly ShareBatchItem[], rowsAtRun: MassShareRow[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { userPool } = useAllUsers();
  const [picked, setPicked] = useState<string[]>([]);
  const [until, setUntil] = useState("");
  const [untilError, setUntilError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  // The result heading takes focus when a run settles: the Share button that had it just unmounted.
  const resultHeadingRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (run != null) resultHeadingRef.current?.focus();
  }, [run]);

  const context = kindContext(kind);
  const resourceIds = useMemo(() => selectedResourceIds(rows, selected), [rows, selected]);
  const pickedIds = useMemo(() => new Set(picked.map(Number)), [picked]);
  // Reviews only (the v4.8.0 accepted consequence): the recipients who are themselves among the
  // reviewed people. Other kinds carry no such warning — a person always sees their own document.
  const warnedNames = useMemo(
    () =>
      kind !== "reviews"
        ? []
        : submittableRows(rows, selected)
            .filter((row) => pickedIds.has(row.person.userId))
            .map((row) => row.person.name),
    [kind, rows, selected, pickedIds],
  );
  const chunkCount = Math.ceil(resourceIds.length / MAX_BATCH_SHARE_RESOURCES);

  async function submit(ids: readonly number[]) {
    if (picked.length === 0 || ids.length === 0) return;
    if (until !== "" && until < todayIsoDate()) {
      setUntilError(t("sharing.error.untilPast"));
      return;
    }
    setUntilError(null);
    setSubmitting(true);
    // The pre-run rows: the candidates refetch below can turn a just-shared person unshareable,
    // and the summary would then print them as "#id".
    const snapshot = run?.snapshot ?? [...rows];
    const outcome = await createShareBatches(
      resourceType,
      ids,
      picked.map(Number),
      until === "" ? undefined : until,
    );
    setSubmitting(false);
    setRun({
      snapshot,
      items: [...(run?.items ?? []), ...outcome.items],
      failure: outcome.failure,
    });
    onSettled(outcome.items, snapshot);
    await invalidateShares(queryClient);
    if (outcome.created > 0) showSuccessToast(t("sharing.toast.batchShared", { context }));
  }

  let resultBody: ReactNode = null;
  let resultActions: ReactNode = null;
  if (run != null) {
    const shareeNames = new Map((userPool ?? []).map((u) => [u.id, u.name] as const));
    const summary = summarizeBatchResult(run.items, run.snapshot, shareeNames);
    const failure = run.failure;
    const nothingYet = summary.created === 0 && summary.alreadyShared.length === 0 && summary.failed.length === 0;
    resultBody = (
      <Stack gap="md">
        {failure && (
          <Alert color="red" variant="light">
            {run.items.length === 0
              ? failureMessage(failure.error, t, kind)
              : t("sharing.batch.partial", {
                  context,
                  count: failure.resourceIds.length,
                  reason: failureMessage(failure.error, t, kind),
                })}
          </Alert>
        )}
        <Stack gap="xs">
          <Text size="sm" fw={600} tabIndex={-1} ref={resultHeadingRef}>
            {t("sharing.batch.result.title")}
          </Text>
          {summary.created > 0 && (
            <Text size="sm" fw={500}>
              {t("sharing.batch.result.created", { count: summary.created })}
            </Text>
          )}
          {nothingYet && !failure && <Text size="sm">{t("sharing.batch.result.nothing")}</Text>}
          {summary.alreadyShared.length > 0 && (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {t("sharing.batch.result.alreadyTitle")}
              </Text>
              {summary.alreadyShared.map((line) => (
                <Text size="sm" key={line.resourceId}>
                  {t("sharing.batch.result.alreadyLine", {
                    person: line.person,
                    sharees: line.sharees.join(", "),
                  })}
                </Text>
              ))}
            </Stack>
          )}
          {summary.failed.length > 0 && (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                {t("sharing.batch.result.failedTitle")}
              </Text>
              {summary.failed.map((line) => (
                <Text size="sm" key={`${line.resourceId}-${line.reason}`}>
                  {line.reason === "FORBIDDEN"
                    ? t("sharing.batch.result.failedLine_FORBIDDEN", { context, person: line.person })
                    : t("sharing.batch.result.failedLine_NOT_FOUND", { context, person: line.person })}
                </Text>
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    );
    resultActions = (
      <Group justify="flex-end">
        {failure && !isRetryable(failure.error) && (
          <Button variant="default" onClick={() => setRun(null)}>
            {t("sharing.batch.backToForm")}
          </Button>
        )}
        {failure && isRetryable(failure.error) && (
          <Button loading={submitting} onClick={() => void submit(failure.resourceIds)}>
            {t("sharing.batch.retry", { context, count: failure.resourceIds.length })}
          </Button>
        )}
        <Button variant={failure ? "default" : "filled"} onClick={onClose} disabled={submitting}>
          {t("common.action.close")}
        </Button>
      </Group>
    );
  }

  const shownNames =
    warnedNames.length > MAX_WARNED_NAMES
      ? t("sharing.batch.moreNames", {
          names: warnedNames.slice(0, MAX_WARNED_NAMES).join(", "),
          count: warnedNames.length - MAX_WARNED_NAMES,
        })
      : warnedNames.join(", ");

  // One tree for both phases so the live region stays mounted (empty) before the results land —
  // a region that mounts together with its content is not announced.
  return (
    <Stack gap="md">
      <div aria-live="polite">{resultBody}</div>
      {run != null ? (
        resultActions
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            {t("sharing.batch.intro", { context, count: resourceIds.length })}
          </Text>
          <SharePeoplePicker
            value={picked}
            onChange={setPicked}
            excludedIds={NO_EXCLUDED_IDS}
            maxValues={MAX_BATCH_SHARE_SHAREES}
          />
          <Text size="xs" c="dimmed">
            {t("sharing.batch.maxPeople", { max: MAX_BATCH_SHARE_SHAREES })}
          </Text>
          <DateField
            label={t("sharing.until")}
            description={t("sharing.untilHint")}
            value={until}
            onChange={(iso) => {
              setUntil(iso);
              setUntilError(null);
            }}
            minIso={todayIsoDate()}
            error={untilError}
            w={{ base: "100%", sm: 260 }}
          />
          {warnedNames.length > 0 && (
            <Alert color="yellow" variant="light">
              {t("sharing.batch.subjectWarning", { count: warnedNames.length, names: shownNames })}
            </Alert>
      )}
      {chunkCount > 1 && (
        <Text size="sm" c="dimmed">
          {t("sharing.batch.chunkHint", { context, max: MAX_BATCH_SHARE_RESOURCES, batches: chunkCount })}
        </Text>
      )}
      <Group justify="flex-end">
        <Button
          onClick={() => void submit(resourceIds)}
          loading={submitting}
          disabled={picked.length === 0 || resourceIds.length === 0}
        >
          {t("sharing.submit")}
        </Button>
      </Group>
    </Stack>
      )}
    </Stack>
  );
}

/**
 * The mass-share dialog (v4.10.0, kind-generic since v4.11.0): the recipients (up to the server's 20), an optional end date
 * exactly like the single Share dialog, and the result panel of the run. `onSettled` hands the
 * answered items and the PRE-run rows back to the page so it can drop the settled people from the
 * selection. The body mounts only while open, so its state resets on every open.
 */
export default function MassShareDialog({
  opened,
  onClose,
  resourceType,
  kind,
  rows,
  selected,
  onSettled,
}: {
  opened: boolean;
  onClose: () => void;
  /** The kind of document the rows' resource ids name. */
  resourceType: ShareableResourceType;
  /** Picks the wording (an i18next context) and whether the subject warning applies. */
  kind: MassShareKind;
  rows: readonly MassShareRow[];
  selected: ReadonlySet<number>;
  onSettled: (items: readonly ShareBatchItem[], rowsAtRun: MassShareRow[]) => void;
}) {
  const { t } = useTranslation();
  // While a batch is in flight the modal cannot be dismissed: closing unmounts the form and the
  // partial-failure report (and its retry) would be lost.
  const [submitting, setSubmitting] = useState(false);
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("sharing.batch.title", { context: kindContext(kind) })}
      size="lg"
      centered
      closeOnClickOutside={!submitting}
      closeOnEscape={!submitting}
      withCloseButton={!submitting}
    >
      <MassShareForm
        resourceType={resourceType}
        kind={kind}
        rows={rows}
        selected={selected}
        submitting={submitting}
        setSubmitting={setSubmitting}
        onSettled={onSettled}
        onClose={onClose}
      />
    </Modal>
  );
}
