import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Stack, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { createAlert, isAdmin } from "../api/client";
import AlertFormFields from "../components/AlertFormFields";
import ConfirmActionModal from "../components/ConfirmActionModal";
import {
  alertFormValidation,
  emptyAlertFormValues,
  toAlertBody,
  type AlertFormValues,
} from "../utils/alertForm";
import { saveErrorMessage } from "../utils/saveError";

export default function CreateAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<AlertFormValues>({
    initialValues: emptyAlertFormValues(),
    validate: alertFormValidation(t),
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  async function onSubmit(values: AlertFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createAlert(toAlertBody(values));
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["visibleAlerts"] });
      navigate("/alerts", { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "alerts.createForbidden",
          invalid: "alerts.validationError",
          failedStatus: "alerts.createFailedStatus",
          failed: "alerts.createFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="lg" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>{t("alerts.create")}</Title>
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
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
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
