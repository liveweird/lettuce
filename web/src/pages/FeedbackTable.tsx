import { type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconMessages, IconPencil } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getUserId,
  listFeedbacks,
  type FeedbackListView,
  type FeedbackPage,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import { StatusBadge, VisibilityBadge } from "../components/FeedbackBadges";
import PersonaChip from "../components/PersonaChip";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import {
  formatRelativeTime,
  formatTimestamp,
  lastModifiedCutoff,
  lastModifiedOptions,
  type LastModifiedWindow,
} from "../utils/datetime";
import { ALL_VISIBILITIES } from "../utils/feedbackVisibility";
import { feedbackPartyName } from "../utils/userDisplay";

// A person cell: mini initials avatar + name (the dashboard cards' language). "You", absent
// (—) and deleted users render as plain text — the avatar is for identifiable other people.
function PersonCell({
  userId,
  name,
  deleted,
  currentUserId,
  t,
}: {
  userId: number | null | undefined;
  name: string | null | undefined;
  deleted: boolean;
  currentUserId: number | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const display = feedbackPartyName(userId, name, deleted, currentUserId, t);
  const isSelf = currentUserId != null && userId === currentUserId;
  const plain = isSelf || name == null || deleted;
  if (plain) {
    return (
      <Text size="sm" c={name == null ? "dimmed" : undefined}>
        {display}
      </Text>
    );
  }
  return <PersonaChip name={display} />;
}

const SORT_FIELDS = [
  "requesterName",
  "subjectName",
  "providerName",
  "visibility",
  "status",
  "lastModified",
] as const;
type SortField = (typeof SORT_FIELDS)[number];

type FeedbackRow = FeedbackPage["items"][number];

const STATUS_VALUES: FeedbackStatus[] = [
  "REQUESTED",
  "DRAFT",
  "SENT",
  "WITHDRAWN",
  "REJECTED",
];

// A filterable + sortable person column (the first column is always the requester).
type PersonColumn = {
  field: "providerName" | "subjectName";
  labelKey: string;
  clearFilterLabelKey: string;
  id: (f: FeedbackRow) => number;
  name: (f: FeedbackRow) => string;
  deleted: (f: FeedbackRow) => boolean;
};

const PROVIDER_COLUMN: PersonColumn = {
  field: "providerName",
  labelKey: "common.field.provider",
  clearFilterLabelKey: "feedback.clearProviderFilter",
  id: (f) => f.providerId,
  name: (f) => f.providerName,
  deleted: (f) => f.providerDeleted,
};

const SUBJECT_COLUMN: PersonColumn = {
  field: "subjectName",
  labelKey: "common.field.subject",
  clearFilterLabelKey: "feedback.clearSubjectFilter",
  id: (f) => f.subjectId,
  name: (f) => f.subjectName,
  deleted: (f) => f.subjectDeleted,
};

// What the per-view action renderers get from the component.
type ActionContext = {
  currentUserId: number | null;
  // `&back=…` suffix carrying the `backTo` prop; empty when unset.
  backParam: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

// Per-view differences: which person columns appear between Requester and Visibility,
// the default sort, and how the row action (View/Edit link) is rendered. The visibility
// filter offers ALL_VISIBILITIES in every view (utils/feedbackVisibility.ts).
const VIEW_CONFIG: Record<
  FeedbackListView,
  {
    personColumns: PersonColumn[];
    defaultSortField: SortField;
    renderAction: (f: FeedbackRow, ctx: ActionContext) => ReactNode;
  }
> = {
  received: {
    personColumns: [PROVIDER_COLUMN],
    defaultSortField: "providerName",
    renderAction: (f, { t, backParam }) => (
      <Button
        component={RouterLink}
        to={
          `/feedback/${f.id}/view?providerName=${encodeURIComponent(f.providerName)}` +
          (f.requesterName ? `&requesterName=${encodeURIComponent(f.requesterName)}` : "") +
          backParam
        }
        color="blue"
        variant="subtle"
        size="xs"
        leftSection={<IconEye size={14} />}
        aria-label={t("feedback.viewFrom", { name: f.providerName })}
      >
        {t("common.action.view")}
      </Button>
    ),
  },
  provided: {
    personColumns: [SUBJECT_COLUMN],
    defaultSortField: "subjectName",
    renderAction: (f, { t, backParam }) =>
      f.status === "REQUESTED" || f.status === "DRAFT" ? (
        <Button
          component={RouterLink}
          to={`/feedback/${f.id}/edit?subjectName=${encodeURIComponent(f.subjectName)}${backParam}`}
          color="blue"
          variant="subtle"
          size="xs"
          leftSection={<IconPencil size={14} />}
          aria-label={t("feedback.editFor", { name: f.subjectName })}
        >
          {t("common.action.edit")}
        </Button>
      ) : (
        <Button
          component={RouterLink}
          to={
            `/feedback/${f.id}/view?as=provider&subjectName=${encodeURIComponent(f.subjectName)}` +
            (f.requesterName ? `&requesterName=${encodeURIComponent(f.requesterName)}` : "") +
            backParam
          }
          color="blue"
          variant="subtle"
          size="xs"
          leftSection={<IconEye size={14} />}
          aria-label={t("feedback.viewFor", { name: f.subjectName })}
        >
          {t("common.action.view")}
        </Button>
      ),
  },
  // The HR/ADMIN auditor view (view=user&userId=X): everything X is a party to, read-only —
  // the auditor is never a party, so the action is always View.
  user: {
    personColumns: [PROVIDER_COLUMN, SUBJECT_COLUMN],
    defaultSortField: "lastModified",
    renderAction: (f, { t, backParam }) => (
      <Button
        component={RouterLink}
        to={
          `/feedback/${f.id}/view?providerName=${encodeURIComponent(f.providerName)}&subjectName=${encodeURIComponent(f.subjectName)}` +
          (f.requesterName ? `&requesterName=${encodeURIComponent(f.requesterName)}` : "") +
          backParam
        }
        color="blue"
        variant="subtle"
        size="xs"
        leftSection={<IconEye size={14} />}
        aria-label={t("feedback.viewFor", { name: f.subjectName })}
      >
        {t("common.action.view")}
      </Button>
    ),
  },
  team: {
    personColumns: [PROVIDER_COLUMN, SUBJECT_COLUMN],
    defaultSortField: "subjectName",
    renderAction: (f, { t, currentUserId, backParam }) =>
      currentUserId === f.providerId && f.status === "DRAFT" ? (
        <Button
          component={RouterLink}
          to={`/feedback/${f.id}/edit?subjectName=${encodeURIComponent(f.subjectName)}&from=team${backParam}`}
          color="blue"
          variant="subtle"
          size="xs"
          leftSection={<IconPencil size={14} />}
          aria-label={t("feedback.editFor", { name: f.subjectName })}
        >
          {t("common.action.edit")}
        </Button>
      ) : (
        <Button
          component={RouterLink}
          to={
            `/feedback/${f.id}/view?as=team&providerName=${encodeURIComponent(f.providerName)}&subjectName=${encodeURIComponent(f.subjectName)}` +
            (f.requesterName ? `&requesterName=${encodeURIComponent(f.requesterName)}` : "") +
            backParam
          }
          color="blue"
          variant="subtle"
          size="xs"
          leftSection={<IconEye size={14} />}
          aria-label={t("feedback.viewFor", { name: f.subjectName })}
        >
          {t("common.action.view")}
        </Button>
      ),
  },
};

export default function FeedbackTable({
  view,
  providerId,
  subjectId,
  userId,
  backTo,
  settingsKey,
}: {
  view: FeedbackListView;
  // Optional exact-id scope to a single counterparty (used by the per-manager screen).
  providerId?: number;
  subjectId?: number;
  // Required with view=user (the HR/ADMIN auditor view): whose records to list.
  userId?: number;
  // When set, the View/Edit links return here instead of the feedback tabs.
  backTo?: string;
  // localStorage namespace for this instance's filters/sort. Defaults per view; screens
  // embedding the table in another context (the per-manager page) pass their own so their
  // settings don't bleed into the main feedback tabs.
  settingsKey?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const config = VIEW_CONFIG[view];
  const visibilityOptions = ALL_VISIBILITIES.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));
  const statusOptions = STATUS_VALUES.map((value) => ({
    value,
    label: t(`common.status.${value}`),
  }));
  const backParam = backTo ? `&back=${encodeURIComponent(backTo)}` : "";
  const columnCount = config.personColumns.length + 6; // requester + preview + vis + status + modified + actions

  const storeKey = settingsKey ?? `feedbacks.${view}`;
  const [requesterFilter, setRequesterFilter] = useStoredState(
    `${storeKey}.filter.requester`, "", isString,
  );
  const [providerFilter, setProviderFilter] = useStoredState(
    `${storeKey}.filter.provider`, "", isString,
  );
  const [subjectFilter, setSubjectFilter] = useStoredState(
    `${storeKey}.filter.subject`, "", isString,
  );
  const [visibilityFilter, setVisibilityFilter] = useStoredState<FeedbackVisibility | null>(
    `${storeKey}.filter.visibility`, null, isOneOfOrNull(ALL_VISIBILITIES),
  );
  const [statusFilter, setStatusFilter] = useStoredState<FeedbackStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  const [lastModifiedFilter, setLastModifiedFilter] = useStoredState<LastModifiedWindow>(
    `${storeKey}.filter.lastModified`, "all", isOneOf(["all", "week", "month"]),
  );
  // Team view only: subjects limited to direct reports (default) or the whole management chain.
  const [reportsScope, setReportsScope] = useStoredState<"direct" | "all">(
    `${storeKey}.filter.reportsScope`, "direct", isOneOf(["direct", "all"]),
  );
  const includeIndirect = view === "team" && reportsScope === "all";
  // Filters without a rendered input stay "" and count 0, so this is per-view correct.
  // `lastModifiedFilter` defaults to the truthy "all" — compare against it, not truthiness.
  const activeFilterCount =
    (requesterFilter.trim() ? 1 : 0) +
    (providerFilter.trim() ? 1 : 0) +
    (subjectFilter.trim() ? 1 : 0) +
    (visibilityFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (lastModifiedFilter !== "all" ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedRequester] = useDebouncedValue(requesterFilter, 300);
  const [debouncedProvider] = useDebouncedValue(providerFilter, 300);
  const [debouncedSubject] = useDebouncedValue(subjectFilter, 300);

  // Binds each person column's filter input to its state; only the columns in
  // `config.personColumns` render an input, so the others never leave "".
  const personFilters: Record<
    PersonColumn["field"],
    { value: string; set: (v: string) => void }
  > = {
    providerName: { value: providerFilter, set: setProviderFilter },
    subjectName: { value: subjectFilter, set: setSubjectFilter },
  };

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      config.defaultSortField,
      [
        debouncedRequester,
        debouncedProvider,
        debouncedSubject,
        visibilityFilter,
        statusFilter,
        lastModifiedFilter,
        includeIndirect,
      ],
      { key: storeKey, sortFields: SORT_FIELDS },
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "feedbacks",
      view,
      providerId ?? null,
      subjectId ?? null,
      page,
      pageSize,
      sortParam,
      debouncedRequester,
      debouncedProvider,
      debouncedSubject,
      visibilityFilter,
      statusFilter,
      lastModifiedFilter,
      includeIndirect,
    ],
    queryFn: () =>
      listFeedbacks({
        view,
        page,
        pageSize,
        sort: sortParam,
        requesterName: debouncedRequester || undefined,
        providerName: debouncedProvider || undefined,
        subjectName: debouncedSubject || undefined,
        providerId,
        subjectId,
        visibility: visibilityFilter ?? undefined,
        status: statusFilter ?? undefined,
        lastModifiedGte: lastModifiedCutoff(lastModifiedFilter),
        includeIndirect: includeIndirect || undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey}>
        <ClearableTextInput
          label={t("common.field.requester")}
          value={requesterFilter}
          onChange={setRequesterFilter}
          clearLabel={t("feedback.clearRequesterFilter")}
        />
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
        <Select
          label={t("common.field.visibility")}
          placeholder={t("common.state.any")}
          data={visibilityOptions}
          value={visibilityFilter}
          onChange={(v) => setVisibilityFilter((v as FeedbackVisibility | null) ?? null)}
          clearable
        />
        <Select
          label={t("common.field.status")}
          placeholder={t("common.state.any")}
          data={statusOptions}
          value={statusFilter}
          onChange={(v) => setStatusFilter((v as FeedbackStatus | null) ?? null)}
          clearable
        />
        <Select
          label={t("common.field.lastModified")}
          data={lastModifiedOptions(t)}
          value={lastModifiedFilter}
          onChange={(v) => setLastModifiedFilter((v as LastModifiedWindow) ?? "all")}
          allowDeselect={false}
        />
        {view === "team" && (
          <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        )}
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("feedback.loadListError")}>
          {error instanceof Error ? error.message : t("feedback.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="requesterName"
                label={t("common.field.requester")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {config.personColumns.map((col) => (
              <Table.Th key={col.field}>
                <SortHeader
                  field={col.field}
                  label={t(col.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            ))}
            <Table.Th>{t("common.field.preview")}</Table.Th>
            <Table.Th>
              <SortHeader
                field="visibility"
                label={t("common.field.visibility")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="lastModified"
                label={t("common.field.lastModified")}
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
            data.items.map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td>
                  <PersonCell
                    userId={f.requesterId}
                    name={f.requesterName}
                    deleted={f.requesterDeleted}
                    currentUserId={currentUserId}
                    t={t}
                  />
                </Table.Td>
                {config.personColumns.map((col) => (
                  <Table.Td key={col.field}>
                    <PersonCell
                      userId={col.id(f)}
                      name={col.name(f)}
                      deleted={col.deleted(f)}
                      currentUserId={currentUserId}
                      t={t}
                    />
                  </Table.Td>
                ))}
                {/* maxWidth so `truncate` engages inside the auto-layout table. Redacted rows
                    (a requester's unfinished feedback) arrive with an empty preview. */}
                <Table.Td style={{ maxWidth: 240 }}>
                  <Text size="sm" c="dimmed" truncate>
                    {f.contentPreview}
                  </Text>
                </Table.Td>
                {/* width:1 + nowrap force these cells to content width so the pills never
                    truncate — the preview column is the one that gives way. */}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <VisibilityBadge visibility={f.visibility} />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <StatusBadge status={f.status} />
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }} title={formatTimestamp(f.lastModified)}>
                  {formatRelativeTime(f.lastModified, i18n.language)}
                </Table.Td>
                <Table.Td>{config.renderAction(f, { currentUserId, backParam, t })}</Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                    icon={<IconMessages size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("feedback.noFeedback")}
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
        rowsPerPageLabelKey="feedback.rowsPerPage"
      />
    </Stack>
  );
}
