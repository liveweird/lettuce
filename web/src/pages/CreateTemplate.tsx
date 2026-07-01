import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CloseButton,
  Container,
  Group,
  Input,
  Paper,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createTemplate, isAdmin } from "../api/client";
import MarkdownView from "../components/MarkdownView";

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
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Textarea
                label={t("common.field.content")}
                autosize
                minRows={6}
                {...form.getInputProps("content")}
              />
              <Input.Wrapper label={t("common.field.preview")}>
                <Box
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-default)",
                    padding: "var(--mantine-spacing-sm)",
                    minHeight: "calc(6lh + 2 * var(--mantine-spacing-sm))",
                    overflow: "auto",
                  }}
                >
                  <MarkdownView>{form.values.content}</MarkdownView>
                </Box>
              </Input.Wrapper>
            </SimpleGrid>
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
