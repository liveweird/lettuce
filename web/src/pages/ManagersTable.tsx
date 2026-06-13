import { Alert, Center, Loader, Table, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { listTeamMembers } from "../api/client";

export default function ManagersTable() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["managers"],
    queryFn: () => listTeamMembers({ view: "managers", page: 1, pageSize: 100 }),
  });

  return (
    <>
      {isError && (
        <Alert color="red" title="Failed to load managers">
          {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Team</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={3}>
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
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={3}>
                <Text c="dimmed" ta="center">
                  No managers
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  );
}
