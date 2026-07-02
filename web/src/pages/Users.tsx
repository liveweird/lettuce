import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Modal,
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
import {
  IconKey,
  IconMessagePlus,
  IconMessageQuestion,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  deleteUser,
  getUserId,
  isAdmin,
  listUsers,
  logout,
  type UserRole,
} from "../api/client";
import FeedbackActionButton from "../components/FeedbackActionButton";
import { feedbackAskLink, feedbackProvideLink } from "../utils/feedbackLinks";
import { flagSignedOut, notifyAuthChange } from "../auth";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";

type SortField = "name" | "email" | "role";

type UserRow = { id: number; name: string; email: string };

export default function Users() {
  const { t } = useTranslation();
  const ROLE_OPTIONS = (["ADMIN", "USER"] as UserRole[]).map((value) => ({
    value,
    label: t(`common.role.${value}`),
  }));
  const [nameFilter, setNameFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | null>(null);
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) + (emailFilter.trim() ? 1 : 0) + (roleFilter ? 1 : 0);
  const [target, setTarget] = useState<UserRow | null>(null);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const admin = isAdmin();
  const currentUserId = getUserId();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, debouncedEmail, roleFilter]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users", page, pageSize, sortParam, debouncedName, debouncedEmail, roleFilter],
    queryFn: () =>
      listUsers({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        role: roleFilter ?? undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteUser(id).then(() => id),
    onSuccess: async (deletedId) => {
      closeConfirm();
      setTarget(null);
      if (deletedId === getUserId()) {
        await logout();
        queryClient.clear();
        flagSignedOut();
        navigate("/login", { replace: true });
        notifyAuthChange();
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  function requestDelete(row: UserRow) {
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
  const columnCount = 9;

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-users">{t("users.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount}>
        <TextInput
          label={t("common.field.name")}
          placeholder={t("common.filter.contains")}
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
          rightSection={
            nameFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("users.clearNameFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setNameFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <TextInput
          label={t("common.field.email")}
          placeholder={t("common.filter.contains")}
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.currentTarget.value)}
          rightSection={
            emailFilter ? (
              <CloseButton
                size="sm"
                aria-label={t("users.clearEmailFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmailFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <Select
          label={t("common.field.role")}
          placeholder={t("common.state.any")}
          data={ROLE_OPTIONS}
          value={roleFilter}
          onChange={(v) => setRoleFilter((v as UserRole | null) ?? null)}
          clearable
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" title={t("users.loadUsersFailed")}>
          {error instanceof Error ? error.message : t("users.unknownError")}
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
            <Table.Th>
              <SortHeader
                field="email"
                label={t("common.field.email")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="role"
                label={t("common.field.role")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("users.provideFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.askForFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("common.action.edit")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.changePassword")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.teams")} style={{ width: 1 }} />
            <Table.Th aria-label={t("common.action.delete")} style={{ width: 1 }} />
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
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>{u.name}</Table.Td>
                <Table.Td>{u.email}</Table.Td>
                <Table.Td>{t(`common.role.${u.role}`)}</Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {u.id !== currentUserId && (
                    <FeedbackActionButton
                      to={feedbackProvideLink(u.id, u.name)}
                      icon={<IconMessagePlus size={14} />}
                      label={t("users.provideFeedback")}
                      ariaLabel={t("users.provideFeedbackFor", { name: u.name })}
                    />
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {u.id !== currentUserId && (
                    <FeedbackActionButton
                      to={feedbackAskLink(u.id, u.name, "/users")}
                      icon={<IconMessageQuestion size={14} />}
                      label={t("users.askForFeedback")}
                      ariaLabel={t("users.askForFeedbackFrom", { name: u.name })}
                    />
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Button
                      component={RouterLink}
                      to={`/users/${u.id}/edit`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPencil size={14} />}
                      aria-label={t("users.editAria", { name: u.name })}
                    >
                      {t("common.action.edit")}
                    </Button>
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Button
                      component={RouterLink}
                      to={`/users/${u.id}/change-password`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconKey size={14} />}
                      aria-label={t("users.changePasswordFor", { name: u.name })}
                    >
                      {t("users.changePassword")}
                    </Button>
                  )}
                </Table.Td>
                {/* Everyone gets Teams — read-only for non-admins. The name param feeds the
                    heading there without a getUser call (which is self-or-admin only). */}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/users/${u.id}/teams?name=${encodeURIComponent(u.name)}`}
                    color="blue"
                    variant="subtle"
                    size="xs"
                    leftSection={<IconUsersGroup size={14} />}
                    aria-label={t("users.teamsFor", { name: u.name })}
                  >
                    {t("users.teams")}
                  </Button>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Button
                      color="red"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => requestDelete({ id: u.id, name: u.name, email: u.email })}
                      aria-label={t("users.deleteAria", { name: u.name })}
                    >
                      {t("common.action.delete")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <Text c="dimmed" ta="center">
                  {t("users.noUsers")}
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
        rowsPerPageLabelKey="users.rowsPerPage"
      />

      {admin && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to="/users/new"
            leftSection={<IconPlus size={16} />}
          >
            {t("users.createUser")}
          </Button>
        </Group>
      )}

      <Modal
        opened={confirmOpen}
        onClose={cancelDelete}
        title={t("users.deleteTitle")}
        centered
      >
        <Stack gap="md">
          {target && (
            <Text>
              {t("users.deleteConfirmLead")} <strong>{target.name}</strong>{" "}
              {t("users.deleteConfirmRest", { email: target.email })}
            </Text>
          )}
          {deleteMutation.isError && (
            <Alert color="red" title={t("users.deleteUserFailed")}>
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("users.unknownError")}
            </Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={cancelDelete} disabled={deleteMutation.isPending}>
              {t("common.action.cancel")}
            </Button>
            <Button
              color="red"
              onClick={confirmDelete}
              loading={deleteMutation.isPending}
            >
              {t("common.action.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
