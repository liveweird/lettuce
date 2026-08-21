import { useState } from "react";
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
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { getAlert, updateAlert } from "../api/alerts";
import { showSuccessToast } from "../utils/toast";
import AlertFormFields from "../components/AlertFormFields";
import ConfirmActionModal from "../components/ConfirmActionModal";
import {
  alertFormValidation,
  emptyAlertFormValues,
  toAlertBody,
  type AlertFormValues,
} from "../utils/alertForm";
import { epochToDatetimeLocal } from "../utils/datetime";
import { saveErrorMessage } from "../utils/saveError";

export default function EditAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<AlertFormValues>({
    initialValues: emptyAlertFormValues(),
    validate: alertFormValidation(t),
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["alert", id],
    queryFn: () => getAlert(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  // Derived, not effect-set (the PulseSettingsCard precedent): initialize applies once.

  if (data && !form.initialized) {
      form.initialize({
        title: data.title,
        content: data.content,
        isActive: data.isActive,
        startsAtSet: data.startsAt != null,
        startsAt: epochToDatetimeLocal(data.startsAt),
        endsAtSet: data.endsAt != null,
        endsAt: epochToDatetimeLocal(data.endsAt),
      });

  }

  if (!isAdmin()) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to="/alerts" replace />;

  async function onSubmit(values: AlertFormValues) {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateAlert(id, toAlertBody(values));
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["alert", id] });
      await queryClient.invalidateQueries({ queryKey: ["visibleAlerts"] });
      showSuccessToast(t("alerts.toast.updated"));
      navigate("/alerts", { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "alerts.editForbidden",
          notFound: "alerts.alertGone",
          invalid: "alerts.validationError",
          failedStatus: "alerts.editFailedStatus",
          failed: "alerts.editFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("alerts.edit")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {notFound
                  ? t("alerts.notFound")
                  : t("alerts.loadOneFailed", {
                      suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                    })}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/alerts" variant="default">
                  {t("alerts.backToAlerts")}
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                <AlertFormFields form={form} />
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <Group justify="flex-end" gap="sm">
                  <Button type="button" variant="default" onClick={openCancel}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button type="submit" loading={submitting}>
                    {t("common.action.save")}
                  </Button>
                </Group>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("alerts.discardTitle")}
        message={t("alerts.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo="/alerts"
      />
    </Container>
  );
}
