import { useState } from "react";
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
  Container,
  Group,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { hasLength, matchesField, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, changeUserPassword, getUser, isAdmin } from "../api/client";

type FormValues = {
  password: string;
  confirmPassword: string;
};

export default function ChangeUserPassword() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { password: "", confirmPassword: "" },
    validate: {
      password: hasLength({ min: 8 }, "Password must be at least 8 characters"),
      confirmPassword: matchesField("password", "Passwords do not match"),
    },
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit({ confirmPassword: _confirm, ...values }: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await changeUserPassword(id, values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      navigate("/users", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to change this user's password.");
        } else if (err.status === 404) {
          setError("User no longer exists.");
        } else {
          setError(`Change failed (${err.status})`);
        }
      } else {
        setError("Change failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>Change password</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                User not found.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/users" variant="default">
                  Back to users
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                Failed to load user
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/users" variant="default">
                  Back to users
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                {data && (
                  <Text c="dimmed" size="sm">
                    Set a new password for {data.name} ({data.email}).
                  </Text>
                )}
                <PasswordInput
                  label="New password"
                  autoFocus
                  autoComplete="new-password"
                  {...form.getInputProps("password")}
                />
                <PasswordInput
                  label="Confirm password"
                  autoComplete="new-password"
                  {...form.getInputProps("confirmPassword")}
                />
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <Group justify="flex-end" gap="sm">
                  <Button component={RouterLink} to="/users" variant="default">
                    Cancel
                  </Button>
                  <Button type="submit" loading={submitting}>
                    Change password
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
