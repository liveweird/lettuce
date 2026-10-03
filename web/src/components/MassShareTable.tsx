import { Checkbox } from "@mantine/core";
import { IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { MassShareRow, MassShareSortField } from "../utils/massShare";
import EmptyState from "./EmptyState";
import MassShareTableRow from "./MassShareTableRow";
import type { MassShareColumn, MassSharePageProps } from "./massShareTypes";
import ResponsiveTable from "./ResponsiveTable";
import SortHeader, { type SortDir } from "./SortHeader";
import TableLoadingRow from "./TableLoadingRow";

/** The header cell of a sortable column. */
function SortableTh({
  field,
  label,
  sortField,
  sortDir,
  onToggle,
}: {
  field: MassShareSortField;
  label: string;
  sortField: MassShareSortField;
  sortDir: SortDir;
  onToggle: (field: MassShareSortField) => void;
}) {
  return (
    <ResponsiveTable.Th sortable>
      <SortHeader field={field} label={label} activeField={sortField} activeDir={sortDir} onToggle={onToggle} />
    </ResponsiveTable.Th>
  );
}

function MassShareTableHead({
  personLabel,
  extraColumns,
  sortField,
  sortDir,
  onToggleSort,
  pageSelection,
  onTogglePage,
}: {
  personLabel: string;
  extraColumns: readonly MassShareColumn[];
  sortField: MassShareSortField;
  sortDir: SortDir;
  onToggleSort: (field: MassShareSortField) => void;
  pageSelection: { shareableCount: number; allSelected: boolean; someSelected: boolean };
  onTogglePage: () => void;
}) {
  const { t } = useTranslation();
  const sort = { sortField, sortDir, onToggle: onToggleSort };
  return (
    <ResponsiveTable.Thead>
      <ResponsiveTable.Tr>
        <ResponsiveTable.Th>
          <Checkbox
            aria-label={t("sharing.massShare.selectAllOnPage")}
            checked={pageSelection.allSelected}
            indeterminate={!pageSelection.allSelected && pageSelection.someSelected}
            disabled={pageSelection.shareableCount === 0}
            onChange={onTogglePage}
          />
        </ResponsiveTable.Th>
        <SortableTh field="name" label={personLabel} {...sort} />
        <SortableTh field="team" label={t("performanceReview.dashboard.team")} {...sort} />
        <ResponsiveTable.Th>{t("users.profile.path")}</ResponsiveTable.Th>
        <ResponsiveTable.Th>{t("performanceReview.dashboard.specialty")}</ResponsiveTable.Th>
        <ResponsiveTable.Th>{t("users.profile.seniority")}</ResponsiveTable.Th>
        <ResponsiveTable.Th>{t("sharing.massShare.col.managers")}</ResponsiveTable.Th>
        {extraColumns.map((column) =>
          column.sortField ? (
            <SortableTh key={column.key} field={column.sortField} label={column.header(t)} {...sort} />
          ) : (
            <ResponsiveTable.Th key={column.key}>{column.header(t)}</ResponsiveTable.Th>
          ),
        )}
      </ResponsiveTable.Tr>
    </ResponsiveTable.Thead>
  );
}

/** The candidates table: the select-all-on-page + six person columns + the kind's own, sortable headers, the body states. */
export default function MassShareTable({
  rows,
  isLoading,
  isError,
  personLabel,
  reasonText,
  extraColumns,
  currentUserId,
  sortField,
  sortDir,
  onToggleSort,
  selected,
  onToggleRow,
  pageSelection,
  onTogglePage,
}: {
  /** The current page's rows. */
  rows: MassShareRow[];
  isLoading: boolean;
  isError: boolean;
  personLabel: string;
  reasonText: MassSharePageProps["reasonText"];
  extraColumns: readonly MassShareColumn[];
  currentUserId: number | null;
  sortField: MassShareSortField;
  sortDir: SortDir;
  onToggleSort: (field: MassShareSortField) => void;
  selected: ReadonlySet<number>;
  onToggleRow: (userId: number, checked: boolean) => void;
  pageSelection: { shareableCount: number; allSelected: boolean; someSelected: boolean };
  onTogglePage: () => void;
}) {
  const { t } = useTranslation();
  // The checkbox column, the six person columns, then the kind's own.
  const columnCount = 7 + extraColumns.length;
  return (
    <ResponsiveTable mode="matrix">
      <MassShareTableHead
        personLabel={personLabel}
        extraColumns={extraColumns}
        sortField={sortField}
        sortDir={sortDir}
        onToggleSort={onToggleSort}
        pageSelection={pageSelection}
        onTogglePage={onTogglePage}
      />
      <ResponsiveTable.Tbody>
        {isLoading ? (
          <TableLoadingRow colSpan={columnCount} />
        ) : rows.length > 0 ? (
          rows.map((row) => (
            <MassShareTableRow
              key={row.person.userId}
              row={row}
              checked={selected.has(row.person.userId)}
              onToggle={onToggleRow}
              currentUserId={currentUserId}
              personLabel={personLabel}
              reasonText={reasonText}
              extraColumns={extraColumns}
            />
          ))
        ) : !isError ? (
          <ResponsiveTable.Tr>
            <ResponsiveTable.Td colSpan={columnCount}>
              <EmptyState
                icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                label={t("sharing.massShare.empty")}
              />
            </ResponsiveTable.Td>
          </ResponsiveTable.Tr>
        ) : null}
      </ResponsiveTable.Tbody>
    </ResponsiveTable>
  );
}
