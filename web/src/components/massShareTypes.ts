import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { ShareableResourceType } from "../api/shares";
import type { MassShareFilters, MassShareKind, MassShareRow, MassShareSortField } from "../utils/massShare";
import type { MetaStripItem } from "./MetaStrip";

/** A kind-specific column after the six person columns (the reviews' Status and Overall). */
export type MassShareColumn = {
  key: string;
  header: (t: TFunction) => string;
  /** Set to make the header sortable by that field. */
  sortField?: MassShareSortField;
  cell: (row: MassShareRow, t: TFunction) => ReactNode;
};

/** A kind's own facets: their stored state lives with the kind's page, the shell only composes them. */
export type MassShareExtraFilters = {
  /** Merged over the shell's people facets. Memoized by the caller — it is a filter dependency. */
  values: Partial<MassShareFilters>;
  /** How many of the extra facets are active (counts toward the toolbar's badge). */
  activeCount: number;
  /** The stored picks, for the page-reset dependency list (stable references, constant length). */
  deps: readonly unknown[];
  onClear: () => void;
  /** The facet inputs, rendered after the people facets. */
  children: ReactNode;
};

export type MassSharePageProps = {
  resourceType: ShareableResourceType;
  kind: MassShareKind;
  /** The view-settings namespace (`lettuce.viewSettings.<settingsKey>.*`) — filters, sort, page size. */
  settingsKey: string;
  backTo: string;
  /** The destination's name, fed to the shared "Back to …" template. */
  backLabel: string;
  title: string;
  description: string;
  /** The label the caller reads as in the direct-manager column and facet. */
  youLabel: string;
  /** The person column's header (and its compact-row label). */
  personLabel: string;
  /** Every candidate row, built by the kind's page; `[]` until `ready`. */
  rows: MassShareRow[];
  /** The candidates read has answered (an empty answer is "nobody to share", not "still loading"). */
  ready: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** Why a row cannot be selected, as text (the checkbox's accessible name); null for a shareable row. */
  reasonText: (row: MassShareRow, t: TFunction) => string | null;
  /** Cells shown before the shell's own Selected/Shareable/People counters. */
  extraMeta?: MetaStripItem[];
  extraFilters?: MassShareExtraFilters;
  extraColumns?: readonly MassShareColumn[];
  /** After a run settled: refetch the candidates. The selection is already updated by the shell. */
  onSettled: () => void;
};
