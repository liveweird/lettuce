import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { IconEye, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import SortHeader, { type SortDir } from "../components/SortHeader";
import { deleteTemplate, isAdmin, listTemplates } from "../api/client";

const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

type SortField = "name";

type TemplateRow = { id: number; name: string };

export default function Templates() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [target, setTarget] = useState<TemplateRow | null>(null);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const queryClient = useQueryClient();
  const admin = isAdmin();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [debouncedName, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: async () => {
      closeConfirm();
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function requestDelete(row: TemplateRow) {
    setTarget(row);
    deleteMutation.reset();
    openConfirm();
  }

  function cancelDelete() {
    if (deleteMutation.isPending) return;
    closeConfirm();
    setTarget(null);
    deleteMutation.reset();
  }

  function confirmDelete() {
    if (target) deleteMutation.mutate(target.id);
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const columnCount = 3;

  return (
    <Stack gap="md">
      <Title order={2}>{t("templates.title")}</Title>

      <Group align="flex-end" gap="sm">
        <TextInput
          label={t("common.field.name")}
          placeholder={t("common.filter.contains")}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
          rightSection={
            nameFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("templates.clearNameFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNameFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
      </Group>

      {isError && (
        <Alert color="red" title={t("templates.loadFailed")}>
          {error instanceof Error ? error.message : t("templates.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
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
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((tpl) => (
              <Table.Tr key={tpl.id}>
                <Table.Td>{tpl.name}</Table.Td>
                <Table.Td>
                  <Text c="dimmed" lineClamp={1}>
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
                          color="blue"
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
                          onClick={() => requestDelete({ id: tpl.id, name: tpl.name })}
                          aria-label={t("templates.deleteName", { name: tpl.name })}
                        >
                          {t("common.action.delete")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        component={RouterLink}
                        to={`/templates/${tpl.id}/view`}
                        color="blue"
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
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Text c="dimmed" ta="center">
                  {t("templates.empty")}
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
            aria-label={t("templates.rowsPerPage")}
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

      <Modal
        opened={confirmOpen}
        onClose={cancelDelete}
        title={t("templates.deleteTitle")}
        centered
      >
        <Stack gap="md">
          {target && (
            <Text>
              {t("templates.deleteConfirmPrefix")}
              <strong>{target.name}</strong>
              {t("templates.deleteConfirmSuffix")}
            </Text>
          )}
          {deleteMutation.isError && (
            <Alert color="red" title={t("templates.deleteFailed")}>
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("templates.unknownError")}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={cancelDelete} disabled={deleteMutation.isPending}>
              {t("common.action.cancel")}
            </Button>
            <Button color="red" onClick={confirmDelete} loading={deleteMutation.isPending}>
              {t("common.action.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
