import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Pagination,
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
import SortHeader, { type SortDir } from "../components/SortHeader";
import {
  formatTimestamp,
  lastModifiedCutoff,
  lastModifiedOptions,
  type LastModifiedWindow,
} from "../utils/datetime";
import { feedbackPartyName } from "../utils/userDisplay";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

// This component handles the two single-counterparty views; the "team" view has its
// own three-person-column table (FeedbackTeamTable).
type PairFeedbackView = Exclude<FeedbackListView, "team">;

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

// Per-view differences: the second person column (the first is always the requester)
// and which visibilities can actually occur in the result set.
const VIEW_CONFIG: Record<
  PairFeedbackView,
  {
    personField: "subjectName" | "providerName";
    personId: (f: FeedbackRow) => number;
    personName: (f: FeedbackRow) => string;
    personDeleted: (f: FeedbackRow) => boolean;
    visibilityValues: FeedbackVisibility[];
  }
> = {
  received: {
    personField: "providerName",
    personId: (f) => f.providerId,
    personName: (f) => f.providerName,
    personDeleted: (f) => f.providerDeleted,
    // Only the visibilities a subject is allowed to see ever appear in this view.
    visibilityValues: ["PROVIDER_SUBJECT", "PROVIDER_REQUESTER_SUBJECT", "PUBLIC"],
  },
  provided: {
    personField: "subjectName",
    personId: (f) => f.subjectId,
    personName: (f) => f.subjectName,
    personDeleted: (f) => f.subjectDeleted,
    visibilityValues: [
      "PROVIDER_SUBJECT",
      "PROVIDER_REQUESTER",
      "PROVIDER_REQUESTER_SUBJECT",
      "PUBLIC",
    ],
  },
};

export default function FeedbackTable({
  view,
  providerId,
  subjectId,
  backTo,
}: {
  view: PairFeedbackView;
  // Optional exact-id scope to a single counterparty (used by the per-manager screen).
  providerId?: number;
  subjectId?: number;
  // When set, the View/Edit links return here instead of the feedback tabs.
  backTo?: string;
}) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const config = VIEW_CONFIG[view];
  const personLabel = t(`common.field.${view === "received" ? "provider" : "subject"}`);
  const clearPersonFilterLabel = t(
    view === "received" ? "feedback.clearProviderFilter" : "feedback.clearSubjectFilter",
  );
  const visibilityOptions = config.visibilityValues.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));
  const statusOptions = STATUS_VALUES.map((value) => ({
    value,
    label: t(`common.status.${value}`),
  }));
  const backParam = backTo ? `&back=${encodeURIComponent(backTo)}` : "";
  const showActions = view === "provided" || view === "received";
  const columnCount = showActions ? 6 : 5;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>(config.personField);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [requesterFilter, setRequesterFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<FeedbackVisibility | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);
  const [lastModifiedFilter, setLastModifiedFilter] = useState<LastModifiedWindow>("all");
  // `lastModifiedFilter` defaults to the truthy "all" — compare against it, not truthiness.
  const activeFilterCount =
    (requesterFilter.trim() ? 1 : 0) +
    (personFilter.trim() ? 1 : 0) +
    (visibilityFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (lastModifiedFilter !== "all" ? 1 : 0);

  const [debouncedRequester] = useDebouncedValue(requesterFilter, 300);
  const [debouncedPerson] = useDebouncedValue(personFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [
    debouncedRequester,
    debouncedPerson,
    visibilityFilter,
    statusFilter,
    lastModifiedFilter,
    sortField,
    sortDir,
  ]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

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
      debouncedPerson,
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
        [config.personField]: debouncedPerson || undefined,
        providerId,
        subjectId,
        visibility: visibilityFilter ?? undefined,
        status: statusFilter ?? undefined,
        lastModifiedGte: lastModifiedCutoff(lastModifiedFilter),
      }),
    placeholderData: keepPreviousData,
  });

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
        <TextInput
          label={personLabel}
          placeholder={t("common.filter.contains")}
          value={personFilter}
          onChange={(e) => setPersonFilter(e.currentTarget.value)}
          rightSection={
            personFilter ? (
              <CloseButton
                size="sm"
                aria-label={clearPersonFilterLabel}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPersonFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
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
            <Table.Th>
              <SortHeader
                field={config.personField}
                label={personLabel}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
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
            {showActions && <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />}
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
                <Table.Td>
                  {feedbackPartyName(
                    config.personId(f),
                    config.personName(f),
                    config.personDeleted(f),
                    currentUserId,
                    t,
                  )}
                </Table.Td>
                <Table.Td>{t(`common.visibility.${f.visibility}`)}</Table.Td>
                <Table.Td>{t(`common.status.${f.status}`)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {formatTimestamp(f.lastModified)}
                </Table.Td>
                {showActions && (
                  <Table.Td>
                    {view === "received" ? (
                      <Button
                        component={RouterLink}
                        to={
                          `/feedback/${f.id}/view?providerName=${encodeURIComponent(f.providerName)}` +
                          (f.requesterName
                            ? `&requesterName=${encodeURIComponent(f.requesterName)}`
                            : "") +
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
                    ) : f.status === "REQUESTED" || f.status === "DRAFT" ? (
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
                          (f.requesterName
                            ? `&requesterName=${encodeURIComponent(f.requesterName)}`
                            : "") +
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
                    )}
                  </Table.Td>
                )}
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

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {t("common.table.total", { count: total })}
        </Text>
        <Group gap="sm" align="center">
          <Select
            size="xs"
            aria-label={t("feedback.rowsPerPage")}
            data={PAGE_SIZE_OPTIONS.map((n) => ({
              value: String(n),
              label: t("common.table.perPage", { count: n }),
            }))}
            value={String(pageSize)}
            onChange={(v) => {
              if (!v) return;
              setPageSize(Number(v));
              setPage(1);
            }}
            allowDeselect={false}
            w={110}
          />
          <Pagination
            value={page}
            onChange={setPage}
            total={totalPages}
            siblings={1}
            withEdges
          />
        </Group>
      </Group>
    </Stack>
  );
}
