import { useEffect, useState } from "react";
import {
  Alert,
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
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react";
import {
  listFeedbacks,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

type SortField = "requesterName" | "providerName" | "visibility" | "status";
type SortDir = "asc" | "desc";

const VISIBILITY_LABEL: Record<FeedbackVisibility, string> = {
  PROVIDER_SUBJECT: "Provider + subject",
  PROVIDER_REQUESTER: "Provider + requester",
  PROVIDER_REQUESTER_SUBJECT: "Provider + requester + subject",
  PUBLIC: "Public",
};

// Only the visibilities a subject is allowed to see ever appear in this view.
const VISIBILITY_FILTER_OPTIONS = (
  ["PROVIDER_SUBJECT", "PROVIDER_REQUESTER_SUBJECT", "PUBLIC"] as const
).map((value) => ({ value, label: VISIBILITY_LABEL[value] }));

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

function SortHeader({
  field,
  label,
  activeField,
  activeDir,
  onToggle,
}: {
  field: SortField;
  label: string;
  activeField: SortField;
  activeDir: SortDir;
  onToggle: (field: SortField) => void;
}) {
  const isActive = activeField === field;
  const Icon = !isActive ? IconArrowsSort : activeDir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <UnstyledButton
      onClick={() => onToggle(field)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600 }}
    >
      <span>{label}</span>
      <Icon size={14} stroke={1.5} opacity={isActive ? 1 : 0.4} />
    </UnstyledButton>
  );
}

function userName(name: string | null | undefined, deleted: boolean): string {
  if (name == null) return "—";
  return deleted ? `${name} (deleted)` : name;
}

export default function FeedbackReceived() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>("providerName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [requesterFilter, setRequesterFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<FeedbackVisibility | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);

  const [debouncedRequester] = useDebouncedValue(requesterFilter, 300);
  const [debouncedProvider] = useDebouncedValue(providerFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedRequester, debouncedProvider, visibilityFilter, statusFilter, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "feedbacks",
      "received",
      page,
      pageSize,
      sortParam,
      debouncedRequester,
      debouncedProvider,
      visibilityFilter,
      statusFilter,
    ],
    queryFn: () =>
      listFeedbacks({
        view: "received",
        page,
        pageSize,
        sort: sortParam,
        requesterName: debouncedRequester || undefined,
        providerName: debouncedProvider || undefined,
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
        <Select
          label="Visibility"
          placeholder="Any"
          data={VISIBILITY_FILTER_OPTIONS}
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
                field="providerName"
                label="Provider"
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
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={5}>
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
                <Table.Td>{userName(f.providerName, f.providerDeleted)}</Table.Td>
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
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={5}>
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
