import type { ParseKeys } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Table,
  Text
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconKey,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUpload,
  IconUserCheck,
  IconToggleLeft,
  IconUserOff,
  IconUsersGroup,
  IconAlertCircle
} from "@tabler/icons-react";
import PersonaChip from "../components/PersonaChip";
import StatusPill from "../components/StatusPill";
import { getUserId, hasFeature, isAdmin, USER_ROLES, type UserRole } from "../api/session";
import { logout } from "../api/auth";
import { deactivateUser, deleteUser, listUsers, reactivateUser, type UserPage } from "../api/users";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import RowActions, { type RowActionItem } from "../components/RowActions";
import { feedbackRowMenu } from "../components/feedbackActionsMenu";
import { feedbackAskLink, feedbackProvideLink, userFeedbacksLink } from "../utils/feedbackLinks";
import { userDetailsLink } from "../utils/userLinks";
import { flagSignedOut } from "../auth";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import ListToolbar from "../components/ListToolbar";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { invalidateUser } from "../utils/userQueries";
import PageHeader from "../components/PageHeader";

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
    label: t(`common.role.${value}`)
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
  // The Name filter is the toolbar's quick search (v3.3.0); the badge counts the panel's own
  // filters, and "Clear filters" resets exactly those.
  const activeFilterCount =
    (emailFilter.trim() ? 1 : 0) +
    (roleFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (uniqueIdFilter.trim() ? 1 : 0) +
    (uniqueIdMissingFilter ? 1 : 0);
  function clearPanelFilters() {
    setEmailFilter("");
    setRoleFilter(null);
    setStatusFilter(null);
    setUniqueIdFilter("");
    setUniqueIdMissingFilter(null);
  }

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
        sortFields: SORT_FIELDS
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
        uniqueIdMissing: uniqueIdMissingFilter == null ? undefined : uniqueIdMissingFilter === "true"
      }),
    placeholderData: keepPreviousData
  });

  const deleteConfirm = useDeleteConfirm<UserRow>({
    mutationFn: (row) => deleteUser(row.id),
    // No hook-level successMessage: a self-delete signs the caller out mid-flow, so the
    // toast fires only on the ordinary branch below.
    onSuccess: async (row) => {
      if (row.id === getUserId()) {
        flagSignedOut();
        const revoke = logout();
        navigate("/login", { replace: true });
        await revoke;
        return;
      }
      await invalidateUser(queryClient);
      showSuccessToast(t("users.toast.deleted"));
    }
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
          failed: "users.transitionFailed"
        }),
      );
      setDeactivateTarget(null);
    } finally {
      setTransitionPending(false);
    }
  }

  const total = data?.total ?? 0;
  // The admin account actions (v1.52.0 "Modify ▾", the ⋯ menu since v3.4.0).
  const adminRowItems = (u: UserPage["items"][number]): RowActionItem[] => [
    {
      icon: <IconPencil size={14} />,
      label: t("users.editDetails"),
      ariaLabel: t("users.editAria", { name: u.name }),
      to: `/users/${u.id}/edit`,
    },
    {
      icon: <IconKey size={14} />,
      label: t("users.changePassword"),
      ariaLabel: t("users.changePasswordFor", { name: u.name }),
      to: `/users/${u.id}/change-password`,
    },
    {
      icon: <IconToggleLeft size={14} />,
      label: t("users.features"),
      ariaLabel: t("users.featuresFor", { name: u.name }),
      to: `/users/${u.id}/features`,
    },
    ...(u.id === currentUserId
      ? []
      : u.deactivated
        ? [
            {
              icon: <IconUserCheck size={14} />,
              label: t("users.reactivate"),
              ariaLabel: t("users.reactivateAria", { name: u.name }),
              onClick: () => runAccountTransition(() => reactivateUser(u.id), "users.toast.reactivated"),
              disabled: transitionPending,
              dividerBefore: true,
            } satisfies RowActionItem,
          ]
        : [
            {
              icon: <IconUserOff size={14} />,
              label: t("users.deactivate"),
              ariaLabel: t("users.deactivateAria", { name: u.name }),
              onClick: () => setDeactivateTarget({ id: u.id, name: u.name, email: u.email }),
              color: "red",
              dividerBefore: true,
            } satisfies RowActionItem,
          ]),
    {
      icon: <IconTrash size={14} />,
      label: t("common.action.delete"),
      ariaLabel: t("users.deleteAria", { name: u.name }),
      onClick: () => deleteConfirm.requestDelete({ id: u.id, name: u.name, email: u.email }),
      color: "red",
      dividerBefore: u.id === currentUserId,
    },
  ];

  const columnCount = 5;

  return (
    <Stack gap="md">
      <PageHeader
        title={t("users.title")}
        tourId="config-users"
        actions={
          admin && (
            <>
              <Button
                component={RouterLink}
                to="/users/import"
                variant="default"
                leftSection={<IconUpload size={16} />}
              >
                {t("users.massImport")}
              </Button>
              <Button component={RouterLink} to="/users/new" leftSection={<IconPlus size={16} />}>
                {t("users.createUser")}
              </Button>
            </>
          )
        }
      />

      <ListToolbar
        search={{
          label: t("common.field.name"),
          value: nameFilter,
          onChange: setNameFilter,
          clearLabel: t("users.clearNameFilter"),
        }}
        filters={{
          activeCount: activeFilterCount,
          storageKey: SETTINGS_KEY,
          onClear: clearPanelFilters,
          children: (
            <>
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
            </>
          ),
        }}
      />

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
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td style={{ maxWidth: 280 }}>
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
                      <StatusPill color="gray">{t("users.inactiveBadge")}</StatusPill>
                    )}
                  </Group>
                </Table.Td>
                {/* The fluid column (v3.4.0): takes the table's slack and truncates first. */}
                <Table.Td style={{ width: "100%", maxWidth: 0 }}>
                  <Text size="sm" truncate title={u.email}>
                    {u.email}
                  </Text>
                </Table.Td>
                <Table.Td style={{ maxWidth: 160 }}>
                  {u.uniqueId != null ? (
                    <Text size="sm" truncate aria-label={t("users.uniqueId")}>
                      {u.uniqueId}
                    </Text>
                  ) : (
                    /* The quiet admin cue (v2.19.0, restyled v3.3.0): a warning-coloured icon
                       beside dimmed text — the id is optional but should be filled ASAP, and
                       the "Missing only" filter finds every such row. */
                    <Group gap={4} wrap="nowrap">
                      <IconAlertCircle
                        size={14}
                        aria-hidden="true"
                        style={{ color: "var(--lettuce-ink-warning)", flexShrink: 0 }}
                      />
                      <Text size="sm" c="dimmed" fs="italic" aria-label={t("users.uniqueId")}>
                        {t("users.uniqueIdMissingBadge")}
                      </Text>
                    </Group>
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {u.roles.length > 0 ? (
                    <Group gap={4} wrap="nowrap">
                      {u.roles.map((role) => (
                        <StatusPill
                          key={role}
                          color={role === "HR" ? "cyan" : "grape"}
                          ariaLabel={t("common.field.roles")}
                        >
                          {t(`common.role.${role}`)}
                        </StatusPill>
                      ))}
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed" aria-label={t("common.field.roles")}>
                      —
                    </Text>
                  )}
                </Table.Td>
                {/* One row-action cell (v3.4.0): Teams as the visible icon (read-only for
                    non-admins — the name param feeds the heading there without a getUser call,
                    which is self-or-admin only), the Feedback menu (never on one's own row),
                    and the admin account actions behind the ⋯ that keeps the "Modify actions
                    for X" name (v1.52.0). Item aria-labels are the pre-grouping button ones.
                    Deactivate/Reactivate stays off one's own row. */}
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <RowActions
                    name={u.name}
                    primary={{
                      icon: <IconUsersGroup size={16} />,
                      label: t("users.teams"),
                      ariaLabel: t("users.teamsFor", { name: u.name }),
                      to: `/users/${u.id}/teams?name=${encodeURIComponent(u.name)}`,
                    }}
                    menus={
                      u.id !== currentUserId && hasFeature("FEEDBACKS")
                        ? [
                            feedbackRowMenu(t, {
                              provideTo: feedbackProvideLink(u.id),
                              askTo: feedbackAskLink(u.id, "/users"),
                              listTo: userFeedbacksLink(u.id, u.name, "users"),
                              name: u.name,
                            }),
                          ]
                        : []
                    }
                    menuLabel={t("users.modifyActionsFor", { name: u.name })}
                    items={admin ? adminRowItems(u) : []}
                  />
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
