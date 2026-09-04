import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Button, Container, Paper, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { isAdmin } from "../api/session";
import { createAlert } from "../api/alerts";
import { showSuccessToast } from "../utils/toast";
import AlertFormFields from "../components/AlertFormFields";
import ConfirmActionModal from "../components/ConfirmActionModal";
import FormFooter from "../components/FormFooter";
import PageHeader from "../components/PageHeader";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
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

  const form = useForm<AlertFormValues>({
    initialValues: emptyAlertFormValues(),
    validate: alertFormValidation(t),
  });
  const { requestCancel, modalProps } = useDiscardGuard({
    isDirty: () => form.isDirty(),
    to: "/alerts",
    title: t("alerts.discardTitle"),
    message: t("alerts.discardMessage"),
  });

  if (!isAdmin()) return <Navigate to="/" replace />;

  async function onSubmit(values: AlertFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createAlert(toAlertBody(values));
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["visibleAlerts"] });
      showSuccessToast(t("alerts.toast.created"));
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
    <>
      <PageHeader title={t("alerts.create")} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit(onSubmit)} noValidate>
            <Stack>
              <AlertFormFields form={form} />
              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}
              <FormFooter>
                <Button type="button" variant="default" onClick={requestCancel}>
                  {t("common.action.cancel")}
                </Button>
                <Button type="submit" loading={submitting}>
                  {t("common.action.create")}
                </Button>
              </FormFooter>
            </Stack>
          </form>
        </Paper>
      </Container>

      <ConfirmActionModal {...modalProps} />
    </>
  );
}
