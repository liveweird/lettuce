import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconUserPlus,
} from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAllTeams, listTeamMembers, type TeamMemberListView } from "../api/client";
import FeedbackActionButton from "../components/FeedbackActionButton";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import SortHeader from "../components/SortHeader";
import { usePagedSort } from "../hooks/usePagedSort";
import { feedbackAskLink, feedbackProvideLink, feedbackRequestLink } from "../utils/feedbackLinks";

type SortField = "name" | "email" | "teamName";

export default function TeamMembersTable({
  view,
  emptyMessage,
}: {
  view: TeamMemberListView;
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) + (emailFilter.trim() ? 1 : 0) + (teamFilter ? 1 : 0);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, debouncedEmail, teamFilter]);

  const { data: teams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: listAllTeams,
  });
  const teamOptions = (teams ?? []).map((team) => ({ value: String(team.id), label: team.name }));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "teamMembers",
      view,
      page,
      pageSize,
      sortParam,
      debouncedName,
      debouncedEmail,
      teamFilter,
    ],
    queryFn: () =>
      listTeamMembers({
        view,
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        teamId: teamFilter ? Number(teamFilter) : undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  // The Dashboard tab this table lives in, so feedback flows can return here on Cancel.
  const tab = view === "managed" ? "subordinates" : "peers";
  const backTo = `/?tab=${tab}`;

  return (
    <Stack gap="md">
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
                aria-label={t("teams.clearNameFilter")}
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
                aria-label={t("teams.clearEmailFilter")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmailFilter("")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
        />
        <Select
          label={t("teams.team")}
          placeholder={t("common.state.any")}
          data={teamOptions}
          value={teamFilter}
          onChange={setTeamFilter}
          clearable
          clearButtonProps={{ "aria-label": t("teams.clearTeamFilter") }}
          searchable
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" title={t("teams.loadMembersTableFailed")}>
          {error instanceof Error ? error.message : t("teams.unknownError")}
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
                field="teamName"
                label={t("teams.team")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th aria-label={t("teams.provideFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("teams.askForFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("teams.requestFeedbackFor")} style={{ width: 1 }} />
            <Table.Th aria-label={t("teams.feedbacks")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((m) => (
              <Table.Tr key={`${m.userId}-${m.teamId}`}>
                <Table.Td>{m.name}</Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{m.teamName}</Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <FeedbackActionButton
                    to={feedbackProvideLink(m.userId, m.name, backTo)}
                    icon={<IconMessagePlus size={14} />}
                    label={t("teams.provideFeedback")}
                    ariaLabel={t("teams.provideFeedbackToAria", { name: m.name })}
                  />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <FeedbackActionButton
                    to={feedbackAskLink(m.userId, m.name, backTo)}
                    icon={<IconMessageQuestion size={14} />}
                    label={t("teams.askForFeedback")}
                    ariaLabel={t("teams.askForFeedbackAria", { name: m.name })}
                  />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  {view === "managed" && (
                    <FeedbackActionButton
                      to={feedbackRequestLink(m.userId, m.name, backTo)}
                      icon={<IconUserPlus size={14} />}
                      label={t("teams.requestFeedbackFor")}
                      ariaLabel={t("teams.requestFeedbackAboutAria", { name: m.name })}
                    />
                  )}
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/users/${m.userId}/feedbacks?name=${encodeURIComponent(m.name)}&from=${view === "managed" ? "subordinates" : "peers"}`}
                    color="blue"
                    variant="subtle"
                    size="xs"
                    leftSection={<IconMessages size={14} />}
                    aria-label={t("teams.feedbacksWithAria", { name: m.name })}
                  >
                    {t("teams.feedbacks")}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={7}>
                <Text c="dimmed" ta="center">
                  {emptyMessage}
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
        rowsPerPageLabelKey="teams.rowsPerPage"
      />
    </Stack>
  );
}
