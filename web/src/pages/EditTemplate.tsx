import { useEffect, useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getTemplate, isAdmin, updateTemplate } from "../api/client";

type FormValues = {
  name: string;
  content: string;
};

export default function EditTemplate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", content: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, "Name must be 1–100 characters"),
    },
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["template", id],
    queryFn: () => getTemplate(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      form.initialize({ name: data.name, content: data.content });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/templates" replace />;
  if (!idIsValid) return <Navigate to="/templates" replace />;

  async function onSubmit(values: FormValues) {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateTemplate(id, { name: values.name, content: values.content });
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", id] });
      navigate("/templates", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          form.setFieldError("name", "A template with this name already exists.");
        } else if (err.status === 403) {
          setError("You don't have permission to edit this template.");
        } else if (err.status === 404) {
          setError("Template no longer exists.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Edit failed (${err.status})`);
        }
      } else {
        setError("Edit failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>Edit template</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                Template not found.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  Back to templates
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                Failed to load template
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  Back to templates
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
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
                    Save
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
