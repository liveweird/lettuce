import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Button, Container, Paper, Stack } from "@mantine/core";
import { useForm } from "@mantine/form";
import { templateFormValidation, type TemplateFormValues } from "../utils/templateForm";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { createTemplate } from "../api/templates";
import { showSuccessToast } from "../utils/toast";
import DiscardGuard from "../components/DiscardGuard";
import FormFooter from "../components/FormFooter";
import PageHeader from "../components/PageHeader";
import TemplateFormFields from "../components/TemplateFormFields";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { saveErrorMessage } from "../utils/saveError";

export default function CreateTemplate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The shared form vocabulary (utils/templateForm.ts).
  const form = useForm<TemplateFormValues>({
    initialValues: { name: "", content: "" },
    validate: templateFormValidation(t),
  });
  const { requestCancel, guardProps } = useDiscardGuard({
    isDirty: () => form.isDirty(),
    to: "/templates",
    title: t("templates.discardTitle"),
    message: t("templates.discardMessage"),
  });

  if (!isAdmin()) return <Navigate to="/templates" replace />;

  async function onSubmit(values: TemplateFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createTemplate({ name: values.name, content: values.content });
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      showSuccessToast(t("templates.toast.created"));
      navigate("/templates", { replace: true });
    } catch (err) {
      // A duplicate name is a field-level problem, not a page-level one.
      if (err instanceof ApiError && err.status === 409) {
        form.setFieldError("name", t("templates.nameExists"));
      } else {
        setError(
          saveErrorMessage(err, t, {
            forbidden: "templates.createForbidden",
            invalid: "templates.validationError",
            failedStatus: "templates.createFailedStatus",
            failed: "templates.createFailedNetwork",
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader title={t("templates.create")} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit(onSubmit)} noValidate>
            <Stack>
              <TemplateFormFields form={form} />
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

      <DiscardGuard {...guardProps} />
    </>
  );
}
