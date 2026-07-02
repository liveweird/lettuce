import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconEye, IconPencil } from "@tabler/icons-react";
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
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import {
  formatTimestamp,
  lastModifiedCutoff,
  lastModifiedOptions,
  type LastModifiedWindow,
} from "../utils/datetime";
import { feedbackPartyName } from "../utils/userDisplay";

type SortField =
  | "requesterName"
  | "subjectName"
  | "providerName"
  | "visibility"
  | "status"
  | "lastModified";

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
// the default sort, which visibilities can actually occur in the result set, and how
// the row action (View/Edit link) is rendered.
const VIEW_CONFIG: Record<
  FeedbackListView,
  {
    personColumns: PersonColumn[];
    defaultSortField: SortField;
    visibilityValues: FeedbackVisibility[];
    renderAction: (f: FeedbackRow, ctx: ActionContext) => ReactNode;
  }
> = {
  received: {
    personColumns: [PROVIDER_COLUMN],
    defaultSortField: "providerName",
    // Only the visibilities a subject is allowed to see ever appear in this view.
    visibilityValues: ["PROVIDER_SUBJECT", "PROVIDER_REQUESTER_SUBJECT", "PUBLIC"],
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
    visibilityValues: [
      "PROVIDER_SUBJECT",
      "PROVIDER_REQUESTER",
      "PROVIDER_REQUESTER_SUBJECT",
      "PUBLIC",
    ],
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
  team: {
    personColumns: [PROVIDER_COLUMN, SUBJECT_COLUMN],
    defaultSortField: "subjectName",
    visibilityValues: [
      "PROVIDER_SUBJECT",
      "PROVIDER_REQUESTER",
      "PROVIDER_REQUESTER_SUBJECT",
      "PUBLIC",
    ],
    renderAction: (f, { t, currentUserId }) =>
      currentUserId === f.providerId && f.status === "DRAFT" ? (
        <Button
          component={RouterLink}
          to={`/feedback/${f.id}/edit?subjectName=${encodeURIComponent(f.subjectName)}&from=team`}
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
            (f.requesterName ? `&requesterName=${encodeURIComponent(f.requesterName)}` : "")
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
  backTo,
}: {
  view: FeedbackListView;
  // Optional exact-id scope to a single counterparty (used by the per-manager screen).
  providerId?: number;
  subjectId?: number;
  // When set, the View/Edit links return here instead of the feedback tabs.
  backTo?: string;
}) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const config = VIEW_CONFIG[view];
  const visibilityOptions = config.visibilityValues.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));
  const statusOptions = STATUS_VALUES.map((value) => ({
    value,
    label: t(`common.status.${value}`),
  }));
  const backParam = backTo ? `&back=${encodeURIComponent(backTo)}` : "";
  const columnCount = config.personColumns.length + 5;

  const [requesterFilter, setRequesterFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<FeedbackVisibility | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);
  const [lastModifiedFilter, setLastModifiedFilter] = useState<LastModifiedWindow>("all");
  // Filters without a rendered input stay "" and count 0, so this is per-view correct.
  // `lastModifiedFilter` defaults to the truthy "all" — compare against it, not truthiness.
  const activeFilterCount =
    (requesterFilter.trim() ? 1 : 0) +
    (providerFilter.trim() ? 1 : 0) +
    (subjectFilter.trim() ? 1 : 0) +
    (visibilityFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (lastModifiedFilter !== "all" ? 1 : 0);

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
    usePagedSort<SortField>(config.defaultSortField, [
      debouncedRequester,
      debouncedProvider,
      debouncedSubject,
      visibilityFilter,
      statusFilter,
      lastModifiedFilter,
    ]);

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
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount}>
        <TextInput
          label={t("common.field.requester")}
          placeholder={t("common.filter.contains")}
          value={requesterFilter}
          onChange={(e) => setRequesterFilter(e.currentTarget.value)}
          rightSection={
            requesterFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("feedback.clearRequesterFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRequesterFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        {config.personColumns.map((col) => {
          const filter = personFilters[col.field];
          return (
            <TextInput
              key={col.field}
              label={t(col.labelKey)}
              placeholder={t("common.filter.contains")}
              value={filter.value}
              onChange={(e) => filter.set(e.currentTarget.value)}
              rightSection={
                filter.value ? (
                  <CloseButton
                    size="sm"
                    aria-label={t(col.clearFilterLabelKey)}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => filter.set("")}
                  />
                ) : null
              }
              rightSectionPointerEvents="auto"
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
      </FilterPanel>

      {isError && (
        <Alert color="red" title={t("feedback.loadListError")}>
          {error instanceof Error ? error.message : t("feedback.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
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
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td c={f.requesterName == null ? "dimmed" : undefined}>
                  {feedbackPartyName(
                    f.requesterId,
                    f.requesterName,
                    f.requesterDeleted,
                    currentUserId,
                    t,
                  )}
                </Table.Td>
                {config.personColumns.map((col) => (
                  <Table.Td key={col.field}>
                    {feedbackPartyName(col.id(f), col.name(f), col.deleted(f), currentUserId, t)}
                  </Table.Td>
                ))}
                <Table.Td>{t(`common.visibility.${f.visibility}`)}</Table.Td>
                <Table.Td>{t(`common.status.${f.status}`)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {formatTimestamp(f.lastModified)}
                </Table.Td>
                <Table.Td>{config.renderAction(f, { currentUserId, backParam, t })}</Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Text c="dimmed" ta="center">
                  {t("feedback.noFeedback")}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
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
