import { useState } from "react";
import { Alert, Select, Stack, Text } from "@mantine/core";
import { IconExternalLink, IconShare3, IconUserMinus } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { listShares, withdrawShare, type ShareResponse, type ShareStatus } from "../api/shares";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ResponsiveTable from "../components/ResponsiveTable";
import RowActions from "../components/RowActions";
import ShareStatusBadge from "../components/ShareStatusBadge";
import SortHeader from "../components/SortHeader";
import StatusPill from "../components/StatusPill";
import TableLoadingRow from "../components/TableLoadingRow";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, useStoredState } from "../hooks/useStoredState";
import { formatIsoDate } from "../utils/datetime";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { SHARE_FEATURE, SHARE_TYPES, shareDocumentLabel, shareKindContext, shareOpenPath } from "../utils/shareKinds";
import { shareOpenLink } from "../utils/shareLinks";
import { invalidateShares } from "../utils/shareQueries";
import { showSuccessToast } from "../utils/toast";

type SharesView = "withMe" | "byMe";

const SORT_FIELDS = ["createdAt", "expiresOn"] as const;
type SortField = (typeof SORT_FIELDS)[number];

// `withMe` never returns WITHDRAWN rows (the server hides them), so that filter option would
// only ever produce an empty list there.
const STATUSES_OF: Record<SharesView, readonly ShareStatus[]> = {
  withMe: ["ACTIVE", "EXPIRED"],
  byMe: ["ACTIVE", "EXPIRED", "WITHDRAWN"],
};

/**
 * One tab of the Shared screen: the caller's shares `withMe` (the counterpart is the sharer) or
 * `byMe` (the counterpart is the sharee; ACTIVE rows can be withdrawn). Per-kind feature flags
 * (caller-only semantics): the type filter lists only the kinds the viewer has enabled, and a
 * `byMe` row of a disabled kind stays listed — the sharer may still withdraw it — but has no
 * Open (the area's pages would bounce them to the dashboard). `withMe` already hides those
 * kinds server-side.
 */
