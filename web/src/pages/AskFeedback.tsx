import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Title,
} from "@mantine/core";
import EmojiTextarea from "../components/EmojiTextarea";
import { MAX_REQUESTER_MESSAGE_LENGTH } from "../utils/feedbackForm";
import { useDisclosure } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createFeedback, getUserId, hasFeature, type FeedbackVisibility } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DuplicateFeedbackAlert from "../components/DuplicateFeedbackAlert";
import PersonaField from "../components/PersonaField";
import { useFeedbackDuplicate } from "../hooks/useFeedbackDuplicate";
import { REQUESTER_VISIBILITIES } from "../utils/feedbackVisibility";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

// The asker is the requester, so "Ask for feedback" offers the requester-inclusive
// visibilities — the ones under which the requester (themselves) can read the result.

export default function AskFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const visibilityOptions = REQUESTER_VISIBILITIES.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));

  const providerId = Number(searchParams.get("providerId"));
  const providerName = searchParams.get("providerName");
  // Return to the Dashboard tab the user came from; default to managers.
  const backTo = searchParams.get("back") ?? "/?tab=managers";
  const requesterId = getUserId();

  const [visibility, setVisibility] = useState<FeedbackVisibility>("PROVIDER_REQUESTER_SUBJECT");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const providerIdIsValid = Number.isFinite(providerId) && providerId > 0;
  // Warn up-front when this exact ask already exists (subject == requester == me).
  const duplicate = useFeedbackDuplicate(
    providerIdIsValid && requesterId != null
      ? { subjectId: requesterId, providerId, requesterId }
      : null,
  );
  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (!providerIdIsValid || requesterId == null) return <Navigate to={backTo} replace />;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // I'm asking my manager (provider) to give feedback about me: subject == requester == me.
      await createFeedback({
        requesterId: requesterId!,
        subjectId: requesterId!,
        providerId,
        visibility,
        status: "REQUESTED",
        content: "",
        requesterMessage: message.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      // Asking for feedback mints a requester confirmation — refresh the bell badge immediately.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      showSuccessToast(t("feedback.toast.requested"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "feedback.error.requestPermission",
          conflict: "feedback.error.duplicate",
          invalid: "feedback.error.validationSimple",
          failedStatus: "feedback.error.requestFailedStatus",
          failed: "feedback.error.requestFailed",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("feedback.askTitle")}</Title>

          <Group gap="xl">
            <PersonaField
              label={t("common.field.provider")}
              name={providerName ?? `#${providerId}`}
            />
            <PersonaField label={t("common.field.subject")} you />
          </Group>

          {duplicate.existingId != null && (
            // The caller is the requester of the existing row, so the view route is theirs.
            <DuplicateFeedbackAlert
              status={duplicate.existingStatus ?? "REQUESTED"}
              to={`/feedback/${duplicate.existingId}/view`}
            />
          )}

          <Select
            label={t("common.field.visibility")}
            placeholder={t("feedback.selectVisibility")}
            data={visibilityOptions}
            allowDeselect={false}
            value={visibility}
            onChange={(v) => v && setVisibility(v as FeedbackVisibility)}
          />

          <EmojiTextarea
            label={t("feedback.requesterMessageLabel")}
            placeholder={t("feedback.requesterMessagePlaceholder")}
            value={message}
            onChange={setMessage}
            maxLength={MAX_REQUESTER_MESSAGE_LENGTH}
            autosize
            minRows={2}
            maxRows={6}
          />

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
              {t("common.action.cancel")}
            </Button>
            <Button
              type="button"
              onClick={submit}
              loading={submitting}
              disabled={duplicate.existingId != null}
            >
              {t("feedback.action.sendRequest")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("feedback.discardRequestTitle")}
        message={t("feedback.discardAskMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
    </Container>
  );
}
