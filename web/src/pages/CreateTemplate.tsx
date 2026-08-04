import { lazy, Suspense, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Group,
  Paper,
  Skeleton,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createTemplate, isAdmin } from "../api/client";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { saveErrorMessage } from "../utils/saveError";

const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

type FormValues = {
  name: string;
  content: string;
};

export default function CreateTemplate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", content: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, t("templates.nameLength")),
    },
  });

  if (!isAdmin()) return <Navigate to="/templates" replace />;

  async function onSubmit(values: FormValues) {
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
            <TextInput
              label={t("common.field.name")}
              autoFocus
              maxLength={100}
              rightSection={
                form.values.name ? (
                  <CloseButton
                    size="sm"
                    aria-label={t("templates.clearName")}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => form.setFieldValue("name", "")}
                  />
                ) : null
              }
              rightSectionPointerEvents="auto"
              {...form.getInputProps("name")}
            />
            <Suspense fallback={<Skeleton height={220} radius="sm" />}>
              <MarkdownEditor
                label={t("common.field.content")}
                placeholder={t("templates.contentPlaceholder")}
                maxLength={5000}
                value={form.values.content}
                onChange={(md) => form.setFieldValue("content", md)}
              />
            </Suspense>
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
