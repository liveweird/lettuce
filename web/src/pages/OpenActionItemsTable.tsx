import { useState } from "react";
import { Alert, Group, Pill, Select, Stack, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconChecklist, IconExternalLink, IconHistory } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { listOpenActionItems, type ActionItemOwner, type OpenActionItemPage } from "../api/oneonones";
import { getUserId } from "../api/session";
import ActionItemHistoryModal from "../components/ActionItemHistoryModal";
import ClearableTextInput from "../components/ClearableTextInput";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import ResponsiveTable from "../components/ResponsiveTable";
import RowActions from "../components/RowActions";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { useManagedReports } from "../hooks/useManagedReports";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, useStoredState, writeStoredJson } from "../hooks/useStoredState";
import { formatIsoDate, todayIsoDate } from "../utils/datetime";
import { oneOnOneEditLink } from "../utils/oneOnOneLinks";
import { loadErrorMessage } from "../utils/saveError";

const SORT_FIELDS = ["dueDate", "meetingDate", "subordinateName"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const OWNER_FILTERS = ["ALL", "MANAGER", "SUBORDINATE"] as const;
type OwnerFilter = (typeof OWNER_FILTERS)[number];

const STORE_KEY = "oneOnOnes.openActionItems";

type OpenItemRow = OpenActionItemPage["items"][number];

// The hub tab's `?subordinateId=` (the Dashboard badge link): digits only, else ignored.
function parseSubordinateId(raw: string | null): number | undefined {
  return raw != null && /^\d+$/.test(raw) ? Number(raw) : undefined;
}

/**
 * The manager's cross-report list of unresolved 1:1 action items (v4.19.0): every pair's LATEST
 * meeting, items of either owner. Read-only — a row links to its meeting (resolving happens in
 * the editor) and to the item's history.
 */
export default function OpenActionItemsTable() {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const here = useCurrentPath();
  const [searchParams, setSearchParams] = useSearchParams();
  const subordinateId = parseSubordinateId(searchParams.get("subordinateId"));

  // Arriving with a `subordinateId` (the Dashboard badge link) must show that person's FULL open
  // set, so the list matches the badge's count: the stored owner/name filters are reset on mount,
  // BEFORE the stored-state hooks below read them, so the very first request is unfiltered.
  useState(() => {
    if (subordinateId != null) {
      writeStoredJson(`${STORE_KEY}.filter.owner`, "ALL");
      writeStoredJson(`${STORE_KEY}.filter.subordinate`, "");
    }
    return null;
  });
  const [ownerFilter, setOwnerFilter] = useStoredState<OwnerFilter>(
    `${STORE_KEY}.filter.owner`, "ALL", isOneOf(OWNER_FILTERS),
  );
  const [nameFilter, setNameFilter] = useStoredState(`${STORE_KEY}.filter.subordinate`, "", isString);
  const activeFilterCount = (ownerFilter !== "ALL" ? 1 : 0) + (nameFilter.trim() ? 1 : 0);
  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  // Soonest due first; undated items trail in both directions (server-side).
  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "dueDate",
      [debouncedName, ownerFilter, subordinateId],
      { key: STORE_KEY, sortFields: SORT_FIELDS },
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "oneOnOnes",
      "openActionItems",
      page,
      pageSize,
      sortParam,
      ownerFilter,
      subordinateId,
      debouncedName,
    ],
    queryFn: () =>
      listOpenActionItems({
        page,
        pageSize,
        sort: sortParam,
        owner: ownerFilter === "ALL" ? undefined : (ownerFilter satisfies ActionItemOwner),
        subordinateId,
        subordinateName: debouncedName || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  // The chip names the person from fetched data only — never from the URL: the rows carry the
  // name; when the page is empty, the caller's own reports pool answers.
  const rowName = data?.items[0]?.subordinateName;
  const needPool = subordinateId != null && data != null && rowName == null;
  const { reports } = useManagedReports(needPool);
  const chipName = rowName ?? reports.find((r) => r.userId === subordinateId)?.name;

  function clearSubordinate() {
    setSearchParams(
      (params) => {
        params.delete("subordinateId");
        return params;
      },
      { replace: true },
    );
  }

  const [historyItem, setHistoryItem] = useState<{ id: number; subordinateName: string } | null>(null);

  const today = todayIsoDate();
  const total = data?.total ?? 0;
  const columnCount = 7;
  const filtered = activeFilterCount > 0 || subordinateId != null;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={STORE_KEY}>
        <Select
          label={t("oneOnOne.owner")}
          data={[
            { value: "ALL", label: t("common.state.all") },
            { value: "MANAGER", label: t("common.state.you") },
            { value: "SUBORDINATE", label: t("oneOnOne.subordinate") },
          ]}
          value={ownerFilter}
          onChange={(v) => setOwnerFilter((v as OwnerFilter | null) ?? "ALL")}
          allowDeselect={false}
          w={180}
        />
        <ClearableTextInput
          label={t("oneOnOne.subordinate")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("oneOnOne.clearSubordinateFilter")}
        />
      </FilterPanel>

      {subordinateId != null && (
        <Group gap="xs">
          <Pill
            size="md"
            withRemoveButton
            onRemove={clearSubordinate}
            // Pill hides its remove button from assistive tech by default (it lives inside a
            // PillsInput there); this chip stands alone, so the button is a real, named control.
            removeButtonProps={{
              "aria-hidden": false,
              tabIndex: 0,
              "aria-label": t("oneOnOne.openItems.clearPerson"),
            }}
          >
            {chipName != null
              ? t("oneOnOne.openItems.onlyWith", { name: chipName })
              : t("oneOnOne.openItems.onlyWithFallback")}
          </Pill>
        </Group>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("oneOnOne.openItems.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable>
              <SortHeader
                field="subordinateName"
                label={t("oneOnOne.subordinate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("oneOnOne.openItems.item")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("oneOnOne.owner")}</ResponsiveTable.Th>
            <ResponsiveTable.Th sortable>
              <SortHeader
                field="dueDate"
                label={t("oneOnOne.dueDate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("oneOnOne.openItems.openSince")}</ResponsiveTable.Th>
            <ResponsiveTable.Th sortable>
              <SortHeader
                field="meetingDate"
                label={t("oneOnOne.meetingDate")}
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
            data.items.map((m: OpenItemRow) => (
              <ResponsiveTable.Tr key={m.id}>
                <ResponsiveTable.Td label={t("oneOnOne.subordinate")}>
                  <PersonCell
                    userId={m.subordinateId}
                    name={m.subordinateName}
                    currentUserId={currentUserId}
                  />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.openItems.item")} primary>
                  <Text size="sm" lineClamp={2} title={m.content} style={{ whiteSpace: "pre-wrap" }}>
                    {m.content}
                  </Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.owner")}>
                  {/* The caller is always the meeting's manager here, so a manager-owned item
                      is "You" (ViewOneOnOne's ownerDisplay rule); the other owner is the report. */}
                  <Text size="sm">
                    {m.owner === "MANAGER" ? t("common.state.you") : m.subordinateName}
                  </Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.dueDate")}>
                  <DueCell dueDate={m.dueDate} today={today} />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.openItems.openSince")}>
                  <DateCell value={m.firstAppearedOn ?? m.meetingDate} mode="date" />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("oneOnOne.meetingDate")}>
                  <DateCell value={m.meetingDate} mode="date" />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>
                  <RowActions
                    name={m.subordinateName}
                    primary={{
                      icon: <IconExternalLink size={16} />,
                      label: t("oneOnOne.openItems.openMeeting"),
                      ariaLabel: t("oneOnOne.openItems.openMeetingAria", { name: m.subordinateName }),
                      // The row's meeting is the pair's latest, hence editable; Save/Close return
                      // to this tab (filters included) through the back override.
                      to: oneOnOneEditLink(m.meetingId, "managed", here),
                    }}
                    items={[
                      {
                        icon: <IconHistory size={16} />,
                        label: t("oneOnOne.history"),
                        ariaLabel: t("oneOnOne.openItems.historyOf", { name: m.subordinateName }),
                        onClick: () => setHistoryItem({ id: m.id, subordinateName: m.subordinateName }),
                      },
                    ]}
                  />
                </ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconChecklist size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={filtered ? t("oneOnOne.openItems.noItemsFiltered") : t("oneOnOne.openItems.noItems")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        pending={isLoading && !data}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="oneOnOne.rowsPerPage"
      />

      <ActionItemHistoryModal
        itemId={historyItem?.id ?? null}
        onClose={() => setHistoryItem(null)}
        managerName={t("common.state.you")}
        subordinateName={historyItem?.subordinateName ?? ""}
      />
    </Stack>
  );
}

// The due date; a past one is set in the error ink AND spelled out "Overdue" (never colour alone).
// ISO dates compare chronologically as strings; `today` is the viewer's LOCAL calendar day.
function DueCell({ dueDate, today }: { dueDate: string | null; today: string }) {
  const { t, i18n } = useTranslation();
  if (dueDate == null) return <DateCell value={null} />;
  if (dueDate >= today) return <DateCell value={dueDate} mode="date" />;
  return (
    <Stack gap={0}>
      <Text size="sm" component="span" c="var(--lettuce-ink-error)">
        {formatIsoDate(dueDate, i18n.language)}
      </Text>
      <Text size="xs" fw={600} component="span" c="var(--lettuce-ink-error)">
        {t("oneOnOne.openItems.overdue")}
      </Text>
    </Stack>
  );
}
