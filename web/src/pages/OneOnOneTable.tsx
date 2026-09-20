import type { ParseKeys, TFunction } from "i18next";
import { type ReactNode } from "react";
import { Alert, Badge, Stack, Text } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import { IconCalendarEvent, IconEye, IconPencil } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { listOneOnOnes, type OneOnOneListView, type OneOnOnePage } from "../api/oneonones";
import ClearableTextInput from "../components/ClearableTextInput";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import TableLoadingRow from "../components/TableLoadingRow";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { formatIsoDate } from "../utils/datetime";
import { loadErrorMessage } from "../utils/saveError";
import { oneOnOneEditLink, oneOnOneViewLink } from "../utils/oneOnOneLinks";

const SORT_FIELDS = ["meetingDate", "managerName", "subordinateName", "lastModified"] as const;
type SortField = (typeof SORT_FIELDS)[number];

type OneOnOneRow = OneOnOnePage["items"][number];

// A filterable + sortable person column.
type PersonColumn = {
  field: "managerName" | "subordinateName";
  labelKey: ParseKeys;
  clearFilterLabelKey: ParseKeys;
  id: (m: OneOnOneRow) => number;
  name: (m: OneOnOneRow) => string;
  deleted: (m: OneOnOneRow) => boolean;
};

const MANAGER_COLUMN: PersonColumn = {
  field: "managerName",
  labelKey: "oneOnOne.manager",
  clearFilterLabelKey: "oneOnOne.clearManagerFilter",
  id: (m) => m.managerId,
  name: (m) => m.managerName,
  deleted: (m) => m.managerDeleted,
};

const SUBORDINATE_COLUMN: PersonColumn = {
  field: "subordinateName",
  labelKey: "oneOnOne.subordinate",
  clearFilterLabelKey: "oneOnOne.clearSubordinateFilter",
  id: (m) => m.subordinateId,
  name: (m) => m.subordinateName,
  deleted: (m) => m.subordinateDeleted,
};

type ActionContext = {
  backParam: string | undefined;
  currentUserId: number | null;
  t: TFunction;
};

// Per-view differences: which person columns appear and how the row action is rendered —
// the manager edits their meetings, everyone else views.
const VIEW_CONFIG: Record<
  OneOnOneListView,
  {
    personColumns: PersonColumn[];
    renderAction: (m: OneOnOneRow, ctx: ActionContext) => ReactNode;
  }
> = {
  own: {
    personColumns: [MANAGER_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.managerName })} backParam={backParam} />
    ),
  },
  managed: {
    personColumns: [SUBORDINATE_COLUMN],
    // Only the pair's LATEST meeting is editable (older ones are immutable records —
    // the server answers 409), so old rows get the View affordance instead.
    renderAction: (m, { t, backParam }) =>
      m.isLatest !== false ? (
        <RowActions
          primary={{
            icon: <IconPencil size={16} />,
            label: t("common.action.edit"),
            ariaLabel: t("oneOnOne.editWith", { name: m.subordinateName }),
            to: oneOnOneEditLink(m.id, "managed", backParam),
          }}
        />
      ) : (
        <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.subordinateName })} backParam={backParam} from="managed" />
      ),
  },
  team: {
    personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.subordinateName })} backParam={backParam} from="team" />
    ),
  },
  // The HR auditor view (view=user&userId=X): everything X is a party to, read-only —
  // the auditor is never a party, so the action is always View.
  user: {
    personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN],
    renderAction: (m, { t, backParam }) => (
      <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.subordinateName })} backParam={backParam} />
    ),
  },
  // The per-person drill-down: both role directions in one table, so the row action depends on
  // who ran that meeting — the caller edits their own (latest-only), views everything else.
  with: {
    personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN],
    renderAction: (m, { t, backParam, currentUserId }) =>
      currentUserId != null && m.managerId === currentUserId && m.isLatest !== false ? (
        <RowActions
          primary={{
            icon: <IconPencil size={16} />,
            label: t("common.action.edit"),
            ariaLabel: t("oneOnOne.editWith", { name: m.subordinateName }),
            to: oneOnOneEditLink(m.id, "with", backParam),
          }}
        />
      ) : (
        <ViewButton m={m} label={t("common.action.view")} aria={t("oneOnOne.viewWith", { name: m.managerName })} backParam={backParam} from="with" />
      ),
  },
};

function ViewButton({
  m,
  label,
  aria,
  backParam,
  from,
}: {
  m: OneOnOneRow;
  label: string;
  aria: string;
  backParam: string | undefined;
  from?: string;
}) {
  return (
    <RowActions
      primary={{
        icon: <IconEye size={16} />,
        label: label,
        ariaLabel: aria,
        to: oneOnOneViewLink(m.id, from ?? "own", backParam),
      }}
    />
  );
}

