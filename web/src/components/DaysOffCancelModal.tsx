import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import EmojiTextarea from "./EmojiTextarea";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const MAX_CANCEL_REASON_LENGTH = 1000;

/**
 * The cancel-days-off confirmation (v2.31.0): cancellation always records a reason (the
 * server rejects a blank one), so this is a bodied ConfirmActionModal variant with a
 * required Textarea — the GoalCloseModal shape, kept separate because that modal's key
 * names are close-flavored (closeTitle/summaryLabel) while this one cancels.
 */
export default function DaysOffCancelModal({
  opened,
  onClose,
  onConfirm,
  loading = false,
}: {
  opened: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!reason.trim()) {
      setError(t("daysOff.cancelReasonRequired"));
      return;
    }
    onConfirm(reason.trim());
  }

  function reset() {
    if (loading) return;
    setReason("");
    setError(null);
    onClose();
  }

  return (
    <Modal opened={opened} onClose={reset} title={t("daysOff.cancelTitle")} centered>
      <Stack gap="md">
        <Text>{t("daysOff.cancelMessage")}</Text>
        <EmojiTextarea
          label={t("daysOff.cancelReasonLabel")}
          placeholder={t("daysOff.cancelReasonPlaceholder")}
          value={reason}
          onChange={(value) => {
            setReason(value);
            setError(null);
          }}
          error={error}
          maxLength={MAX_CANCEL_REASON_LENGTH}
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
            {t("daysOff.action.cancelConfirm")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
