import { Link as RouterLink, Navigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconPlus, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { deleteAlert, isAdmin, listAlerts } from "../api/client";
import { formatTimestamp } from "../utils/datetime";

const SORT_FIELDS = ["id", "title", "startsAt", "endsAt"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "alerts";

type AlertRow = { id: number; name: string };

function Bound({ value }: { value: number | null | undefined }) {
  return value == null ? (
    <Text size="sm" c="dimmed">
      —
    </Text>
  ) : (
    <Text size="sm">{formatTimestamp(value)}</Text>
  );
}

export default function Alerts() {
  const { t } = useTranslation();
  const [titleFilter, setTitleFilter] = useStoredState(`${SETTINGS_KEY}.filter.title`, "", isString);
  const [activeFilter, setActiveFilter] = useStoredState<string | null>(
    `${SETTINGS_KEY}.filter.isActive`,
    null,
    isOneOfOrNull(["true", "false"]),
  );
  const activeFilterCount = (titleFilter.trim() ? 1 : 0) + (activeFilter ? 1 : 0);

  const queryClient = useQueryClient();

  const [debouncedTitle] = useDebouncedValue(titleFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("id", [debouncedTitle, activeFilter], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["alerts", page, pageSize, sortParam, debouncedTitle, activeFilter],
    queryFn: () =>
      listAlerts({
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        isActive: activeFilter === null ? undefined : activeFilter === "true",
      }),
    placeholderData: keepPreviousData,
    enabled: isAdmin(),
  });

  const deleteConfirm = useDeleteConfirm<AlertRow>({
    mutationFn: (row) => deleteAlert(row.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["visibleAlerts"] });
    },
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  const total = data?.total ?? 0;
  const columnCount = 5;

  return (
    <Stack gap="md">
      <Title order={2}>{t("alerts.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ClearableTextInput
          label={t("alerts.fieldTitle")}
          value={titleFilter}
          onChange={setTitleFilter}
          clearLabel={t("alerts.clearTitleFilter")}
        />
        <Select
          label={t("alerts.fieldActive")}
          value={activeFilter}
          onChange={setActiveFilter}
          clearable
          data={[
            { value: "true", label: t("common.state.yes") },
            { value: "false", label: t("common.state.no") },
          ]}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("alerts.loadFailed")}>
          {error instanceof Error ? error.message : t("alerts.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="title"
                label={t("alerts.fieldTitle")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>{t("alerts.fieldActive")}</Table.Th>
            <Table.Th>
              <SortHeader
                field="startsAt"
                label={t("alerts.fieldStartsAt")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="endsAt"
                label={t("alerts.fieldEndsAt")}
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
            data.items.map((alert) => (
              <Table.Tr key={alert.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {alert.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    color={alert.isActive ? "green" : "gray"}
                    style={{ minWidth: "max-content" }}
                  >
                    {alert.isActive ? t("common.state.yes") : t("common.state.no")}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Bound value={alert.startsAt} />
                </Table.Td>
                <Table.Td>
                  <Bound value={alert.endsAt} />
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      component={RouterLink}
                      to={`/alerts/${alert.id}/edit`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPencil size={14} />}
                      aria-label={t("alerts.editName", { name: alert.title })}
                    >
                      {t("common.action.edit")}
                    </Button>
                    <Button
                      color="red"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      onClick={() =>
                        deleteConfirm.requestDelete({ id: alert.id, name: alert.title })
                      }
                      aria-label={t("alerts.deleteName", { name: alert.title })}
                    >
                      {t("common.action.delete")}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconSpeakerphone size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("alerts.empty")}
                />
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
        rowsPerPageLabelKey="alerts.rowsPerPage"
      />

      <Group justify="flex-end">
        <Button component={RouterLink} to="/alerts/new" leftSection={<IconPlus size={16} />}>
          {t("alerts.create")}
        </Button>
      </Group>

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("alerts.deleteTitle")}
        errorTitle={t("alerts.deleteFailed")}
        unknownError={t("alerts.unknownError")}
        body={(target) => (
          <>
            {t("alerts.deleteConfirmPrefix")}
            <strong>{target.name}</strong>
            {t("alerts.deleteConfirmSuffix")}
          </>
        )}
      />
    </Stack>
  );
}
