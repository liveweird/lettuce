import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { getUserId, isAdmin } from "../api/session";
import { getUser, setEmailNotifications } from "../api/users";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

/**
 * The self-service email-mirror toggle (v2.3.0): while enabled (the default), every in-app
 * notification is also emailed to the user. Reached from the header account menu; an admin
 * may also open another user's page (the change-password posture).
 */
export default function EmailNotifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null until the user touches the switch — the loaded value renders meanwhile.
  const [choice, setChoice] = useState<boolean | null>(null);

  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();
  const isSelf = currentUserId !== null && currentUserId === id;
  const canChange = isAdmin() || isSelf;
  const returnTo = isSelf || !isAdmin() ? "/" : "/users";

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && canChange,
    retry: false,
  });

  if (!canChange || !idIsValid) return <Navigate to="/" replace />;

  const enabled = choice ?? data?.emailNotificationsEnabled ?? true;

  async function onSave() {
    setError(null);
    setSubmitting(true);
    try {
      await setEmailNotifications(id, enabled);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      showSuccessToast(t("emailNotifications.toast.saved"));
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "emailNotifications.noPermission",
          notFound: "emailNotifications.userNotFound",
          failedStatus: "emailNotifications.saveFailedStatus",
          failed: "emailNotifications.saveFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2} data-tour="account-email-notifications">{t("emailNotifications.title")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {notFound ? t("emailNotifications.userNotFound") : t("emailNotifications.loadFailed")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("common.action.cancel")}
                </Button>
              </Group>
            </>
          ) : (
            <Stack>
              {data && !isSelf && (
                <Text c="dimmed" size="sm">
                  {data.name} ({data.email})
                </Text>
              )}
              <Text c="dimmed" size="sm">
                {t("emailNotifications.hint")}
              </Text>
              <Switch
                label={t("emailNotifications.switchLabel")}
                checked={enabled}
                onChange={(event) => setChoice(event.currentTarget.checked)}
              />
              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}
              <Group justify="flex-end" gap="sm">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("common.action.cancel")}
                </Button>
                <Button onClick={onSave} loading={submitting}>
                  {t("common.action.save")}
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
