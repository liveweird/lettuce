import { Link as RouterLink, Navigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Select,
  Stack,
  Table,
  Text
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPencil, IconPlus, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ClearableTextInput from "../components/ClearableTextInput";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import TableLoadingRow from "../components/TableLoadingRow";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { isAdmin } from "../api/session";
import { deleteAlert, listAlerts } from "../api/alerts";
import { loadErrorMessage } from "../utils/saveError";
import PageHeader from "../components/PageHeader";

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
    <DateCell value={value} mode="absolute" />
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
      sortFields: SORT_FIELDS
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["alerts", page, pageSize, sortParam, debouncedTitle, activeFilter],
    queryFn: () =>
      listAlerts({
        page,
        pageSize,
        sort: sortParam,
        title: debouncedTitle || undefined,
        isActive: activeFilter === null ? undefined : activeFilter === "true"
      }),
    placeholderData: keepPreviousData,
    enabled: isAdmin()
  });

  const deleteConfirm = useDeleteConfirm<AlertRow>({
    mutationFn: (row) => deleteAlert(row.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["visibleAlerts"] });
    },
    successMessage: t("alerts.toast.deleted")
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  const total = data?.total ?? 0;
  const columnCount = 5;

  return (
    <Stack gap="md">
      <PageHeader
        title={t("alerts.title")}
        tourId="config-alerts"
        actions={
          <Button component={RouterLink} to="/alerts/new" leftSection={<IconPlus size={16} />}>
            {t("alerts.create")}
          </Button>
        }
      />

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
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <Table>
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
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((alert) => (
              <Table.Tr key={alert.id}>
                {/* The fluid column (v3.4.0): takes the table's slack and truncates first. */}
                <Table.Td style={{ width: "100%", maxWidth: 0 }}>
                  <Text size="sm" fw={500} truncate title={alert.title}>
                    {alert.title}
                  </Text>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Badge
                    variant="light"
                    color={alert.isActive ? "teal" : "gray"}
                    style={{ minWidth: "max-content" }}
                  >
                    {alert.isActive ? t("common.state.yes") : t("common.state.no")}
                  </Badge>
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <Bound value={alert.startsAt} />
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <Bound value={alert.endsAt} />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <RowActions
                    name={alert.title}
                    primary={{
                      icon: <IconPencil size={16} />,
                      label: t("common.action.edit"),
                      ariaLabel: t("alerts.editName", { name: alert.title }),
                      to: `/alerts/${alert.id}/edit`,
                    }}
                    items={[
                      {
                        icon: <IconTrash size={14} />,
                        label: t("common.action.delete"),
                        ariaLabel: t("alerts.deleteName", { name: alert.title }),
                        color: "red",
                        onClick: () => deleteConfirm.requestDelete({ id: alert.id, name: alert.title }),
                      },
                    ]}
                  />
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconSpeakerphone size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("alerts.empty")}
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
        rowsPerPageLabelKey="alerts.rowsPerPage"
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("alerts.deleteTitle")}
        errorTitle={t("alerts.deleteFailed")}
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