export default function OneOnOneTable({
  view,
  counterpartId,
  userId,
  settingsKey,
  backTo,
  tourId,
}: {
  view: OneOnOneListView;
  /** Required with view="with": the other party's user id. */
  counterpartId?: number;
  /** Required with view="user" (the HR auditor view): whose meetings to list. */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
  /** Forwarded to the Filters toggle as `data-tour` (a tutorial anchor). Only the hub's own
   *  tab passes it — OneOnOneTable is also embedded by UserOneOnOnes. */
  tourId?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const config = VIEW_CONFIG[view];
  const backParam = backTo || undefined;
  // The drill-down's filters would be useless (both parties are fixed), so "with" has none.
  const showFilters = view !== "with";
  const columnCount = config.personColumns.length + 6; // date + 3 counts + modified + actions

  const storeKey = settingsKey ?? `oneOnOnes.${view}`;
  const [managerFilter, setManagerFilter] = useStoredState(
    `${storeKey}.filter.manager`, "", isString,
  );
  const [subordinateFilter, setSubordinateFilter] = useStoredState(
    `${storeKey}.filter.subordinate`, "", isString,
  );
  // Team view only: subordinates limited to direct reports (default) or the whole chain.
  const [reportsScope, setReportsScope] = useStoredState<"direct" | "all">(
    `${storeKey}.filter.reportsScope`, "direct", isOneOf(["direct", "all"]),
  );
  const includeIndirect = view === "team" && reportsScope === "all";
  const activeFilterCount =
    (managerFilter.trim() ? 1 : 0) +
    (subordinateFilter.trim() ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedManager] = useDebouncedValue(managerFilter, 300);
  const [debouncedSubordinate] = useDebouncedValue(subordinateFilter, 300);

  const personFilters: Record<
    PersonColumn["field"],
    { value: string; set: (v: string) => void }
  > = {
    managerName: { value: managerFilter, set: setManagerFilter },
    subordinateName: { value: subordinateFilter, set: setSubordinateFilter },
  };

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "meetingDate",
      [debouncedManager, debouncedSubordinate, includeIndirect],
      { key: storeKey, sortFields: SORT_FIELDS },
      "desc", // newest meetings first
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "oneOnOnes",
      view,
      counterpartId,
      userId,
      page,
      pageSize,
      sortParam,
      debouncedManager,
      debouncedSubordinate,
      includeIndirect,
    ],
    queryFn: () =>
      listOneOnOnes({
        view,
        page,
        pageSize,
        sort: sortParam,
        managerName: (showFilters && debouncedManager) || undefined,
        subordinateName: (showFilters && debouncedSubordinate) || undefined,
        includeIndirect: includeIndirect || undefined,
        counterpartId,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      {showFilters && (
        <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey} tourId={tourId}>
          {config.personColumns.map((col) => {
            const filter = personFilters[col.field];
            return (
              <ClearableTextInput
                key={col.field}
                label={t(col.labelKey)}
                value={filter.value}
                onChange={filter.set}
                clearLabel={t(col.clearFilterLabelKey)}
              />
            );
          })}
          {view === "team" && (
            <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
          )}
        </FilterPanel>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("oneOnOne.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="meetingDate"
                label={t("oneOnOne.meetingDate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            {config.personColumns.map((col) => (
              <ResponsiveTable.Th sortable key={col.field}><SortHeader
                  field={col.field}
                  label={t(col.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th>{t("oneOnOne.points")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("oneOnOne.decisions")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("oneOnOne.actionItems")}</ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="lastModified"
                label={t("common.field.lastModified")}
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
            data.items.map((m) => (
              <ResponsiveTable.Tr key={m.id}>
                <ResponsiveTable.Td label={t("oneOnOne.meetingDate")}>
                  {formatIsoDate(m.meetingDate, i18n.language)}
                </ResponsiveTable.Td>
                {config.personColumns.map((col) => (
                  <ResponsiveTable.Td key={col.field} label={t(col.labelKey)}>
                    <PersonCell
                      userId={col.id(m)}
                      name={col.name(m)}
                      deleted={col.deleted(m)}
                      currentUserId={currentUserId}
                    />
                  </ResponsiveTable.Td>
                ))}
                <ResponsiveTable.Td label={t("oneOnOne.points")}>{m.pointCount}</ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.decisions")}>{m.decisionCount}</ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.actionItems")}>
                  {m.actionItemCount === 0 ? (
                    <Text size="sm" c="dimmed">
                      0
                    </Text>
                  ) : (
                    <Badge
                      variant="light"
                      color={m.openActionItemCount > 0 ? "yellow" : "teal"}
                      style={{ minWidth: "max-content" }}
                    >
                      {t("oneOnOne.openOfTotal", {
                        open: m.openActionItemCount,
                        total: m.actionItemCount,
                      })}
                    </Badge>
                  )}
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.lastModified")}>
                  <DateCell value={m.lastModified} mode="relative" />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>{config.renderAction(m, { backParam, currentUserId, t })}</ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconCalendarEvent size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("oneOnOne.noMeetings")}
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
        rowsPerPageLabelKey="oneOnOne.rowsPerPage"
      />
    </Stack>
  );
}
