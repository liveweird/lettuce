import { memo } from "react";
import { Checkbox, Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { MassShareRow } from "../utils/massShare";
import { pickLocalized } from "../utils/localized";
import type { MassShareColumn, MassSharePageProps } from "./massShareTypes";
import PersonCell from "./PersonCell";
import ResponsiveTable from "./ResponsiveTable";
import StatusPill from "./StatusPill";
import TeamBadges from "./TeamBadges";

/** One person: checkbox (disabled with the reason as its name when unshareable), the profile cells, the kind's cells. */
const MassShareTableRow = memo(function MassShareTableRow({
  row,
  checked,
  onToggle,
  currentUserId,
  personLabel,
  reasonText,
  extraColumns,
}: {
  row: MassShareRow;
  checked: boolean;
  onToggle: (userId: number, checked: boolean) => void;
  currentUserId: number | null;
  personLabel: string;
  reasonText: MassSharePageProps["reasonText"];
  extraColumns: readonly MassShareColumn[];
}) {
  const { t, i18n } = useTranslation();
  const p = row.person;
  const lang = i18n.resolvedLanguage;
  const dict = (entry: typeof p.careerPath) => (entry ? pickLocalized(entry.values, lang) : "—");
  return (
    // Unshareable rows read as dimmed text on the AA-checked token — never `opacity`, which
    // would take the cells under the contrast floor.
    <ResponsiveTable.Tr c={row.shareable ? undefined : "dimmed"}>
      <ResponsiveTable.Td>
        <Checkbox
          aria-label={
            row.shareable
              ? t("sharing.massShare.selectAria", { name: p.name })
              : t("sharing.massShare.unavailableAria", { name: p.name, reason: reasonText(row, t) ?? "" })
          }
          checked={checked && row.shareable}
          disabled={!row.shareable}
          onChange={(e) => onToggle(p.userId, e.currentTarget.checked)}
        />
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={personLabel}>
        <Group gap="xs" wrap="wrap">
          <PersonCell userId={p.userId} name={p.name} currentUserId={currentUserId} />
          {p.deactivated && <StatusPill color="gray">{t("users.inactiveBadge")}</StatusPill>}
        </Group>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.dashboard.team")}>
        <TeamBadges teams={p.teams} />
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("users.profile.path")}>
        <Text size="sm" c={p.careerPath ? undefined : "dimmed"}>
          {dict(p.careerPath)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.dashboard.specialty")}>
        <Text size="sm" c={p.careerSpecialization ? undefined : "dimmed"}>
          {dict(p.careerSpecialization)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("users.profile.seniority")}>
        <Text size="sm" c={p.seniorityLevel ? undefined : "dimmed"}>
          {dict(p.seniorityLevel)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("sharing.massShare.col.managers")}>
        <Text size="sm" c={row.managerLabel ? undefined : "dimmed"}>
          {row.managerLabel || "—"}
        </Text>
      </ResponsiveTable.Td>
      {extraColumns.map((column) => (
        <ResponsiveTable.Td key={column.key} label={column.header(t)}>
          {column.cell(row, t)}
        </ResponsiveTable.Td>
      ))}
    </ResponsiveTable.Tr>
  );
});

export default MassShareTableRow;
