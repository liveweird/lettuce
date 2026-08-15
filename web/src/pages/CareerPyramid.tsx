import { Suspense, lazy } from "react";
import { Alert, Group, SegmentedControl, Select, Skeleton, Stack, Table, Text } from "@mantine/core";
import { IconChartBar, IconTable, IconUsersGroup } from "@tabler/icons-react";
import { useDebouncedValue } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listCareerPyramid } from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonaChip from "../components/PersonaChip";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { usePagedSort } from "../hooks/usePagedSort";
import { useStoredState, isOneOf, isString } from "../hooks/useStoredState";
import {
  CAREER_PYRAMID_SORT_FIELDS,
  EMPTY_CAREER_PYRAMID_FILTERS,
  NOT_SET,
  buildCareerPyramidRows,
  filterCareerPyramidRows,
  formatTenure,
  sortCareerPyramidRows,
  type CareerPyramidFilters,
  type CareerPyramidRow,
  type CareerPyramidSortField,
} from "../utils/careerPyramid";
import { todayIsoDate } from "../utils/datetime";
import { userDetailsLink } from "../utils/userLinks";

const SETTINGS_KEY = "career.pyramid";
const REPORTS_SCOPES = ["direct", "all"] as const;
const VIEW_MODES = ["table", "chart"] as const;

// The distribution chart is one of the four lazy @mantine/charts chunks (the TeamKpiChart
// precedent) — recharts never touches the main bundle.
const CareerPyramidChart = lazy(() => import("../components/CareerPyramidChart"));

/**
 * The Career page's "Team pyramid" tab (v2.16.0): the caller's subordinates with their
 * current career triple and the two tenures, composed client-side over the unpaged
 * caller-relative endpoint (the ReviewsDashboard pattern — the standard list plumbing runs
 * client-side over the loaded rows). The chart view replaces the table + pager and consumes
 * the same filtered selection.
 */
