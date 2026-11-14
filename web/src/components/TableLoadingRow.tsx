import { Center } from "@mantine/core";
import LoadingSpinner from "./LoadingSpinner";
import Table from "./ResponsiveTable";

/** The shared "list is loading" table row — a centered small spinner spanning all columns. */
export default function TableLoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan}>
        <Center py="md">
          <LoadingSpinner size="sm" />
        </Center>
      </Table.Td>
    </Table.Tr>
  );
}
