import { Alert, Badge, Button, Center, Group, Loader, Paper, Stack, Text, Timeline } from "@mantine/core";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { CareerPosition } from "../api/career";
import { formatIsoDate } from "../utils/datetime";
import { pickDictionaryValue } from "../utils/dictionaryForm";

// One position's triple, small: dimmed label + value in the viewer's language (or a dash).
function PositionValue({
  label,
  entry,
}: {
  label: string;
  entry: { id: number; valueEn: string; valuePl: string } | null;
}) {
  const { i18n } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" style={{ minWidth: "max-content" }}>
        {label}
      </Text>
      {entry ? (
        <Text size="sm">{pickDictionaryValue(entry, i18n.resolvedLanguage)}</Text>
      ) : (
        <Text size="sm" c="dimmed">
          —
        </Text>
      )}
    </Group>
  );
}

/**
 * The read-only career position timeline (extracted from UserCareer in v2.16.0 so the
 * Career page's "My career" tab shares the exact render): newest first, the current
 * (open-ended) position emphasized. Passing [onEdit]/[onDelete] reveals the per-row
 * manager buttons — omitted, the timeline is purely read-only. [positions] arrives in
 * the API's chronological order; the reversal lives here.
 */
export default function CareerTimeline({
  positions,
  isLoading,
  isError,
  onEdit,
  onDelete,
  busy = false,
}: {
  positions: CareerPosition[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
  busy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  // Server order is chronological; the timeline reads newest-first like every history surface.
  const newestFirst = positions ? [...positions].reverse() : [];
  return (
    <Paper withBorder p="md" radius="md">
      {isError ? (
        <Alert color="red" variant="light">
          {t("users.career.loadError")}
        </Alert>
      ) : isLoading || !positions ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : newestFirst.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          {t("users.career.empty")}
        </Text>
      ) : (
        <Timeline active={0} bulletSize={14} lineWidth={2}>
          {newestFirst.map((p) => (
            <Timeline.Item
              key={p.id}
              title={
                <Group gap="xs" wrap="wrap">
                  <Text size="sm" fw={600} span>
                    {p.endDate != null
                      ? `${formatIsoDate(p.startDate, i18n.language)} – ${formatIsoDate(p.endDate, i18n.language)}`
                      : t("users.career.since", { date: formatIsoDate(p.startDate, i18n.language) })}
                  </Text>
                  {p.endDate == null && (
                    <Badge size="sm" variant="light" color="lettuce">
                      {t("users.career.currentBadge")}
                    </Badge>
                  )}
                </Group>
              }
            >
              <Stack gap={2} mt={2}>
                <PositionValue label={t("users.profile.path")} entry={p.careerPath} />
                <PositionValue
                  label={t("users.profile.specialization")}
                  entry={p.careerSpecialization}
                />
                <PositionValue label={t("users.profile.seniority")} entry={p.seniorityLevel} />
                {onEdit != null && onDelete != null && (
                  <Group gap={4} mt={4}>
                    <Button
                      variant="subtle"
                      size="xs"
                      leftSection={<IconPencil size={14} />}
                      disabled={busy}
                      onClick={() => onEdit(p.id)}
                      aria-label={t("users.career.editAria", { date: p.startDate })}
                    >
                      {t("common.action.edit")}
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      leftSection={<IconTrash size={14} />}
                      disabled={busy}
                      onClick={() => onDelete(p.id)}
                      aria-label={t("users.career.deleteAria", { date: p.startDate })}
                    >
                      {t("common.action.delete")}
                    </Button>
                  </Group>
                )}
              </Stack>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Paper>
  );
}
