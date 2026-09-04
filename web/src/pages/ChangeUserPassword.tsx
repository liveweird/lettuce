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
  Loader,
  Paper,
  PasswordInput,
  Stack,
} from "@mantine/core";
import { matchesField, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { getUserId, isAdmin } from "../api/session";
import { changeUserPassword, getUser } from "../api/users";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "../components/ConfirmActionModal";
import FormFooter from "../components/FormFooter";
import PageHeader from "../components/PageHeader";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { saveErrorMessage } from "../utils/saveError";
import { MAX_PASSWORD_BYTES, utf8ByteLength } from "../utils/userForm";
import { invalidateUser } from "../utils/userQueries";

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
      password: (value) => {
        if (value.length < 10) return t("users.validation.passwordLength");
        // bcrypt's ceiling is 71 UTF-8 BYTES — reachable under 71 chars with non-Latin input.
        if (utf8ByteLength(value) > MAX_PASSWORD_BYTES) {
          return t("users.validation.passwordTooLong", { max: MAX_PASSWORD_BYTES });
        }
        return null;
      },
      confirmPassword: matchesField("password", t("users.validation.passwordsMismatch")),
    },
  });
  const canChange = isAdmin() || isSelf;
  const returnTo = isAdmin() ? "/users" : "/";
  const { requestCancel, modalProps } = useDiscardGuard({ isDirty: () => form.isDirty(), to: returnTo });

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
      await invalidateUser(queryClient, id);
      showSuccessToast(t("users.toast.passwordChanged"));
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          // For a self-change a 403 means the current password didn't verify.
          forbidden: isSelf ? "users.wrongCurrentPassword" : "users.noPermissionChangePassword",
          notFound: "users.userNoLongerExists",
          failedStatus: "users.changeFailedStatus",
          failed: "users.changeFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="sm" px={0}>
      <Stack gap="md">
        {/* The header's description names the account once it is known (the former lead-in). */}
        <PageHeader
          title={t("users.changePassword")}
          description={data ? t("users.setNewPassword", { name: data.name, email: data.email }) : undefined}
        />
        <Paper withBorder shadow="sm" p="xl" radius="md">
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <Stack>
              <Alert color="red" variant="light">
                {t("users.userNotFound")}
              </Alert>
              <FormFooter>
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("users.backToUsers")}
                </Button>
              </FormFooter>
            </Stack>
          ) : isError ? (
            <Stack>
              <Alert color="red" variant="light">
                {t("users.loadUserFailed", {
                  suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                })}
              </Alert>
              <FormFooter>
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("users.backToUsers")}
                </Button>
              </FormFooter>
            </Stack>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
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
                <FormFooter>
                  <Button type="button" variant="default" onClick={requestCancel}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button type="submit" loading={submitting}>
                    {t("users.changePassword")}
                  </Button>
                </FormFooter>
              </Stack>
            </form>
          )}
        </Paper>
      </Stack>

      <ConfirmActionModal {...modalProps} />
    </Container>
  );
}
