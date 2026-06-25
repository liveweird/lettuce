import { Alert, Button, Center, Group, Loader, Table, Text } from "@mantine/core";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconMessagePlus, IconMessageQuestion, IconMessages } from "@tabler/icons-react";
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
            <Table.Th aria-label="Actions" style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={4}>
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
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      component={RouterLink}
                      to={`/feedback/new?subjectId=${m.userId}&subjectName=${encodeURIComponent(m.name)}&back=${encodeURIComponent("/?tab=managers")}`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconMessagePlus size={14} />}
                      aria-label={`Provide feedback to ${m.name}`}
                    >
                      Provide feedback
                    </Button>
                    <Button
                      component={RouterLink}
                      to={`/feedback/ask?providerId=${m.userId}&providerName=${encodeURIComponent(m.name)}&back=${encodeURIComponent("/?tab=managers")}`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconMessageQuestion size={14} />}
                      aria-label={`Ask ${m.name} for feedback`}
                    >
                      Ask for feedback
                    </Button>
                    <Button
                      component={RouterLink}
                      to={`/users/${m.userId}/feedbacks?name=${encodeURIComponent(m.name)}`}
                      color="blue"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconMessages size={14} />}
                      aria-label={`Feedbacks with ${m.name}`}
                    >
                      Feedbacks
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={4}>
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
