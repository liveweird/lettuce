import { useState } from "react";
import { Alert, Stack } from "@mantine/core";
import { IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { useMassShareState } from "../hooks/useMassShareState";
import { loadErrorMessage } from "../utils/saveError";
import EmptyState from "./EmptyState";
import ListToolbar from "./ListToolbar";
import MassShareDialog from "./MassShareDialog";
import MassShareFacets from "./MassShareFacets";
import MassShareSelectionBar from "./MassShareSelectionBar";
import MassShareTable from "./MassShareTable";
import MetaStrip from "./MetaStrip";
import PageHeader from "./PageHeader";
import PaginationBar from "./PaginationBar";
import type { MassShareColumn, MassSharePageProps } from "./massShareTypes";

export type { MassShareColumn, MassShareExtraFilters } from "./massShareTypes";

const NO_COLUMNS: readonly MassShareColumn[] = [];

/**
 * The mass-share picker's shell (v4.10.0 as the reviews page, kind-generic since v4.11.0): the
 * people in the caller's reporting line, narrowed client-side by facets, selected (incl. "select
 * all matching") and shared in one batch through `MassShareDialog`. People the caller cannot share
 * stay listed, greyed out with the reason. A kind's page supplies the candidate rows, its extra
 * facets/columns and the wording; identity never comes from the URL — names are the fetched rows'.
 * The selection is plain state (never persisted), so mount this keyed by whatever scopes the rows.
 * The state lives in `useMassShareState`; this component only lays the pieces out (checkup #38 M6).
 */
export default function MassSharePage({
  resourceType,
  kind,
  settingsKey,
  backTo,
  backLabel,
  title,
  description,
  youLabel,
  personLabel,
  rows: allRows,
  ready: dataReady,
  isLoading,
  isError,
  error,
  reasonText,
  extraMeta = [],
  extraFilters,
  extraColumns = NO_COLUMNS,
  onSettled,
}: MassSharePageProps) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const [dialogOpen, setDialogOpen] = useState(false);
  const s = useMassShareState({
    settingsKey,
    youLabel,
    rows: allRows,
    ready: dataReady,
    extraFilters,
    onSettled,
  });
  const noPeople = dataReady && allRows.length === 0;

  return (
    <Stack gap="md">
      <PageHeader
        back={{
          to: backTo,
          label: t("feedback.backToLabel", { label: backLabel }),
        }}
        title={title}
        description={description}
      />

      <MetaStrip
        items={[
          ...extraMeta,
          { key: "selected", label: t("sharing.massShare.meta.selected"), value: s.selectedCount },
          { key: "shareable", label: t("sharing.massShare.meta.shareable"), value: s.shareableMatching },
          {
            key: "people",
            label: t("sharing.massShare.meta.people"),
            value: s.filtersActive
              ? t("sharing.massShare.peopleOf", { count: s.filteredRows.length, total: allRows.length })
              : allRows.length,
          },
        ]}
      />

      {isError && (
        <Alert color="red" variant="light" title={t("sharing.massShare.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {noPeople ? (
        <EmptyState
          icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("sharing.massShare.noReports")}
        />
      ) : (
        <>
          <ListToolbar
            search={{
              label: t("sharing.massShare.searchLabel"),
              value: s.query,
              onChange: s.setQuery,
              clearLabel: t("sharing.massShare.searchClear"),
            }}
            filters={{
              activeCount: s.activeFilterCount,
              storageKey: settingsKey,
              onClear: s.clearFilters,
              children: <MassShareFacets facets={s.facets} extra={extraFilters?.children} />,
            }}
          />

          <MassShareSelectionBar
            kind={kind}
            shareableMatching={s.shareableMatching}
            selectedCount={s.selectedCount}
            hiddenSelected={s.hiddenSelected}
            onSelectAllMatching={s.selectAllMatching}
            onClearSelection={s.clearSelection}
            onShare={() => setDialogOpen(true)}
          />

          <MassShareTable
            rows={s.pageRows}
            isLoading={isLoading}
            isError={isError}
            personLabel={personLabel}
            reasonText={reasonText}
            extraColumns={extraColumns}
            currentUserId={currentUserId}
            sortField={s.paging.sortField}
            sortDir={s.paging.sortDir}
            onToggleSort={s.paging.toggleSort}
            selected={s.selected}
            onToggleRow={s.toggleRow}
            pageSelection={s.pageSelection}
            onTogglePage={s.togglePage}
          />

          <PaginationBar
            total={s.filteredRows.length}
            page={s.paging.page}
            pageSize={s.paging.pageSize}
            onPageChange={s.paging.setPage}
            onPageSizeChange={s.paging.setPageSize}
            rowsPerPageLabelKey="sharing.massShare.rowsPerPage"
          />
        </>
      )}

      <MassShareDialog
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourceType={resourceType}
        kind={kind}
        rows={allRows}
        selected={s.selected}
        onSettled={s.handleSettled}
      />
    </Stack>
  );
}
