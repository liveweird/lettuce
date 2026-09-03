import type { ParseKeys } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconKey,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
  IconUserCheck,
  IconToggleLeft,
  IconUserCog,
  IconUserOff,
  IconUsersGroup,
} from "@tabler/icons-react";
import PersonaChip from "../components/PersonaChip";
import { getUserId, hasFeature, isAdmin, USER_ROLES, type UserRole } from "../api/session";
import { logout } from "../api/auth";
import { deactivateUser, deleteUser, listUsers, reactivateUser } from "../api/users";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import FeedbackActionsMenu from "../components/FeedbackActionsMenu";
import { feedbackAskLink, feedbackProvideLink, userFeedbacksLink } from "../utils/feedbackLinks";
import { userDetailsLink } from "../utils/userLinks";
import { flagSignedOut, notifyAuthChange } from "../auth";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { invalidateUser } from "../utils/userQueries";

const SORT_FIELDS = ["name", "email", "uniqueId"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "users";

type UserRow = { id: number; name: string; email: string };

// Stored tri-state filter value: "true"/"false" select a boolean query param, null = any.
type BooleanFilter = "true" | "false" | null;

export default function Users() {
  const { t } = useTranslation();
  const ROLE_OPTIONS = USER_ROLES.map((value) => ({
    value,
    label: t(`common.role.${value}`),
  }));
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${SETTINGS_KEY}.filter.email`, "", isString);
  const [roleFilter, setRoleFilter] = useStoredState<UserRole | null>(
    `${SETTINGS_KEY}.filter.role`,
    null,
    isOneOfOrNull([...USER_ROLES]),
  );
  // "true" = inactive only, "false" = active only, null = any (the Alerts isActive idiom).
  const [statusFilter, setStatusFilter] = useStoredState<BooleanFilter>(
    `${SETTINGS_KEY}.filter.deactivated`,
    null,
    isOneOfOrNull(["true", "false"]),
  );
  const [uniqueIdFilter, setUniqueIdFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.uniqueId`,
    "",
    isString,
  );
  // "true" = missing only, "false" = set only, null = any (the status-filter idiom) — the
  // missing view is how admins work down the fill-ASAP backlog.
  const [uniqueIdMissingFilter, setUniqueIdMissingFilter] = useStoredState<BooleanFilter>(
    `${SETTINGS_KEY}.filter.uniqueIdMissing`,
    null,
    isOneOfOrNull(["true", "false"]),
  );
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) +
    (emailFilter.trim() ? 1 : 0) +
    (roleFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (uniqueIdFilter.trim() ? 1 : 0) +
    (uniqueIdMissingFilter ? 1 : 0);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const admin = isAdmin();
  const currentUserId = getUserId();

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);
  const [debouncedUniqueId] = useDebouncedValue(uniqueIdFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "name",
      [debouncedName, debouncedEmail, roleFilter, statusFilter, debouncedUniqueId, uniqueIdMissingFilter],
      {
        key: SETTINGS_KEY,
        sortFields: SORT_FIELDS,
      },
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "users",
      page,
      pageSize,
      sortParam,
      debouncedName,
      debouncedEmail,
      roleFilter,
      statusFilter,
      debouncedUniqueId,
      uniqueIdMissingFilter,
    ],
    queryFn: () =>
      listUsers({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        role: roleFilter ?? undefined,
        deactivated: statusFilter == null ? undefined : statusFilter === "true",
        uniqueId: debouncedUniqueId || undefined,
        uniqueIdMissing: uniqueIdMissingFilter == null ? undefined : uniqueIdMissingFilter === "true",
      }),
    placeholderData: keepPreviousData,
  });

  const deleteConfirm = useDeleteConfirm<UserRow>({
    mutationFn: (row) => deleteUser(row.id),
    // No hook-level successMessage: a self-delete signs the caller out mid-flow, so the
    // toast fires only on the ordinary branch below.
    onSuccess: async (row) => {
      if (row.id === getUserId()) {
        await logout();
        queryClient.clear();
        flagSignedOut();
        navigate("/login", { replace: true });
        notifyAuthChange();
        return;
      }
      await invalidateUser(queryClient);
      showSuccessToast(t("users.toast.deleted"));
    },
  });

  // Deactivate asks for confirmation (it kicks the user out at the next refresh); reactivate
  // is the harmless direction and fires straight away. Errors render inline (the house rule).
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null);
  const [transitionPending, setTransitionPending] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  async function runAccountTransition(action: () => Promise<void>, successKey: ParseKeys) {
    setTransitionPending(true);
    setTransitionError(null);
    try {
      await action();
      await invalidateUser(queryClient);
      showSuccessToast(t(successKey));
      setDeactivateTarget(null);
    } catch (err) {
      setTransitionError(
        saveErrorMessage(err, t, {
          forbidden: "users.transitionForbidden",
          failedStatus: "users.transitionFailedStatus",
          failed: "users.transitionFailed",
        }),
      );
      setDeactivateTarget(null);
    } finally {
      setTransitionPending(false);
    }
  }

  const total = data?.total ?? 0;
  const columnCount = 7;

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
        <Select
          label={t("users.statusFilterLabel")}
          placeholder={t("common.state.any")}
          data={[
            { value: "false", label: t("users.statusActive") },
            { value: "true", label: t("users.statusInactive") },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter((v as BooleanFilter) ?? null)}
          clearable
        />
        <ClearableTextInput
          label={t("users.uniqueId")}
          value={uniqueIdFilter}
          onChange={setUniqueIdFilter}
          clearLabel={t("users.clearUniqueIdFilter")}
        />
        <Select
          label={t("users.uniqueIdFilterLabel")}
          placeholder={t("common.state.any")}
          data={[
            { value: "false", label: t("users.uniqueIdSet") },
            { value: "true", label: t("users.uniqueIdMissing") },
          ]}
          value={uniqueIdMissingFilter}
          onChange={(v) => setUniqueIdMissingFilter((v as BooleanFilter) ?? null)}
          clearable
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("users.loadUsersFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {transitionError && (
        <Alert color="red" variant="light">
          {transitionError}
        </Alert>
      )}

      <Table>
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
                field="uniqueId"
                label={t("users.uniqueId")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {/* A roles set has no order — plain header, deliberately not a SortHeader. */}
            <Table.Th>{t("common.field.roles")}</Table.Th>
            <Table.Th aria-label={t("users.teams")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.feedbackActions")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.modifyActions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td style={{ maxWidth: 240 }}>
                  <Group gap={6} wrap="nowrap">
                    {/* The name links to the relationship-aware read-only card view — everyone,
                        except one's own row (the card flavors describe the viewer's relationship
                        to someone else). */}
                    <PersonaChip
                      name={u.name}
                      to={u.id !== currentUserId ? userDetailsLink(u.id, u.name, "users") : undefined}
                      ariaLabel={t("users.detailsFor", { name: u.name })}
                    />
                    {/* The ONLY place the account state surfaces — everywhere else a
                        deactivated user renders exactly like an active one. Gray on purpose:
                        neither the brand accent nor a semantic state color. */}
                    {u.deactivated && (
                      <Badge variant="light" color="gray" style={{ minWidth: "max-content" }}>
                        {t("users.inactiveBadge")}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td style={{ maxWidth: 280 }}>
                  <Text size="sm" truncate>
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td style={{ maxWidth: 160 }}>
                  {u.uniqueId != null ? (
                    <Text size="sm" truncate aria-label={t("users.uniqueId")}>
                      {u.uniqueId}
                    </Text>
                  ) : (
                    /* Orange = warning, actionable-missing (the career "Not set" idiom):
                       the id is optional but should be filled ASAP. */
                    <Badge
                      size="sm"
                      variant="light"
                      color="orange"
                      style={{ minWidth: "max-content" }}
                      aria-label={t("users.uniqueId")}
                    >
                      {t("users.uniqueIdMissingBadge")}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {u.roles.length > 0 ? (
                    <Group gap={4} wrap="nowrap">
                      {u.roles.map((role) => (
                        <Badge
                          key={role}
                          variant="filled"
                          color={role === "HR" ? "cyan" : "grape"}
                          style={{ minWidth: "max-content" }}
                          aria-label={t("common.field.roles")}
                        >
                          {t(`common.role.${role}`)}
                        </Badge>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed" aria-label={t("common.field.roles")}>
                      —
                    </Text>
                  )}
                </Table.Td>
                {/* Everyone gets Teams — read-only for non-admins. The name param feeds the
                    heading there without a getUser call (which is self-or-admin only). */}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/users/${u.id}/teams?name=${encodeURIComponent(u.name)}`}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconUsersGroup size={14} />}
                    aria-label={t("users.teamsFor", { name: u.name })}
                  >
                    {t("users.teams")}
                  </Button>
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {u.id !== currentUserId && hasFeature("FEEDBACKS") && (
                    <FeedbackActionsMenu
                      provideTo={feedbackProvideLink(u.id)}
                      askTo={feedbackAskLink(u.id, "/users")}
                      listTo={userFeedbacksLink(u.id, u.name, "users")}
                      name={u.name}
                    />
                  )}
                </Table.Td>
                {/* The admin account actions grouped behind one "Modify ▾" menu (v1.52.0, the
                    FeedbackActionsMenu idiom) — item aria-labels are the pre-grouping button
                    ones, only the role changed. Deactivate/Reactivate stays off one's own row. */}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {admin && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconUserCog size={14} />}
                          rightSection={<IconChevronDown size={14} />}
                          aria-label={t("users.modifyActionsFor", { name: u.name })}
                        >
                          {t("users.modifyActions")}
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          component={RouterLink}
                          to={`/users/${u.id}/edit`}
                          leftSection={<IconPencil size={14} />}
                          aria-label={t("users.editAria", { name: u.name })}
                        >
                          {t("users.editDetails")}
                        </Menu.Item>
                        <Menu.Item
                          component={RouterLink}
                          to={`/users/${u.id}/change-password`}
                          leftSection={<IconKey size={14} />}
                          aria-label={t("users.changePasswordFor", { name: u.name })}
                        >
                          {t("users.changePassword")}
                        </Menu.Item>
                        <Menu.Item
                          component={RouterLink}
                          to={`/users/${u.id}/features`}
                          leftSection={<IconToggleLeft size={14} />}
                          aria-label={t("users.featuresFor", { name: u.name })}
                        >
                          {t("users.features")}
                        </Menu.Item>
                        <Menu.Divider />
                        {u.id !== currentUserId &&
                          (u.deactivated ? (
                            <Menu.Item
                              leftSection={<IconUserCheck size={14} />}
                              onClick={() =>
                                runAccountTransition(
                                  () => reactivateUser(u.id),
                                  "users.toast.reactivated",
                                )
                              }
                              disabled={transitionPending}
                              aria-label={t("users.reactivateAria", { name: u.name })}
                            >
                              {t("users.reactivate")}
                            </Menu.Item>
                          ) : (
                            <Menu.Item
                              color="red"
                              leftSection={<IconUserOff size={14} />}
                              onClick={() =>
                                setDeactivateTarget({ id: u.id, name: u.name, email: u.email })
                              }
                              aria-label={t("users.deactivateAria", { name: u.name })}
                            >
                              {t("users.deactivate")}
                            </Menu.Item>
                          ))}
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={() =>
                            deleteConfirm.requestDelete({ id: u.id, name: u.name, email: u.email })
                          }
                          aria-label={t("users.deleteAria", { name: u.name })}
                        >
                          {t("common.action.delete")}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                    icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                    label={t("users.noUsers")}
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
        rowsPerPageLabelKey="users.rowsPerPage"
      />

      {admin && (
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to="/users/import"
            variant="default"
            leftSection={<IconUpload size={16} />}
          >
            {t("users.massImport")}
          </Button>
          <Button
            component={RouterLink}
            to="/users/new"
            leftSection={<IconPlus size={16} />}
          >
            {t("users.createUser")}
          </Button>
        </Group>
      )}

      <ConfirmActionModal
        opened={deactivateTarget != null}
        onClose={() => setDeactivateTarget(null)}
        title={t("users.deactivateTitle")}
        message={
          deactivateTarget && t("users.deactivateConfirm", { name: deactivateTarget.name })
        }
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("users.deactivate")}
        onConfirm={() =>
          deactivateTarget &&
          runAccountTransition(() => deactivateUser(deactivateTarget.id), "users.toast.deactivated")
        }
        loading={transitionPending}
      />

      <ConfirmDeleteModal
        confirm={deleteConfirm}
        title={t("users.deleteTitle")}
        errorTitle={t("users.deleteUserFailed")}
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
