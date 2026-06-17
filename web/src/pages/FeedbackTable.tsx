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
import {
  listFeedbacks,
  type FeedbackListView,
  type FeedbackPage,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import SortHeader, { type SortDir } from "../components/SortHeader";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

// This component handles the two single-counterparty views; the "team" view has its
// own three-person-column table (FeedbackTeamTable).
type PairFeedbackView = Exclude<FeedbackListView, "team">;

type SortField = "requesterName" | "subjectName" | "providerName" | "visibility" | "status";

type FeedbackRow = FeedbackPage["items"][number];

const VISIBILITY_LABEL: Record<FeedbackVisibility, string> = {
  PROVIDER_SUBJECT: "Provider + subject",
  PROVIDER_REQUESTER: "Provider + requester",
  PROVIDER_REQUESTER_SUBJECT: "Provider + requester + subject",
  PUBLIC: "Public",
};

function visibilityOptions(values: readonly FeedbackVisibility[]) {
  return values.map((value) => ({ value, label: VISIBILITY_LABEL[value] }));
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  REQUESTED: "Requested",
  DRAFT: "Draft",
  SENT: "Sent",
  WITHDRAWN: "Withdrawn",
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

// Per-view differences: the second person column (the first is always the requester)
// and which visibilities can actually occur in the result set.
const VIEW_CONFIG: Record<
  PairFeedbackView,
  {
    personLabel: string;
    personField: "subjectName" | "providerName";
    personName: (f: FeedbackRow) => string;
    personDeleted: (f: FeedbackRow) => boolean;
    visibilityOptions: { value: FeedbackVisibility; label: string }[];
  }
> = {
  received: {
    personLabel: "Provider",
    personField: "providerName",
    personName: (f) => f.providerName,
    personDeleted: (f) => f.providerDeleted,
    // Only the visibilities a subject is allowed to see ever appear in this view.
    visibilityOptions: visibilityOptions([
      "PROVIDER_SUBJECT",
      "PROVIDER_REQUESTER_SUBJECT",
      "PUBLIC",
    ]),
  },
  provided: {
    personLabel: "Subject",
    personField: "subjectName",
    personName: (f) => f.subjectName,
    personDeleted: (f) => f.subjectDeleted,
    visibilityOptions: visibilityOptions([
      "PROVIDER_SUBJECT",
      "PROVIDER_REQUESTER",
      "PROVIDER_REQUESTER_SUBJECT",
      "PUBLIC",
    ]),
  },
};

function userName(name: string | null | undefined, deleted: boolean): string {
  if (name == null) return "—";
  return deleted ? `${name} (deleted)` : name;
}

export default function FeedbackTable({ view }: { view: PairFeedbackView }) {
  const config = VIEW_CONFIG[view];
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

  const [debouncedRequester] = useDebouncedValue(requesterFilter, 300);
  const [debouncedPerson] = useDebouncedValue(personFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedRequester, debouncedPerson, visibilityFilter, statusFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "feedbacks",
      view,
      page,
      pageSize,
      sortParam,
      debouncedRequester,
      debouncedPerson,
      visibilityFilter,
      statusFilter,
    ],
    queryFn: () =>
      listFeedbacks({
        view,
        page,
        pageSize,
        sort: sortParam,
        requesterName: debouncedRequester || undefined,
        [config.personField]: debouncedPerson || undefined,
        visibility: visibilityFilter ?? undefined,
        status: statusFilter ?? undefined,
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
      <Group align="flex-end" gap="sm">
        <TextInput
          label="Requester"
          placeholder="contains…"
          value={requesterFilter}
          onChange={(e) => setRequesterFilter(e.currentTarget.value)}
          rightSection={
            requesterFilter ? (
              <CloseButton
                size="sm"
                aria-label="Clear requester filter"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setRequesterFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <TextInput
          label={config.personLabel}
          placeholder="contains…"
          value={personFilter}
          onChange={(e) => setPersonFilter(e.currentTarget.value)}
          rightSection={
            personFilter ? (
              <CloseButton
                size="sm"
                aria-label={`Clear ${config.personLabel.toLowerCase()} filter`}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPersonFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <Select
          label="Visibility"
          placeholder="Any"
          data={config.visibilityOptions}
          value={visibilityFilter}
          onChange={(v) => setVisibilityFilter((v as FeedbackVisibility | null) ?? null)}
          clearable
        />
        <Select
          label="Status"
          placeholder="Any"
          data={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(v) => setStatusFilter((v as FeedbackStatus | null) ?? null)}
          clearable
        />
      </Group>

      {isError && (
        <Alert color="red" title="Failed to load feedbacks">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="requesterName"
                label="Requester"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field={config.personField}
                label={config.personLabel}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="visibility"
                label="Visibility"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="status"
                label="Status"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>Content</Table.Th>
            {showActions && <Table.Th aria-label="Actions" style={{ width: 1 }} />}
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
                  {userName(f.requesterName, f.requesterDeleted)}
                </Table.Td>
                <Table.Td>{userName(config.personName(f), config.personDeleted(f))}</Table.Td>
                <Table.Td>{VISIBILITY_LABEL[f.visibility]}</Table.Td>
                <Table.Td>{STATUS_LABEL[f.status]}</Table.Td>
                <Table.Td
                  style={{
                    maxWidth: 280,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {f.contentPreview}
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
                            : "")
                        }
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={`View feedback from ${f.providerName}`}
                      >
                        View
                      </Button>
                    ) : f.status === "REQUESTED" || f.status === "DRAFT" ? (
                      <Button
                        component={RouterLink}
                        to={`/feedback/${f.id}/edit?subjectName=${encodeURIComponent(f.subjectName)}`}
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconPencil size={14} />}
                        aria-label={`Edit feedback for ${f.subjectName}`}
                      >
                        Edit
                      </Button>
                    ) : (
                      <Button
                        component={RouterLink}
                        to={
                          `/feedback/${f.id}/view?as=provider&subjectName=${encodeURIComponent(f.subjectName)}` +
                          (f.requesterName
                            ? `&requesterName=${encodeURIComponent(f.requesterName)}`
                            : "")
                        }
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={`View feedback for ${f.subjectName}`}
                      >
                        View
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
                  No feedback
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {total} total
        </Text>
        <Group gap="sm" align="center">
          <Select
            size="xs"
            aria-label="Rows per page"
            data={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} / page` }))}
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