export default function SharesTable({ view }: { view: SharesView }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const here = useCurrentPath();
  const storeKey = `shares.${view}`;

  const statuses = STATUSES_OF[view];
  const typeOptions = SHARE_TYPES.filter((type) => hasFeature(SHARE_FEATURE[type]));
  const [statusFilter, setStatusState] = useStoredState<ShareStatus | null>(
    `${storeKey}.filter.status`,
    null,
    isOneOfOrNull(statuses),
  );
  const [typeFilter, setTypeState] = useStoredState<(typeof SHARE_TYPES)[number] | null>(
    `${storeKey}.filter.type`,
    null,
    isOneOfOrNull(typeOptions),
  );
  // A stale withdraw failure belongs to the list it was raised on — a filter change drops it
  // (a tab switch remounts this component, which drops it too).
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const setStatusFilter = (next: ShareStatus | null) => {
    setWithdrawError(null);
    setStatusState(next);
  };
  const setTypeFilter = (next: (typeof SHARE_TYPES)[number] | null) => {
    setWithdrawError(null);
    setTypeState(next);
  };
  const activeFilterCount = (statusFilter ? 1 : 0) + (typeFilter ? 1 : 0);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [statusFilter, typeFilter],
      { key: storeKey, sortFields: SORT_FIELDS },
      "desc", // newest shares first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["shares", view, page, pageSize, sortParam, statusFilter, typeFilter],
    queryFn: () =>
      listShares({
        view,
        status: statusFilter ?? undefined,
        resourceType: typeFilter ?? undefined,
        page,
        pageSize,
        sort: sortParam,
      }),
    placeholderData: keepPreviousData,
  });

  // Withdraw (byMe, ACTIVE rows). `target` outlives the closing confirm so its message keeps the
  // name; `confirmOpen` alone drives visibility.
  const [target, setTarget] = useState<ShareResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  async function confirmWithdraw() {
    if (!target) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await withdrawShare(target.id);
      showSuccessToast(t("sharing.toast.withdrawn"));
    } catch (err) {
      setWithdrawError(
        saveErrorMessage(err, t, {
          forbidden: "sharing.error.withdrawForbidden",
          notFound: "sharing.error.notFound",
          conflict: "sharing.error.withdrawConflict",
          failed: "sharing.error.withdrawFailed",
        }),
      );
    } finally {
      // Also after a failure: a 409/404/403 means the row on screen was stale.
      await invalidateShares(queryClient, target.resourceType, target.resourceId);
      setWithdrawing(false);
      setConfirmOpen(false);
    }
  }

  const counterpartLabel = view === "withMe" ? t("sharing.page.sharedBy") : t("sharing.page.sharedWith");
  // The header definitions drive both the <thead> and the spanning rows' colSpan (+1 = actions).
  const headers: { key: string; label: string; sortField?: SortField }[] = [
    { key: "document", label: t("sharing.page.document") },
    { key: "counterpart", label: counterpartLabel },
    { key: "until", label: t("sharing.page.until"), sortField: "expiresOn" },
    { key: "status", label: t("sharing.page.status") },
    { key: "created", label: t("sharing.page.created"), sortField: "createdAt" },
  ];
  const columnCount = headers.length + 1;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <Select
          label={t("sharing.page.typeFilter")}
          data={[
            { value: "", label: t("common.state.any") },
            ...typeOptions.map((type) => ({ value: type, label: t(`sharing.type.${type}`) })),
          ]}
          value={typeFilter ?? ""}
          onChange={(v) => setTypeFilter(typeOptions.find((type) => type === v) ?? null)}
          allowDeselect={false}
          w={220}
        />
        <Select
          label={t("sharing.page.statusFilter")}
          data={[
            { value: "", label: t("common.state.any") },
            ...statuses.map((s) => ({ value: s, label: t(`sharing.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter(statuses.find((s) => s === v) ?? null)}
          allowDeselect={false}
          w={180}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("sharing.page.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}
      {withdrawError && (
        <Alert color="red" variant="light">
          {withdrawError}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            {headers.map((h) =>
              h.sortField ? (
                <ResponsiveTable.Th key={h.key} sortable>
                  <SortHeader
                    field={h.sortField}
                    label={h.label}
                    activeField={sortField}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                  />
                </ResponsiveTable.Th>
              ) : (
                <ResponsiveTable.Th key={h.key}>{h.label}</ResponsiveTable.Th>
              ),
            )}
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((share) => {
              const label = shareDocumentLabel(share, t, i18n.language);
              const featureOn = hasFeature(SHARE_FEATURE[share.resourceType]);
              // withMe: only a working (ACTIVE) share opens anything; byMe: the sharer reads the
              // document in their own right whatever the share's state.
              const canOpen = featureOn && (view === "byMe" || share.status === "ACTIVE");
              const canWithdraw = view === "byMe" && share.status === "ACTIVE";
              const counterpart =
                view === "withMe"
                  ? { id: share.sharerId, name: share.sharerName }
                  : { id: share.shareeId, name: share.shareeName };
              return (
                <ResponsiveTable.Tr key={share.id}>
                  <ResponsiveTable.Td label={t("sharing.page.document")} primary>
                    <Stack gap={4} align="flex-start">
                      <StatusPill color="gray" size="sm">
                        {t(`sharing.type.${share.resourceType}`)}
                      </StatusPill>
                      <Text size="sm" lineClamp={2} style={{ overflowWrap: "break-word" }}>
                        {label}
                      </Text>
                    </Stack>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={counterpartLabel}>
                    <PersonCell userId={counterpart.id} name={counterpart.name} currentUserId={currentUserId} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("sharing.page.until")}>
                    <Text size="sm" c={share.expiresOn ? undefined : "dimmed"}>
                      {share.expiresOn ? formatIsoDate(share.expiresOn, i18n.language) : t("sharing.noEnd")}
                    </Text>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("sharing.page.status")}>
                    <ShareStatusBadge status={share.status} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("sharing.page.created")}>
                    <DateCell value={share.createdAt} mode="date" />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td actions>
                    <RowActions
                      name={label}
                      primary={
                        canOpen
                          ? {
                              icon: <IconExternalLink size={16} />,
                              label: t("sharing.page.open"),
                              ariaLabel: t("sharing.page.openAria", { label }),
                              to: shareOpenLink(shareOpenPath(share, currentUserId), here),
                            }
                          : undefined
                      }
                      items={
                        canWithdraw
                          ? [
                              {
                                icon: <IconUserMinus size={14} />,
                                label: t("sharing.withdraw"),
                                ariaLabel: t("sharing.withdrawAria", { name: share.shareeName }),
                                color: "red",
                                onClick: () => {
                                  setTarget(share);
                                  setWithdrawError(null);
                                  setConfirmOpen(true);
                                },
                              },
                            ]
                          : []
                      }
                    />
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              );
            })
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconShare3 size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={
                    activeFilterCount > 0
                      ? t("sharing.page.noMatches")
                      : view === "withMe"
                        ? t("sharing.page.noWithMe")
                        : t("sharing.page.noByMe")
                  }
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="sharing.page.rowsPerPage"
      />

      <ConfirmActionModal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("sharing.withdrawTitle")}
        message={t("sharing.withdrawBody", {
          name: target?.shareeName ?? "",
          context: target ? shareKindContext(target.resourceType) : undefined,
        })}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("sharing.withdraw")}
        loading={withdrawing}
        onConfirm={() => void confirmWithdraw()}
      />
    </Stack>
  );
}
