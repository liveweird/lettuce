import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Group, Select, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import TableLoadingRow from "../components/TableLoadingRow";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { FEATURES, isAdmin, listUsers, updateUserFeatures, type Feature } from "../api/client";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

const SORT_FIELDS = ["id", "name", "email"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const SETTINGS_KEY = "featureFlags";

// The per-feature admin screen (v1.53.0): pick a feature, see every user with an
// enabled/disabled switch, optionally filtered by state — the flag-first counterpart of the
// per-user editor at /users/:id/features. The state filter "any" deliberately sends NEITHER
// list param (the server requires feature+featureEnabled as a pair); the switch state always
// comes from each row's own disabledFeatures.
export default function FeatureFlags() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [feature, setFeature] = useStoredState<Feature>(
    `${SETTINGS_KEY}.feature`,
    "FEEDBACKS",
    isOneOf(FEATURES),
  );
  const [stateFilter, setStateFilter] = useStoredState<string | null>(
    `${SETTINGS_KEY}.filter.state`,
    null,
    isOneOfOrNull(["enabled", "disabled"]),
  );
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${SETTINGS_KEY}.filter.email`, "", isString);
  const activeFilterCount =
    (stateFilter ? 1 : 0) + (nameFilter.trim() ? 1 : 0) + (emailFilter.trim() ? 1 : 0);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);
  const [error, setError] = useState<string | null>(null);
  // The row whose toggle PUT is in flight — its switch disables until the refetch lands.
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [feature, stateFilter, debouncedName, debouncedEmail], {
      key: SETTINGS_KEY,
      sortFields: SORT_FIELDS,
    });

  const { data, isLoading, isError, error: loadError } = useQuery({
    queryKey: [
      "users",
      "featureFlags",
      page,
      pageSize,
      sortParam,
      feature,
      stateFilter,
      debouncedName,
      debouncedEmail,
    ],
    queryFn: () =>
      listUsers({
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        feature: stateFilter == null ? undefined : feature,
        featureEnabled: stateFilter == null ? undefined : stateFilter === "enabled",
      }),
    placeholderData: keepPreviousData,
    enabled: isAdmin(),
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  async function toggle(row: { id: number; name: string; disabledFeatures: Feature[] }) {
    const currentlyEnabled = !row.disabledFeatures.includes(feature);
    const next = currentlyEnabled
      ? [...row.disabledFeatures, feature]
      : row.disabledFeatures.filter((f) => f !== feature);
    setError(null);
    setPendingId(row.id);
    try {
      await updateUserFeatures(row.id, next);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", row.id] });
      showSuccessToast(t("users.toast.featuresSaved"));
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "users.noPermissionFeatures",
          notFound: "users.userNoLongerExists",
          failedStatus: "users.featuresFailedStatus",
          failed: "users.featuresFailedNetwork",
        }),
      );
    } finally {
      setPendingId(null);
    }
  }

  const total = data?.total ?? 0;
  const columnCount = 3;

  return (
    <Stack gap="md">
      <Title order={2}>{t("users.featureFlags.title")}</Title>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <Select
          label={t("users.featureFlags.featureLabel")}
          value={feature}
          onChange={(v) => {
            if (v != null) setFeature(v as Feature);
          }}
          allowDeselect={false}
          data={FEATURES.map((f) => ({ value: f, label: t(`common.feature.${f}`) }))}
        />
        <Select
          label={t("users.featureFlags.stateLabel")}
          value={stateFilter}
          onChange={setStateFilter}
          clearable
          placeholder={t("common.state.any")}
          data={[
            { value: "enabled", label: t("users.featureFlags.stateEnabled") },
            { value: "disabled", label: t("users.featureFlags.stateDisabled") },
          ]}
        />
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
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("users.loadUsersFailed")}>
          {loadError instanceof Error ? loadError.message : t("users.unknownError")}
        </Alert>
      )}
      {error && (
        <Alert color="red" variant="light">
          {error}
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
            <Table.Th style={{ width: 1, whiteSpace: "nowrap" }}>
              {t("users.featureFlags.enabledHeader")}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {u.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{u.email}</Text>
                </Table.Td>
                <Table.Td>
                  <Group justify="center">
                    <Switch
                      checked={!u.disabledFeatures.includes(feature)}
                      disabled={pendingId === u.id}
                      onChange={() => void toggle(u)}
                      aria-label={t("users.featureFlags.toggleAria", {
                        feature: t(`common.feature.${feature}`),
                        name: u.name,
                      })}
                    />
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
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
    </Stack>
  );
}
