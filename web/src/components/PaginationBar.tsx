import { useTranslation } from "react-i18next";
import { Group, Pagination, Select, Text } from "@mantine/core";
import { PAGE_SIZE_OPTIONS } from "../hooks/usePagedSort";

// The footer under every list table: total count, rows-per-page picker, pager.
// `rowsPerPageLabelKey` is the page-local i18n key for the picker's aria-label
// (e.g. "users.rowsPerPage") — passed in so each page keeps its existing key.
export default function PaginationBar({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rowsPerPageLabelKey,
}: {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  rowsPerPageLabelKey: string;
}) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Group justify="space-between" align="center">
      <Text size="sm" c="dimmed">
        {t("common.table.total", { count: total })}
      </Text>
      <Group gap="sm" align="center">
        <Select
          size="xs"
          aria-label={t(rowsPerPageLabelKey)}
          data={PAGE_SIZE_OPTIONS.map((n) => ({
            value: String(n),
            label: t("common.table.perPage", { count: n }),
          }))}
          value={String(pageSize)}
          onChange={(v) => {
            if (!v) return;
            onPageSizeChange(Number(v));
          }}
          allowDeselect={false}
          w={110}
        />
        <Pagination
          value={page}
          onChange={onPageChange}
          total={totalPages}
          siblings={1}
          withEdges
        />
      </Group>
    </Group>
  );
}
