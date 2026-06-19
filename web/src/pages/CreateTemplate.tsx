import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Group,
  Paper,
  Stack,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createTemplate, isAdmin } from "../api/client";

type FormValues = {
  name: string;
  content: string;
};

export default function CreateTemplate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", content: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, "Name must be 1–100 characters"),
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
          form.setFieldError("name", "A template with this name already exists.");
        } else if (err.status === 403) {
          setError("You don't have permission to create templates.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Create failed (${err.status})`);
        }
      } else {
        setError("Create failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>Create template</Title>
            <TextInput
              label="Name"
              autoFocus
              maxLength={100}
              rightSection={
                form.values.name ? (
                  <CloseButton
                    size="sm"
                    aria-label="Clear name"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => form.setFieldValue("name", "")}
                  />
                ) : null
              }
              rightSectionPointerEvents="auto"
              {...form.getInputProps("name")}
            />
            <Textarea
              label="Content"
              autosize
              minRows={6}
              {...form.getInputProps("content")}
            />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="sm">
              <Button component={RouterLink} to="/templates" variant="default">
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
