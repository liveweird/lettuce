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
  Typography,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
    <Container size="lg" px={0}>
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
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Textarea
                label="Content"
                autosize
                minRows={6}
                {...form.getInputProps("content")}
              />
              <Input.Wrapper label="Preview">
                <Box
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-default)",
                    padding: "var(--mantine-spacing-sm)",
                    minHeight: "calc(6lh + 2 * var(--mantine-spacing-sm))",
                    overflow: "auto",
                  }}
                >
                  <Typography>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {form.values.content}
                    </ReactMarkdown>
                  </Typography>
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
