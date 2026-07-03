import { lazy, Suspense, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
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
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createTemplate, isAdmin } from "../api/client";

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
      navigate("/templates", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          form.setFieldError("name", t("templates.nameExists"));
        } else if (err.status === 403) {
          setError(t("templates.createForbidden"));
        } else if (err.status === 400) {
          setError(t("templates.validationError"));
        } else {
          setError(t("templates.createFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("templates.createFailedNetwork"));
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
              <Button component={RouterLink} to="/templates" variant="default">
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
