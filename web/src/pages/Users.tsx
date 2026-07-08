import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate } from "react-router-dom";
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
import {
  IconKey,
  IconMessagePlus,
  IconMessageQuestion,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsersGroup,
} from "@tabler/icons-react";
import PersonaChip from "../components/PersonaChip";
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
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";

const SORT_FIELDS = ["name", "email", "role"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "users";

type UserRow = { id: number; name: string; email: string };

export default function Users() {
  const { t } = useTranslation();
  const ROLE_OPTIONS = (["ADMIN", "USER"] as UserRole[]).map((value) => ({
    value,
    label: t(`common.role.${value}`),
  }));
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${SETTINGS_KEY}.filter.email`, "", isString);
  const [roleFilter, setRoleFilter] = useStoredState<UserRole | null>(
    `${SETTINGS_KEY}.filter.role`,
    null,
    isOneOfOrNull(["ADMIN", "USER"]),
  );
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) + (emailFilter.trim() ? 1 : 0) + (roleFilter ? 1 : 0);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const admin = isAdmin();
  const currentUserId = getUserId();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, debouncedEmail, roleFilter], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

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

  const deleteConfirm = useDeleteConfirm<UserRow>({
    mutationFn: (row) => deleteUser(row.id),
    onSuccess: async (row) => {
      if (row.id === getUserId()) {
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

  const total = data?.total ?? 0;
  const columnCount = 9;

  return (
    <Stack gap="md">
      <Title order={2} data-tour="config-users">{t("users.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ClearableTextInput
          label={t("common.field.name")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("users.clearNameFilter")}
        />
        <ClearableTextInput
          label={t("common.field.email")}
          value={emailFilter}
          onChange={setEmailFilter}
          clearLabel={t("users.clearEmailFilter")}
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
                <Table.Td style={{ maxWidth: 240 }}>
                  <PersonaChip name={u.name} />
                </Table.Td>
                <Table.Td style={{ maxWidth: 280 }}>
                  <Text size="sm" truncate>
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Badge
                    variant={u.role === "ADMIN" ? "filled" : "light"}
                    color={u.role === "ADMIN" ? "grape" : "gray"}
                    style={{ minWidth: "max-content" }}
                    aria-label={t("common.field.role")}
                  >
                    {t(`common.role.${u.role}`)}
                  </Badge>
                </Table.Td>
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
                      onClick={() =>
                        deleteConfirm.requestDelete({ id: u.id, name: u.name, email: u.email })
                      }
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
                <EmptyState
                    icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("users.noUsers")}
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

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("users.deleteTitle")}
        errorTitle={t("users.deleteUserFailed")}
        unknownError={t("users.unknownError")}
        body={(target) => (
          <>
            {t("users.deleteConfirmLead")} <strong>{target.name}</strong>{" "}
            {t("users.deleteConfirmRest", { email: target.email })}
          </>
        )}
      />
    </Stack>
  );
}
