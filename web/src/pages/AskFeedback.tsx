import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, createFeedback, getUserId, type FeedbackVisibility } from "../api/client";

// The asker is the requester, so "Ask for feedback" offers the requester-inclusive visibilities —
// the ones under which the requester (themselves) can read the result.
const VISIBILITY_VALUES: FeedbackVisibility[] = [
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

export default function AskFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const visibilityOptions = VISIBILITY_VALUES.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));

  const providerId = Number(searchParams.get("providerId"));
  const providerName = searchParams.get("providerName");
  // Return to the Dashboard tab the user came from; default to managers.
  const backTo = searchParams.get("back") ?? "/?tab=managers";
  const requesterId = getUserId();

  const [visibility, setVisibility] = useState<FeedbackVisibility>("PROVIDER_REQUESTER_SUBJECT");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const providerIdIsValid = Number.isFinite(providerId) && providerId > 0;
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
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("feedback.error.requestPermission"));
        } else if (err.status === 400) {
          setError(t("feedback.error.validationSimple"));
        } else {
          setError(t("feedback.error.requestFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("feedback.error.requestFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("feedback.askTitle")}</Title>

          <Group grow>
            <TextInput
              label={t("common.field.provider")}
              value={providerName ?? `#${providerId}`}
              disabled
            />
            <TextInput label={t("common.field.subject")} value={t("common.state.you")} disabled />
          </Group>

          <Select
            label={t("common.field.visibility")}
            placeholder={t("feedback.selectVisibility")}
            data={visibilityOptions}
            allowDeselect={false}
            value={visibility}
            onChange={(v) => v && setVisibility(v as FeedbackVisibility)}
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
            <Button type="button" onClick={submit} loading={submitting}>
              {t("feedback.action.sendRequest")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Modal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("feedback.discardRequestTitle")}
        centered
      >
        <Stack gap="md">
          <Text>{t("feedback.discardAskMessage")}</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeCancel}>
              {t("common.action.keepEditing")}
            </Button>
            <Button color="red" component={RouterLink} to={backTo}>
              {t("common.action.discard")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
