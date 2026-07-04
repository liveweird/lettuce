import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { ApiError, changeUserPassword, getUser, getUserId, isAdmin } from "../api/client";

type FormValues = {
  currentPassword: string;
  password: string;
  confirmPassword: string;
};

export default function ChangeUserPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();
  const isSelf = currentUserId !== null && currentUserId === id;

  const form = useForm<FormValues>({
    initialValues: { currentPassword: "", password: "", confirmPassword: "" },
    validate: {
      // Changing one's OWN password requires the current one (the backend enforces it too);
      // an admin resetting another user's password does not.
      currentPassword: (value) =>
        isSelf && value.length === 0 ? t("users.validation.currentPasswordRequired") : null,
      password: hasLength({ min: 10 }, t("users.validation.passwordLength")),
      confirmPassword: matchesField("password", t("users.validation.passwordsMismatch")),
    },
  });
  const canChange = isAdmin() || isSelf;
  const returnTo = isAdmin() ? "/users" : "/";

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && canChange,
    retry: false,
  });

  if (!canChange) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit({ confirmPassword: _confirm, currentPassword, password }: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await changeUserPassword(id, isSelf ? { password, currentPassword } : { password });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          // For a self-change a 403 means the current password didn't verify.
          setError(isSelf ? t("users.wrongCurrentPassword") : t("users.noPermissionChangePassword"));
        } else if (err.status === 404) {
          setError(t("users.userNoLongerExists"));
        } else {
          setError(t("users.changeFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("users.changeFailedNetwork"));
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
          <Title order={2}>{t("users.changePassword")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                {t("users.userNotFound")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("users.backToUsers")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("users.loadUserFailed")}
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("users.backToUsers")}
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                {data && (
                  <Text c="dimmed" size="sm">
                    {t("users.setNewPassword", { name: data.name, email: data.email })}
                  </Text>
                )}
                {isSelf && (
                  <PasswordInput
                    label={t("users.currentPassword")}
                    autoFocus
                    autoComplete="current-password"
                    {...form.getInputProps("currentPassword")}
                  />
                )}
                <PasswordInput
                  label={t("users.newPassword")}
                  autoFocus={!isSelf}
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
                  <Button component={RouterLink} to={returnTo} variant="default">
                    {t("common.action.cancel")}
                  </Button>
                  <Button type="submit" loading={submitting}>
                    {t("users.changePassword")}
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
