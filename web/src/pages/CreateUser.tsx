import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createUser, isAdmin, type UserRole } from "../api/client";

type FormValues = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateUser() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", email: "", password: "", role: "USER" },
    validate: {
      name: hasLength({ min: 1, max: 50 }, "Name must be 1–50 characters"),
      email: (value) => {
        if (!value) return "Email is required";
        if (!EMAIL_RE.test(value)) return "Enter a valid email";
        if (value.length > 254) return "Email is too long";
        return null;
      },
      password: hasLength({ min: 8 }, "Password must be at least 8 characters"),
      role: (value) => (value === "USER" || value === "ADMIN" ? null : "Role is required"),
    },
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createUser(values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      navigate("/users", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          form.setFieldError("email", "Email already in use");
        } else if (err.status === 403) {
          setError("You don't have permission to create users.");
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
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>Create user</Title>
            <TextInput
              label="Name"
              autoFocus
              maxLength={50}
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
            <TextInput
              label="Email"
              type="email"
              autoComplete="email"
              maxLength={254}
              rightSection={
                form.values.email ? (
                  <CloseButton
                    size="sm"
                    aria-label="Clear email"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => form.setFieldValue("email", "")}
                  />
                ) : null
              }
              rightSectionPointerEvents="auto"
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
            <PasswordInput
              label="Password"
              autoComplete="new-password"
              {...form.getInputProps("password")}
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
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
