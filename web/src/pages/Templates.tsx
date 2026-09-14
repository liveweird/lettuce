import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Stack,
  Text
} from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
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
import { isAdmin } from "../api/session";
import { deleteTemplate, listTemplates } from "../api/templates";
import { loadErrorMessage } from "../utils/saveError";
import PageHeader from "../components/PageHeader";
import RowActions from "../components/RowActions";

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
      sortFields: SORT_FIELDS
    });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["templates", page, pageSize, sortParam, debouncedName],
    queryFn: () =>
      listTemplates({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined
      }),
    placeholderData: keepPreviousData
  });

  const deleteConfirm = useDeleteConfirm<TemplateRow>({
    mutationFn: (row) => deleteTemplate(row.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
    successMessage: t("templates.toast.deleted")
  });

  const total = data?.total ?? 0;
  const columnCount = 3;

  return (
    <Stack gap="md">
      <PageHeader
        title={t("templates.title")}
        tourId="config-templates"
        actions={
          admin && (
            <Button component={RouterLink} to="/templates/new" leftSection={<IconPlus size={16} />}>
              {t("templates.create")}
            </Button>
          )
        }
      />

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
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="name"
                label={t("common.field.name")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("common.field.preview")}</ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((tpl) => (
              <ResponsiveTable.Tr key={tpl.id}>
                <ResponsiveTable.Td label={t("common.field.name")}>
                  <Text size="sm" fw={500}>
                    {tpl.name}
                  </Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.preview")} primary>
                  <Text size="sm" c="dimmed" lineClamp={3}>
                    {tpl.contentPreview}
                  </Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>
                  {admin ? (
                    <RowActions
                      name={tpl.name}
                      primary={{
                        icon: <IconPencil size={16} />,
                        label: t("common.action.edit"),
                        ariaLabel: t("templates.editName", { name: tpl.name }),
                        to: `/templates/${tpl.id}/edit`
                      }}
                      items={[
                        {
                          icon: <IconTrash size={14} />,
                          label: t("common.action.delete"),
                          ariaLabel: t("templates.deleteName", { name: tpl.name }),
                          color: "red",
                          onClick: () => deleteConfirm.requestDelete({ id: tpl.id, name: tpl.name })
                        },
                      ]}
                    />
                  ) : (
                    <RowActions
                      name={tpl.name}
                      primary={{
                        icon: <IconEye size={16} />,
                        label: t("common.action.view"),
                        ariaLabel: t("templates.viewName", { name: tpl.name }),
                        to: `/templates/${tpl.id}/view`
                      }}
                    />
                  )}
                </ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                    icon={<IconFileText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("templates.empty")}
                  />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="templates.rowsPerPage"
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("templates.deleteTitle")}
        errorTitle={t("templates.deleteFailed")}
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
