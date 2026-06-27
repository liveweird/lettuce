import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { hasLength, matchesField, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createUser, isAdmin, type UserRole } from "../api/client";

type FormValues = {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: UserRole;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", email: "", password: "", confirmPassword: "", role: "USER" },
    validate: {
      name: hasLength({ min: 1, max: 50 }, t("users.validation.nameLength")),
      email: (value) => {
        if (!value) return t("users.validation.emailRequired");
        if (!EMAIL_RE.test(value)) return t("users.validation.emailInvalid");
        if (value.length > 254) return t("users.validation.emailTooLong");
        return null;
      },
      password: hasLength({ min: 8 }, t("users.validation.passwordLength")),
      confirmPassword: matchesField("password", t("users.validation.passwordsMismatch")),
      role: (value) => (value === "USER" || value === "ADMIN" ? null : t("users.validation.roleRequired")),
    },
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onSubmit({ confirmPassword: _confirm, ...values }: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createUser(values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      navigate("/users", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          form.setFieldError("email", t("users.emailAlreadyInUse"));
        } else if (err.status === 403) {
          setError(t("users.noPermissionCreate"));
        } else {
          setError(t("users.createFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("users.createFailedNetwork"));
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
            <Title order={2}>{t("users.createUser")}</Title>
            <TextInput
              label={t("common.field.name")}
              autoFocus
              maxLength={50}
              rightSection={
                form.values.name ? (
                  <CloseButton
                    size="sm"
                    aria-label={t("users.clearName")}
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
              label={t("common.field.email")}
              type="email"
              autoComplete="email"
              maxLength={254}
              rightSection={
                form.values.email ? (
                  <CloseButton
                    size="sm"
                    aria-label={t("users.clearEmail")}
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
              label={t("common.field.role")}
              data={[
                { value: "USER", label: t("common.role.USER") },
                { value: "ADMIN", label: t("common.role.ADMIN") },
              ]}
              allowDeselect={false}
              {...form.getInputProps("role")}
            />
            <PasswordInput
              label={t("users.password")}
              autoComplete="new-password"
              {...form.getInputProps("password")}
            />
            <PasswordInput
              label={t("users.confirmPassword")}
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
