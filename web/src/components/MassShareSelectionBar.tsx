import { Button, Group, Text } from "@mantine/core";
import { IconShare } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { MassShareKind } from "../utils/massShare";
import { kindContext } from "../utils/massShare";

/** Select all matching / Clear selection / Share N… (+ the "N selected people are filtered out" hint). */
export default function MassShareSelectionBar({
  kind,
  shareableMatching,
  selectedCount,
  hiddenSelected,
  onSelectAllMatching,
  onClearSelection,
  onShare,
}: {
  kind: MassShareKind;
  shareableMatching: number;
  selectedCount: number;
  hiddenSelected: number;
  onSelectAllMatching: () => void;
  onClearSelection: () => void;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Group gap="sm" align="center" wrap="wrap">
      <Button variant="default" size="xs" disabled={shareableMatching === 0} onClick={onSelectAllMatching}>
        {t("sharing.massShare.selectAllMatching", { count: shareableMatching })}
      </Button>
      <Button variant="subtle" size="xs" disabled={selectedCount === 0} onClick={onClearSelection}>
        {t("sharing.massShare.clearSelection")}
      </Button>
      <Button leftSection={<IconShare size={16} />} disabled={selectedCount === 0} onClick={onShare}>
        {t("sharing.massShare.shareN", { context: kindContext(kind), count: selectedCount })}
      </Button>
      {hiddenSelected > 0 && (
        <Text size="sm" c="dimmed">
          {t("sharing.massShare.hiddenSelected", { count: hiddenSelected })}
        </Text>
      )}
    </Group>
  );
}
