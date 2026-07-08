import { useEffect, useState } from "react";
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
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getAlert, isAdmin, updateAlert } from "../api/client";
import AlertFormFields, {
  alertFormValidation,
  toAlertBody,
  type AlertFormValues,
} from "../components/AlertFormFields";
import { epochToDatetimeLocal } from "../utils/datetime";

export default function EditAlert() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<AlertFormValues>({
    initialValues: { title: "", content: "", isActive: true, startsAt: "", endsAt: "" },
    validate: alertFormValidation(t),
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["alert", id],
    queryFn: () => getAlert(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      form.initialize({
        title: data.title,
        content: data.content,
        isActive: data.isActive,
        startsAt: epochToDatetimeLocal(data.startsAt),
        endsAt: epochToDatetimeLocal(data.endsAt),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
      navigate("/alerts", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("alerts.editForbidden"));
        } else if (err.status === 404) {
          setError(t("alerts.alertGone"));
        } else if (err.status === 400) {
          setError(t("alerts.validationError"));
        } else {
          setError(t("alerts.editFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("alerts.editFailedNetwork"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="lg" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("alerts.edit")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                {t("alerts.notFound")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/alerts" variant="default">
                  {t("alerts.backToAlerts")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("alerts.loadOneFailed", {
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
                  <Button component={RouterLink} to="/alerts" variant="default">
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
    </Container>
  );
}
