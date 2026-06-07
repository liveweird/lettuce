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
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getUser,
  isAdmin,
  updateUser,
  type UserRole,
} from "../api/client";

type FormValues = {
  name: string;
  email: string;
  role: UserRole;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditUser() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", email: "", role: "USER" },
    validate: {
      name: hasLength({ min: 1, max: 50 }, "Name must be 1–50 characters"),
      email: (value) => {
        if (!value) return "Email is required";
        if (!EMAIL_RE.test(value)) return "Enter a valid email";
        if (value.length > 254) return "Email is too long";
        return null;
      },
      role: (value) => (value === "USER" || value === "ADMIN" ? null : "Role is required"),
    },
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      form.initialize({ name: data.name, email: data.email, role: data.role });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateUser(id, values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      navigate("/users", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          form.setFieldError("email", "Email already in use");
        } else if (err.status === 403) {
          setError("You don't have permission to edit this user.");
        } else if (err.status === 404) {
          setError("User no longer exists.");
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
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>Edit user</Title>
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
                <TextInput
                  label="Name"
                  autoFocus
                  maxLength={50}
                  {...form.getInputProps("name")}
                />
                <TextInput
                  label="Email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  {...form.getInputProps("email")}
                />
                <Select
                  label="Role"
                  data={[
                    { value: "USER", label: "User" },
                    { value: "ADMIN", label: "Admin" },
                  ]}
                  allowDeselect={false}
                  {...form.getInputProps("role")}
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
