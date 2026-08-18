import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { templateFormValidation, type TemplateFormValues } from "../utils/templateForm";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { createTemplate } from "../api/templates";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "../components/ConfirmActionModal";
import TemplateFormFields from "../components/TemplateFormFields";
import { saveErrorMessage } from "../utils/saveError";

export default function CreateTemplate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  // The shared form vocabulary (utils/templateForm.ts).
  const form = useForm<TemplateFormValues>({
    initialValues: { name: "", content: "" },
    validate: templateFormValidation(t),
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
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>{t("templates.create")}</Title>
            <TemplateFormFields form={form} />
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
        title={t("templates.discardTitle")}
        message={t("templates.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo="/templates"
      />
    </Container>
  );
}
