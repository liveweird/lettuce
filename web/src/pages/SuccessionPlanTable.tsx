import { Alert, Select, Stack } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconTrash, IconUserShield } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteSuccessionPlan,
  listSuccessionPlans,
  type SuccessionListView,
  type SuccessionPlanListItem,
} from "../api/successionPlans";
import ClearableTextInput from "../components/ClearableTextInput";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import {
  BenchBadge,
  CriticalityBadge,
  PlanStatusBadge,
  RetentionRiskBadge,
} from "../components/SuccessionBadges";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { getUserId } from "../api/session";
import { successionPlanViewLink } from "../utils/successionLinks";
import { invalidateSuccession } from "../utils/successionQueries";
import { loadErrorMessage } from "../utils/saveError";

const REPORTS_SCOPES = ["direct", "all"] as const;
const STATUS_FILTERS = ["OPEN", "CLOSED"] as const;
type SortField = "userName" | "managerName" | "status" | "lastReviewedAt";

/**
 * The succession-plan list — one component serving the caller's own plans (`own`, with
 * Review + owner-Delete row actions since v2.44.0; Close plan lives on the Review screen),
 * the chain-above reading view
 * (`team`, read-only, optional direct/chain Reports scope), and the HR auditor drill-down
 * (`user`, read-only). The owner column shows only where rows can belong to different
 * owners (team/user).
 */
export default function SuccessionPlanTable({
  view,
  userId,
  settingsKey,
  backTo,
  withReportsScope,
}: {
  view: SuccessionListView;
  /** Required with view="user" (the HR auditor view): whose plans to list. */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
  /** Show the "Reports" direct/all filter and derive includeIndirect from it (team only). */
  withReportsScope?: boolean;
}) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  // Who owns the plan only varies on the cross-owner views.
  const ownerVisible = view !== "own";
  const sortFields: readonly SortField[] = ownerVisible
    ? ["userName", "managerName", "status", "lastReviewedAt"]
    : ["userName", "status", "lastReviewedAt"];
  // + criticality, risk, bench (unsortable), + the actions column.
  const columnCount = sortFields.length + 4;

  const storeKey = settingsKey ?? `succession.${view}`;
  const [personFilter, setPersonFilter] = useStoredState(`${storeKey}.filter.person`, "", isString);
  const [statusFilter, setStatusFilter] = useStoredState<(typeof STATUS_FILTERS)[number] | null>(
    `${storeKey}.filter.status`,
    null,
    isOneOfOrNull(STATUS_FILTERS),
  );
  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${storeKey}.filter.reportsScope`,
    "direct",
    isOneOf(REPORTS_SCOPES),
  );
  const includeIndirect = withReportsScope === true && reportsScope === "all";
  const activeFilterCount =
    (personFilter.trim() ? 1 : 0) +
    (statusFilter != null ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedPerson] = useDebouncedValue(personFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "lastReviewedAt",
      [debouncedPerson, statusFilter, includeIndirect],
      { key: storeKey, sortFields },
      "desc", // recent planning activity first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "succession",
      view,
      userId,
      page,
      pageSize,
      sortParam,
      debouncedPerson,
      statusFilter,
      includeIndirect,
    ],
    queryFn: () =>
      listSuccessionPlans({
        view,
        page,
        pageSize,
        sort: sortParam,
        userName: debouncedPerson || undefined,
        status: (statusFilter) ?? undefined,
        includeIndirect: includeIndirect || undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const queryClient = useQueryClient();
  const deleteConfirm = useDeleteConfirm<SuccessionPlanListItem>({
    mutationFn: (row) => deleteSuccessionPlan(row.id),
    onSuccess: () => invalidateSuccession(queryClient),
    successMessage: t("succession.toast.deleted"),
  });

  const statusOptions = STATUS_FILTERS.map((value) => ({
    value,
    label: t(`succession.status.${value}`),
  }));

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("succession.person")}
          value={personFilter}
          onChange={setPersonFilter}
          clearLabel={t("succession.clearPersonFilter")}
        />
        <Select
          label={t("common.field.status")}
          data={statusOptions}
          value={statusFilter}
          onChange={(value) => setStatusFilter((value as (typeof STATUS_FILTERS)[number]) ?? null)}
          clearable
          w={160}
        />
        {withReportsScope && (
          <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        )}
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("succession.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="userName"
                label={t("succession.person")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            {ownerVisible && (
              <ResponsiveTable.Th sortable><SortHeader
                  field="managerName"
                  label={t("succession.owner")}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            )}
            <ResponsiveTable.Th>{t("succession.criticalityLabel")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("succession.riskLabel")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("succession.bench")}</ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="lastReviewedAt"
                label={t("succession.lastReviewed")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((plan) => {
              // The server enforces the same rule: only the owner writes.
              const isOwner = currentUserId != null && plan.managerId === currentUserId;
              const backParam = backTo || undefined;
              return (
                <ResponsiveTable.Tr key={plan.id}>
                  <ResponsiveTable.Td label={t("succession.person")}>
                    <PersonCell
                      userId={plan.userId}
                      name={plan.userName}
                      deleted={plan.userDeleted}
                      currentUserId={currentUserId}
                    />
                  </ResponsiveTable.Td>
                  {ownerVisible && (
                    <ResponsiveTable.Td label={t("succession.owner")}>
                      <PersonCell
                        userId={plan.managerId}
                        name={plan.managerName}
                        currentUserId={currentUserId}
                      />
                    </ResponsiveTable.Td>
                  )}
                  <ResponsiveTable.Td label={t("succession.criticalityLabel")}>
                    <CriticalityBadge value={plan.roleCriticality} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("succession.riskLabel")}>
                    <RetentionRiskBadge value={plan.retentionRisk} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("succession.bench")}>
                    <BenchBadge count={plan.benchCount} target={plan.targetBenchDepth} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("common.field.status")}>
                    <PlanStatusBadge value={plan.status} />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("succession.lastReviewed")}>
                    <DateCell value={plan.lastReviewedAt} mode="relative" />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td actions>
                    <RowActions
                      name={plan.userName}
                      primary={{
                        icon: <IconEye size={16} />,
                        label: t("succession.review"),
                        ariaLabel: t("succession.reviewAria", { name: plan.userName }),
                        to: successionPlanViewLink(plan.id, backParam),
                      }}
                      items={
                        isOwner
                          ? [
                              {
                                icon: <IconTrash size={14} />,
                                label: t("common.action.delete"),
                                ariaLabel: t("succession.deleteAria", { name: plan.userName }),
                                color: "red",
                                onClick: () => deleteConfirm.requestDelete(plan),
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
                  icon={<IconUserShield size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("succession.noPlans")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="succession.rowsPerPage"
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("succession.deleteConfirmTitle")}
        errorTitle={t("succession.deleteErrorTitle")}
        body={(target) => t("succession.deleteConfirmMessage", { name: target.userName })}
      />
    </Stack>
  );
}
