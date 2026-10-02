import { useMemo, useState } from "react";
import { Alert, Button, Divider, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import { getUserId } from "../api/session";
import {
  createShare,
  listAllDocumentShares,
  withdrawShare,
  type ShareableResourceType,
  type ShareResponse,
} from "../api/shares";
import { useAllUsers } from "../hooks/useAllUsers";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { documentSharesKey, invalidateShares } from "../utils/shareQueries";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import CenteredLoader from "./CenteredLoader";
import ConfirmActionModal from "./ConfirmActionModal";
import DateField from "./DateField";
import ShareStatusBadge from "./ShareStatusBadge";
import SharePeoplePicker from "./SharePeoplePicker";

type Failure = { shareeId: number; name: string; reason: string; retryable: boolean };

/** One create/withdraw failure → a readable reason (the shared saveErrorMessage chain + the 429). */
function failureReason(err: unknown, t: TFunction, kind: "create" | "withdraw"): string {
  if (err instanceof ApiError && err.status === 429) return t("sharing.error.rateLimited");
  return kind === "create"
    ? saveErrorMessage(err, t, {
        forbidden: "sharing.error.forbidden",
        notFound: "sharing.error.notFound",
        conflict: "sharing.error.duplicate",
        invalid: "sharing.error.invalid",
        failedStatus: "sharing.error.failedStatus",
        failed: "sharing.error.failed",
      })
    : saveErrorMessage(err, t, {
        forbidden: "sharing.error.withdrawForbidden",
        notFound: "sharing.error.notFound",
        conflict: "sharing.error.withdrawConflict",
        failed: "sharing.error.withdrawFailed",
      });
}

type Docs = { resourceType: ShareableResourceType; resourceId: number };

/** The picker + "Until" + submit: sequential POSTs, one per person, failures itemized. */
function ShareForm({
  resourceType,
  resourceId,
  excludedIds,
}: Docs & { excludedIds: ReadonlySet<number> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { userPool } = useAllUsers();
  const [selected, setSelected] = useState<string[]>([]);
  const [until, setUntil] = useState("");
  const [untilError, setUntilError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);

  async function submit() {
    if (selected.length === 0) return;
    if (until !== "" && until < todayIsoDate()) {
      setUntilError(t("sharing.error.untilPast"));
      return;
    }
    setUntilError(null);
    setSubmitting(true);
    setFailures([]);
    const failed: Failure[] = [];
    let created = 0;
    for (const value of selected) {
      const shareeId = Number(value);
      try {
        await createShare({ resourceType, resourceId, shareeId, expiresOn: until === "" ? undefined : until });
        created += 1;
      } catch (err) {
        failed.push({
          shareeId,
          name: userPool?.find((u) => u.id === shareeId)?.name ?? `#${shareeId}`,
          reason: failureReason(err, t, "create"),
          // A duplicate has nothing to retry — the person already holds an active share.
          retryable: !(err instanceof ApiError && err.status === 409),
        });
      }
    }
    setSubmitting(false);
    setFailures(failed);
    // Successes leave the selection; failures stay for a retry (duplicates drop out too).
    setSelected(failed.filter((f) => f.retryable).map((f) => String(f.shareeId)));
    if (failed.length === 0) setUntil("");
    await invalidateShares(queryClient, resourceType, resourceId);
    if (created > 0) showSuccessToast(t("sharing.toast.shared"));
  }

  return (
    <Stack gap="sm">
      <SharePeoplePicker value={selected} onChange={setSelected} excludedIds={excludedIds} />
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
      {failures.length > 0 && (
        <Alert color="red" variant="light">
          <Stack gap={4}>
            {failures.map((f) => (
              <Text size="sm" key={f.shareeId}>
                {t("sharing.failureItem", { name: f.name, reason: f.reason })}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
      <Group justify="flex-end">
        <Button onClick={() => void submit()} loading={submitting} disabled={selected.length === 0}>
          {t("sharing.submit")}
        </Button>
      </Group>
    </Stack>
  );
}

/** The "Current shares" list: sharee, until/no end, status pill, sharer (when not you), Withdraw. */
function CurrentShares({
  shares,
  loading,
  error,
  resourceType,
  resourceId,
}: Docs & { shares: ShareResponse[] | undefined; loading: boolean; error: unknown }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  // The row being withdrawn stays set while the confirm modal animates out (so its message keeps
  // the name); `confirmOpen` alone drives visibility.
  const [target, setTarget] = useState<ShareResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  async function confirmWithdraw() {
    if (!target) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await withdrawShare(target.id);
      showSuccessToast(t("sharing.toast.withdrawn"));
    } catch (err) {
      setWithdrawError(failureReason(err, t, "withdraw"));
    } finally {
      // Also after a failure: a 409/404/403 means the list was stale (already withdrawn, gone).
      await invalidateShares(queryClient, resourceType, resourceId);
      setWithdrawing(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Stack gap="xs">
      <Title order={3}>{t("sharing.currentShares")}</Title>
      {withdrawError && (
        <Alert color="red" variant="light">
          {withdrawError}
        </Alert>
      )}
      {loading ? (
        <CenteredLoader />
      ) : error != null ? (
        <Alert color="red" variant="light">
          {t("sharing.error.loadSharesFailed")} {loadErrorMessage(error, t)}
        </Alert>
      ) : shares == null || shares.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("sharing.noShares")}
        </Text>
      ) : (
        <Stack gap="sm">
          {shares.map((share) => (
            <Group key={share.id} justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={2} style={{ minWidth: 0 }}>
                <Group gap="xs" wrap="wrap">
                  <Text size="sm" fw={500}>
                    {share.shareeName}
                  </Text>
                  <ShareStatusBadge status={share.status} />
                </Group>
                <Text size="xs" c="dimmed">
                  {share.expiresOn
                    ? t("sharing.untilDate", { date: formatIsoDate(share.expiresOn, i18n.language) })
                    : t("sharing.noEnd")}
                  {share.sharerId !== currentUserId &&
                    ` · ${t("sharing.sharedBy", { name: share.sharerName })}`}
                </Text>
              </Stack>
              {share.status === "ACTIVE" && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  aria-label={t("sharing.withdrawAria", { name: share.shareeName })}
                  onClick={() => {
                    setTarget(share);
                    setConfirmOpen(true);
                  }}
                >
                  {t("sharing.withdraw")}
                </Button>
              )}
            </Group>
          ))}
        </Stack>
      )}
      <ConfirmActionModal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("sharing.withdrawTitle")}
        message={t("sharing.withdrawBody", { name: target?.shareeName ?? "" })}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("sharing.withdraw")}
        loading={withdrawing}
        onConfirm={() => void confirmWithdraw()}
      />
    </Stack>
  );
}

function ShareDialogBody({ resourceType, resourceId }: Docs) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  // The server returns every row for the document's author and only the caller's own rows for
  // any other own-right holder — so this one query is right for both.
  const { data: shares, isLoading, error } = useQuery({
    queryKey: documentSharesKey(resourceType, resourceId),
    queryFn: () => listAllDocumentShares(resourceType, resourceId),
  });
  // People who already hold an ACTIVE share FROM THIS CALLER (the 409 the server would answer).
  const excludedIds = useMemo(
    () =>
      new Set(
        (shares ?? []).filter((s) => s.status === "ACTIVE" && s.sharerId === currentUserId).map((s) => s.shareeId),
      ),
    [shares, currentUserId],
  );
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t("sharing.intro")}
      </Text>
      <ShareForm resourceType={resourceType} resourceId={resourceId} excludedIds={excludedIds} />
      <Divider />
      <CurrentShares
        shares={shares}
        loading={isLoading}
        error={error}
        resourceType={resourceType}
        resourceId={resourceId}
      />
    </Stack>
  );
}

/**
 * The share dialog (v4.8.0): pick people (never yourself, never someone you already share with),
 * an optional end date, submit — plus the document's current shares with Withdraw. The body
 * mounts only while open, so its state and queries reset on every open.
 */
export default function ShareDialog({
  opened,
  onClose,
  resourceType,
  resourceId,
}: Docs & { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t("sharing.dialogTitle")} size="lg" centered>
      <ShareDialogBody resourceType={resourceType} resourceId={resourceId} />
    </Modal>
  );
}
