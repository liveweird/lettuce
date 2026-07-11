import { Center, Loader, Table } from "@mantine/core";

/** The shared "list is loading" table row — a centered small spinner spanning all columns. */
export default function TableLoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan}>
        <Center py="md">
          <Loader size="sm" />
        </Center>
      </Table.Td>
    </Table.Tr>
  );
}