export default function CareerPyramid() {
  const { t, i18n } = useTranslation();

  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${SETTINGS_KEY}.filter.reportsScope`,
    "direct",
    isOneOf(REPORTS_SCOPES),
  );
  const [view, setView] = useStoredState<(typeof VIEW_MODES)[number]>(
    `${SETTINGS_KEY}.view`,
    "table",
    isOneOf(VIEW_MODES),
  );
  const includeIndirect = reportsScope === "all";
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [debouncedName] = useDebouncedValue(nameFilter, 200);
  const [pathFilter, setPathFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.careerPath`,
    EMPTY_CAREER_PYRAMID_FILTERS.careerPathId,
    isString,
  );
  const [specFilter, setSpecFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.careerSpecialization`,
    EMPTY_CAREER_PYRAMID_FILTERS.careerSpecializationId,
    isString,
  );
  const [seniorityFilter, setSeniorityFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.seniorityLevel`,
    EMPTY_CAREER_PYRAMID_FILTERS.seniorityLevelId,
    isString,
  );

  const { options: pathOptions } = useDictionaryOptions("career-paths");
  const { options: specOptions } = useDictionaryOptions("career-specializations");
  const { options: seniorityOptions } = useDictionaryOptions("seniority-levels");
  // "Not set" is a first-class filter value: the pyramid exists to expose gaps too.
  const withAllAndNotSet = (options: { value: string; label: string }[]) => [
    { value: "", label: t("common.state.all") },
    { value: NOT_SET, label: t("career.pyramid.notSet") },
    ...options,
  ];

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, toggleSort } =
    usePagedSort<CareerPyramidSortField>(
      "name",
      [reportsScope, debouncedName, pathFilter, specFilter, seniorityFilter],
      { key: SETTINGS_KEY, sortFields: CAREER_PYRAMID_SORT_FIELDS },
    );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["careerPyramid", includeIndirect],
    queryFn: () => listCareerPyramid(includeIndirect),
  });

  const filters: CareerPyramidFilters = {
    name: debouncedName,
    careerPathId: pathFilter,
    careerSpecializationId: specFilter,
    seniorityLevelId: seniorityFilter,
  };
  const activeFilterCount =
    (debouncedName ? 1 : 0) +
    (pathFilter ? 1 : 0) +
    (specFilter ? 1 : 0) +
    (seniorityFilter ? 1 : 0) +
    (includeIndirect ? 1 : 0);
  const allRows = buildCareerPyramidRows(data ?? [], i18n.resolvedLanguage, todayIsoDate());
  const filteredRows = sortCareerPyramidRows(
    filterCareerPyramidRows(allRows, filters),
    sortField,
    sortDir,
  );
  const total = filteredRows.length;
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const tenureCell = (months: number | null) =>
    months == null ? (
      <Text size="sm" c="dimmed" span>
        {t("career.pyramid.notSet")}
      </Text>
    ) : (
      formatTenure(months, t)
    );
  const valueCell = (text: string | null) =>
    text ?? (
      <Text size="sm" c="dimmed" span>
        {t("career.pyramid.notSet")}
      </Text>
    );

  const columns: { field: CareerPyramidSortField; label: string }[] = [
    { field: "name", label: t("common.field.name") },
    { field: "careerPath", label: t("users.profile.path") },
    { field: "careerSpecialization", label: t("users.profile.specialization") },
    { field: "seniorityLevel", label: t("users.profile.seniority") },
    { field: "levelSince", label: t("career.pyramid.colLevelSince") },
    { field: "organizationSince", label: t("career.pyramid.colOrganizationSince") },
  ];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed">
          {t("career.pyramid.hint")}
        </Text>
        <SegmentedControl
          aria-label={t("career.pyramid.viewAria")}
          value={view}
          onChange={(v) => {
            if (isOneOf(VIEW_MODES)(v)) setView(v);
          }}
          data={[
            {
              value: "table",
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconTable size={16} />
                  <span>{t("career.pyramid.viewTable")}</span>
                </Group>
              ),
            },
            {
              value: "chart",
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconChartBar size={16} />
                  <span>{t("career.pyramid.viewChart")}</span>
                </Group>
              ),
            },
          ]}
        />
      </Group>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        <ClearableTextInput
          label={t("career.pyramid.filterName")}
          value={nameFilter}
          onChange={setNameFilter}
          clearLabel={t("career.pyramid.clearNameFilter")}
        />
        <Select
          label={t("common.field.careerPath")}
          data={withAllAndNotSet(pathOptions)}
          value={pathFilter}
          onChange={(v) => setPathFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("common.field.careerSpecialization")}
          data={withAllAndNotSet(specOptions)}
          value={specFilter}
          onChange={(v) => setSpecFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("common.field.seniorityLevel")}
          data={withAllAndNotSet(seniorityOptions)}
          value={seniorityFilter}
          onChange={(v) => setSeniorityFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("career.pyramid.loadError")}>
          {t("career.pyramid.unknownError")}
        </Alert>
      )}

      {!isLoading && !isError && allRows.length === 0 ? (
        <EmptyState
          icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("career.pyramid.empty")}
        />
      ) : view === "chart" ? (
        // The chart replaces the table + pager; every filter above keeps applying —
        // filteredRows is the filtered-but-unpaginated selection.
        <Suspense fallback={<Skeleton height={300} radius="md" />}>
          <CareerPyramidChart rows={filteredRows} />
        </Suspense>
      ) : (
        <>
          <Table highlightOnHover withTableBorder verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                {columns.map((c) => (
                  <Table.Th key={c.field}>
                    <SortHeader
                      field={c.field}
                      label={c.label}
                      activeField={sortField}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr>
                  <Table.Td colSpan={columns.length}>
                    <Text size="sm" c="dimmed" ta="center" py="sm">
                      {t("career.pyramid.noMatches")}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows.map((row: CareerPyramidRow) => (
                  <Table.Tr key={row.userId}>
                    <Table.Td>
                      <PersonaChip
                        name={row.name}
                        to={userDetailsLink(row.userId, row.name, "career")}
                        ariaLabel={t("users.detailsFor", { name: row.name })}
                      />
                    </Table.Td>
                    <Table.Td>{valueCell(row.pathText)}</Table.Td>
                    <Table.Td>{valueCell(row.specializationText)}</Table.Td>
                    <Table.Td>{valueCell(row.seniorityText)}</Table.Td>
                    <Table.Td>{tenureCell(row.levelMonths)}</Table.Td>
                    <Table.Td>{tenureCell(row.organizationMonths)}</Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
          <PaginationBar
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rowsPerPageLabelKey="career.pyramid.rowsPerPage"
          />
        </>
      )}
    </Stack>
  );
}
