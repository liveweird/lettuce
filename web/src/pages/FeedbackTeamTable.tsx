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
  getUserId,
  listFeedbacks,
  type FeedbackPage,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import SortHeader, { type SortDir } from "../components/SortHeader";
import {
  formatTimestamp,
  lastModifiedCutoff,
  LAST_MODIFIED_OPTIONS,
  type LastModifiedWindow,
} from "../utils/datetime";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

type SortField =
  | "requesterName"
  | "providerName"
  | "subjectName"
  | "visibility"
  | "status"
  | "lastModified";

type FeedbackRow = FeedbackPage["items"][number];

const VISIBILITY_LABEL: Record<FeedbackVisibility, string> = {
  PROVIDER_SUBJECT: "Provider + subject",
  PROVIDER_REQUESTER: "Provider + requester",
  PROVIDER_REQUESTER_SUBJECT: "Provider + requester + subject",
  PUBLIC: "Public",
};

const VISIBILITY_OPTIONS = (Object.keys(VISIBILITY_LABEL) as FeedbackVisibility[]).map((value) => ({
  value,
  label: VISIBILITY_LABEL[value],
}));

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  REQUESTED: "Requested",
  DRAFT: "Draft",
  SENT: "Sent",
  WITHDRAWN: "Withdrawn",
  REJECTED: "Rejected",
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));

function userName(name: string | null | undefined, deleted: boolean): string {
  if (name == null) return "—";
  return deleted ? `${name} (deleted)` : name;
}

export default function FeedbackTeamTable() {
  const currentUserId = getUserId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>("subjectName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [requesterFilter, setRequesterFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<FeedbackVisibility | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);
  const [lastModifiedFilter, setLastModifiedFilter] = useState<LastModifiedWindow>("all");

  const [debouncedRequester] = useDebouncedValue(requesterFilter, 300);
  const [debouncedProvider] = useDebouncedValue(providerFilter, 300);
  const [debouncedSubject] = useDebouncedValue(subjectFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [
    debouncedRequester,
    debouncedProvider,
    debouncedSubject,
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
      "team",
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
        view: "team",
        page,
        pageSize,
        sort: sortParam,
        requesterName: debouncedRequester || undefined,
        providerName: debouncedProvider || undefined,
        subjectName: debouncedSubject || undefined,
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
          label="Provider"
          placeholder="contains…"
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.currentTarget.value)}
          rightSection={
            providerFilter ? (
              <CloseButton
                size="sm"
                aria-label="Clear provider filter"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setProviderFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <TextInput
          label="Subject"
          placeholder="contains…"
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.currentTarget.value)}
          rightSection={
            subjectFilter ? (
              <CloseButton
                size="sm"
                aria-label="Clear subject filter"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSubjectFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <Select
          label="Visibility"
          placeholder="Any"
          data={VISIBILITY_OPTIONS}
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
        <Select
          label="Last modified"
          data={LAST_MODIFIED_OPTIONS}
          value={lastModifiedFilter}
          onChange={(v) => setLastModifiedFilter((v as LastModifiedWindow) ?? "all")}
          allowDeselect={false}
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
                field="providerName"
                label="Provider"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="subjectName"
                label="Subject"
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
            <Table.Th>
              <SortHeader
                field="lastModified"
                label="Last modified"
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label="Actions" style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={8}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((f: FeedbackRow) => (
              <Table.Tr key={f.id}>
                <Table.Td c={f.requesterName == null ? "dimmed" : undefined}>
                  {userName(f.requesterName, f.requesterDeleted)}
                </Table.Td>
                <Table.Td>{userName(f.providerName, f.providerDeleted)}</Table.Td>
                <Table.Td>{userName(f.subjectName, f.subjectDeleted)}</Table.Td>
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
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  {formatTimestamp(f.lastModified)}
                </Table.Td>
                <Table.Td>
                  {currentUserId === f.providerId && f.status === "DRAFT" ? (
                    <Button
                      component={RouterLink}
                      to={`/feedback/${f.id}/edit?subjectName=${encodeURIComponent(f.subjectName)}&from=team`}
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
                        `/feedback/${f.id}/view?as=team&providerName=${encodeURIComponent(f.providerName)}&subjectName=${encodeURIComponent(f.subjectName)}` +
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
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={8}>
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
          <Pagination value={page} onChange={setPage} total={totalPages} siblings={1} withEdges />
        </Group>
      </Group>
    </Stack>
  );
}
