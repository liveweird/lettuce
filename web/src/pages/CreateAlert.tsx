import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Stack, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createAlert, isAdmin } from "../api/client";
import AlertFormFields, {
  alertFormValidation,
  toAlertBody,
  type AlertFormValues,
} from "../components/AlertFormFields";

export default function CreateAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<AlertFormValues>({
    initialValues: {
      title: "",
      content: "",
      isActive: true,
      startsAtSet: false,
      startsAt: "",
      endsAtSet: false,
      endsAt: "",
    },
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
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("alerts.createForbidden"));
        } else if (err.status === 400) {
          setError(t("alerts.validationError"));
        } else {
          setError(t("alerts.createFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("alerts.createFailedNetwork"));
      }
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
              <Button component={RouterLink} to="/alerts" variant="default">
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={submitting}>
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
