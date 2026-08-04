import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconEye, IconFileText, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isString, useStoredState } from "../hooks/useStoredState";
import { deleteTemplate, isAdmin, listTemplates } from "../api/client";

const SORT_FIELDS = ["name"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "templates";

type TemplateRow = { id: number; name: string };

export default function Templates() {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const activeFilterCount = nameFilter.trim() ? 1 : 0;

  const queryClient = useQueryClient();
  const admin = isAdmin();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["templates", page, pageSize, sortParam, debouncedName],
    queryFn: () =>
      listTemplates({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const deleteConfirm = useDeleteConfirm<TemplateRow>({
    mutationFn: (row) => deleteTemplate(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
    successMessage: t("templates.toast.deleted"),
  });

  const total = data?.total ?? 0;
  const columnCount = 3;

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-templates">{t("templates.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ClearableTextInput
          label={t("common.field.name")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("templates.clearNameFilter")}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("templates.loadFailed")}>
          {error instanceof Error ? error.message : t("templates.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="name"
                label={t("common.field.name")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>{t("common.field.preview")}</Table.Th>
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((tpl) => (
              <Table.Tr key={tpl.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {tpl.name}
                  </Text>
                </Table.Td>
                <Table.Td style={{ maxWidth: 420 }}>
                  <Text size="sm" c="dimmed" truncate>
                    {tpl.contentPreview}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    {admin ? (
                      <>
                        <Button
                          component={RouterLink}
                          to={`/templates/${tpl.id}/edit`}
                          variant="subtle"
                          size="xs"
                          leftSection={<IconPencil size={14} />}
                          aria-label={t("templates.editName", { name: tpl.name })}
                        >
                          {t("common.action.edit")}
                        </Button>
                        <Button
                          color="red"
                          variant="subtle"
                          size="xs"
                          leftSection={<IconTrash size={14} />}
                          onClick={() =>
                            deleteConfirm.requestDelete({ id: tpl.id, name: tpl.name })
                          }
                          aria-label={t("templates.deleteName", { name: tpl.name })}
                        >
                          {t("common.action.delete")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        component={RouterLink}
                        to={`/templates/${tpl.id}/view`}
                        variant="subtle"
                        size="xs"
                        leftSection={<IconEye size={14} />}
                        aria-label={t("templates.viewName", { name: tpl.name })}
                      >
                        {t("common.action.view")}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                    icon={<IconFileText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("templates.empty")}
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
        rowsPerPageLabelKey="templates.rowsPerPage"
      />

      {admin && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to="/templates/new"
            leftSection={<IconPlus size={16} />}
          >
            {t("templates.create")}
          </Button>
        </Group>
      )}

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("templates.deleteTitle")}
        errorTitle={t("templates.deleteFailed")}
        unknownError={t("templates.unknownError")}
        body={(target) => (
          <>
            {t("templates.deleteConfirmPrefix")}
            <strong>{target.name}</strong>
            {t("templates.deleteConfirmSuffix")}
          </>
        )}
      />
    </Stack>
  );
}
