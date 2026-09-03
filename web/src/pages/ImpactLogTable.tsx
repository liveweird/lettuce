import { Link as RouterLink } from "react-router-dom";
import { Alert, Button, Group, Stack, Table, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconNotebook, IconPencil, IconTrash } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteImpactEntry,
  listImpactEntries,
  type ImpactEntryListItem,
  type ImpactLogListView,
} from "../api/impactLog";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { getUserId } from "../api/session";
import { formatDate, formatIsoDate, formatTimestamp } from "../utils/datetime";
import { impactEntryEditLink, impactEntryViewLink } from "../utils/impactLogLinks";
import { invalidateImpactLog } from "../utils/impactLogQueries";
import { loadErrorMessage } from "../utils/saveError";

const REPORTS_SCOPES = ["direct", "all"] as const;
type SortField = "periodStart" | "title" | "lastModified" | "userName";

/**
 * The impact log list — one component serving the caller's own journal (`own`, with
 * edit/delete row actions), the manager-side reading view (`managed`, read-only, optional
 * direct/chain Reports scope), and the HR auditor drill-down (`user`, read-only). The owner
 * column shows only where rows can belong to different people (managed/user).
 */
export default function ImpactLogTable({
  view,
  userId,
  settingsKey,
  backTo,
  withReportsScope,
  includeIndirect: includeIndirectProp,
}: {
  view: ImpactLogListView;
  /**
   * Required with view="user" (the HR auditor view): whose journal to list. On
   * view="managed" it instead PINS the list to one report (the person-card drill-down,
   * v2.38.0 — the PerformanceReviewTable subordinateId idiom).
   */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
  /** Show the "Reports" direct/all filter and derive includeIndirect from it (managed only). */
  withReportsScope?: boolean;
  /** Fixed chain scope (the pinned drill-down — mutually exclusive with withReportsScope). */
  includeIndirect?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  // Whose entry it is only varies on the cross-person views; `user` pins one person, but the
  // audit drill-down keeps the column so the row names its author explicitly. A managed pin
  // hides it instead — the "drill-down pins that party" idiom (the page heading names them).
  const ownerVisible = view === "managed" ? userId == null : view !== "own";
  const sortFields: readonly SortField[] = ownerVisible
    ? ["periodStart", "userName", "title", "lastModified"]
    : ["periodStart", "title", "lastModified"];
  const columnCount = sortFields.length + 1; // + the actions column (the preview left in V66)

  const storeKey = settingsKey ?? `impactLog.${view}`;
  const [ownerFilter, setOwnerFilter] = useStoredState(`${storeKey}.filter.owner`, "", isString);
  const [titleFilter, setTitleFilter] = useStoredState(`${storeKey}.filter.title`, "", isString);
  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${storeKey}.filter.reportsScope`,
    "direct",
    isOneOf(REPORTS_SCOPES),
  );
  const includeIndirect =
    includeIndirectProp ?? (withReportsScope === true && reportsScope === "all");
  const activeFilterCount =
    (ownerVisible && ownerFilter.trim() ? 1 : 0) +
    (titleFilter.trim() ? 1 : 0) +
    // The fixed prop is page scope, not a user-chosen filter — only the toggle counts.
    (withReportsScope === true && reportsScope === "all" ? 1 : 0);

  const [debouncedOwner] = useDebouncedValue(ownerFilter, 300);
  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "periodStart",
      [debouncedOwner, debouncedTitle, includeIndirect],
      { key: storeKey, sortFields },
      "desc", // most recent periods first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "impactLog",
      view,
      userId,
      page,
      pageSize,
      sortParam,
      debouncedOwner,
      debouncedTitle,
      includeIndirect,
    ],
    queryFn: () =>
      listImpactEntries({
        view,
        page,
        pageSize,
        sort: sortParam,
        userName: (ownerVisible && debouncedOwner) || undefined,
        title: debouncedTitle || undefined,
        includeIndirect: includeIndirect || undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const queryClient = useQueryClient();
  const deleteConfirm = useDeleteConfirm<ImpactEntryListItem>({
    mutationFn: (row) => deleteImpactEntry(row.id),
    onSuccess: () => invalidateImpactLog(queryClient),
    successMessage: t("impactLog.toast.deleted"),
  });

  const period = (e: ImpactEntryListItem) =>
    `${formatIsoDate(e.periodStart, i18n.language)} – ${formatIsoDate(e.periodEnd, i18n.language)}`;
  // The row's spoken identity: the title, or the period on a pre-V66 title-less row.
  const identity = (e: ImpactEntryListItem) => e.title || period(e);

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("impactLog.title")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("impactLog.clearTitleFilter")}
        />
        {ownerVisible && (
          <ClearableTextInput
            label={t("impactLog.owner")}
            value={ownerFilter}
            onChange={setOwnerFilter}
            clearLabel={t("impactLog.clearOwnerFilter")}
          />
        )}
        {withReportsScope && (
          <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        )}
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("impactLog.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="periodStart"
                label={t("impactLog.period")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {ownerVisible && (
              <Table.Th>
                <SortHeader
                  field="userName"
                  label={t("impactLog.owner")}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            )}
            <Table.Th>
              <SortHeader
                field="title"
                label={t("impactLog.title")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="lastModified"
                label={t("impactLog.lastModified")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((e) => {
              // The server enforces the same rule: only the owner writes.
              const isOwner = currentUserId != null && e.userId === currentUserId;
              const backParam = backTo || undefined;
              return (
                <Table.Tr key={e.id}>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <Text size="sm">{period(e)}</Text>
                  </Table.Td>
                  {ownerVisible && (
                    <Table.Td>
                      <PersonCell
                        userId={e.userId}
                        name={e.userName}
                        deleted={e.userDeleted}
                        currentUserId={currentUserId}
                      />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm" lineClamp={2} style={{ wordBreak: "break-word" }}>
                      {e.title}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(e.lastModified)}>
                    {formatDate(e.lastModified, i18n.language)}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap" justify="flex-end">
                      <Button
                        component={RouterLink}
                        to={impactEntryViewLink(e.id, backParam)}
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={t("impactLog.viewAria", { title: identity(e) })}
                      >
                        {t("common.action.view")}
                      </Button>
                      {isOwner && (
                        <>
                          <Button
                            component={RouterLink}
                            to={impactEntryEditLink(e.id, backParam)}
                            variant="subtle"
                            size="xs"
                            leftSection={<IconPencil size={14} />}
                            aria-label={t("impactLog.editAria", { title: identity(e) })}
                          >
                            {t("common.action.edit")}
                          </Button>
                          <Button
                            variant="subtle"
                            size="xs"
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            aria-label={t("impactLog.deleteAria", { title: identity(e) })}
                            onClick={() => deleteConfirm.requestDelete(e)}
                          >
                            {t("common.action.delete")}
                          </Button>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconNotebook size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("impactLog.noEntries")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="impactLog.rowsPerPage"
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("impactLog.deleteConfirmTitle")}
        errorTitle={t("impactLog.deleteErrorTitle")}
        body={(target) => t("impactLog.deleteConfirmMessage", { title: identity(target) })}
      />
    </Stack>
  );
}
