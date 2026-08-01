import { Button, Group, Modal, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MAX_GOAL_TEXT_LENGTH } from "../utils/goalForm";

/**
 * The close-goal confirmation: closing always records a summary (the server rejects a blank
 * one), so this is a bodied ConfirmActionModal variant with a required Textarea. A plain
 * Textarea, not the MarkdownEditor — a short closing note inside a modal doesn't warrant the
 * heavyweight lazy editor; the view screen renders the summary as pre-wrap text accordingly.
 * Team KPIs share the identical close semantics — they reuse this modal with
 * `keyPrefix="teamKpi"`, whose locale area defines the same closeTitle/closeMessage/
 * summaryLabel/summaryPlaceholder/summaryRequired/action.close keys.
 */
export default function GoalCloseModal({
  opened,
  onClose,
  onConfirm,
  loading = false,
  keyPrefix = "goal",
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: (summary: string) => void;
  loading?: boolean;
  keyPrefix?: "goal" | "teamKpi";
}) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!summary.trim()) {
      setError(t(`${keyPrefix}.summaryRequired`));
      return;
    }
    onConfirm(summary);
  }

  function reset() {
    if (loading) return;
    setSummary("");
    setError(null);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={reset} title={t(`${keyPrefix}.closeTitle`)} centered>
      <Stack gap="md">
        <Text>{t(`${keyPrefix}.closeMessage`)}</Text>
        <Textarea
          label={t(`${keyPrefix}.summaryLabel`)}
          placeholder={t(`${keyPrefix}.summaryPlaceholder`)}
          value={summary}
          onChange={(event) => {
            setSummary(event.currentTarget.value);
            setError(null);
          }}
          error={error}
          maxLength={MAX_GOAL_TEXT_LENGTH}
          autosize
          minRows={4}
          withAsterisk
          data-autofocus
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={reset} disabled={loading}>
            {t("common.action.cancel")}
          </Button>
          <Button color="red" onClick={confirm} loading={loading}>
            {t(`${keyPrefix}.action.close`)}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
