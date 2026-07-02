import { useState } from "react";
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
  | "providerName"
  | "subjectName"
  | "visibility"
  | "status"
  | "lastModified";

type FeedbackRow = FeedbackPage["items"][number];

const VISIBILITY_VALUES: FeedbackVisibility[] = [
  "PROVIDER_SUBJECT",
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

const STATUS_VALUES: FeedbackStatus[] = [
  "REQUESTED",
  "DRAFT",
  "SENT",
  "WITHDRAWN",
  "REJECTED",
];

export default function FeedbackTeamTable() {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const visibilityOptions = VISIBILITY_VALUES.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));
  const statusOptions = STATUS_VALUES.map((value) => ({
    value,
    label: t(`common.status.${value}`),
  }));
  const [requesterFilter, setRequesterFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState<FeedbackVisibility | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);
  const [lastModifiedFilter, setLastModifiedFilter] = useState<LastModifiedWindow>("all");
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

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("subjectName", [
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
        <TextInput
          label={t("common.field.provider")}
          placeholder={t("common.filter.contains")}
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.currentTarget.value)}
          rightSection={
            providerFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("feedback.clearProviderFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setProviderFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <TextInput
          label={t("common.field.subject")}
          placeholder={t("common.filter.contains")}
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.currentTarget.value)}
          rightSection={
            subjectFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("feedback.clearSubjectFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setSubjectFilter("")}
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
                field="providerName"
                label={t("common.field.provider")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="subjectName"
                label={t("common.field.subject")}
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
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((f: FeedbackRow) => (
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
                  {feedbackPartyName(f.providerId, f.providerName, f.providerDeleted, currentUserId, t)}
                </Table.Td>
                <Table.Td>
                  {feedbackPartyName(f.subjectId, f.subjectName, f.subjectDeleted, currentUserId, t)}
                </Table.Td>
                <Table.Td>{t(`common.visibility.${f.visibility}`)}</Table.Td>
                <Table.Td>{t(`common.status.${f.status}`)}</Table.Td>
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
                      aria-label={t("feedback.editFor", { name: f.subjectName })}
                    >
                      {t("common.action.edit")}
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
                      aria-label={t("feedback.viewFor", { name: f.subjectName })}
                    >
                      {t("common.action.view")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={7}>
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
