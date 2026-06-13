import { Stack, Title } from "@mantine/core";
import ManagersTable from "./ManagersTable";
import TeamMembersTable from "./TeamMembersTable";

export default function Dashboard() {
  return (
    <Stack gap="md">
      <Title order={2}>Dashboard</Title>

      <Title order={3}>My managers</Title>
      <ManagersTable />

      <Title order={3}>Users in my teams</Title>
      <TeamMembersTable view="member" emptyMessage="No teammates" />

      <Title order={3}>Users in teams I manage</Title>
      <TeamMembersTable view="managed" emptyMessage="No team members" />
    </Stack>
  );
}
