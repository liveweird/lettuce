import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { isEmail, isNotEmpty, useForm } from "@mantine/form";
import { ApiError, login } from "../api/client";
import { consumeSignedOut, notifyAuthChange } from "../auth";
import BrandLogo from "../components/BrandLogo";
import VersionStamp from "../components/VersionStamp";

type LocationState = { from?: { pathname?: string } } | null;

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedOut, setSignedOut] = useState<boolean>(() => consumeSignedOut());

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: isEmail(t("auth.invalidEmail")),
      password: isNotEmpty(t("auth.passwordRequired")),
    },
  });

  async function onSubmit(values: { email: string; password: string }) {
    setError(null);
    setSignedOut(false);
    setSubmitting(true);
    try {
      await login(values);
      notifyAuthChange();
      const from = (location.state as LocationState)?.from?.pathname;
      navigate(from ?? "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.status === 401
            ? t("auth.invalidCredentials")
            : err.status === 429
              ? t("auth.accountLocked")
              : t("auth.loginFailedStatus", { status: err.status }),
        );
      } else {
        setError(t("auth.loginFailedGeneric"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center h="100vh" p="md">
      <Stack gap="xs">
        <Paper withBorder shadow="sm" p="xl" radius="md" w={360}>
          <form onSubmit={form.onSubmit(onSubmit)} noValidate>
            <Stack>
              {/* Brand block: tell the user what they are signing in to. */}
              <Stack align="center" gap={4}>
                <BrandLogo size={48} />
                <Title order={2}>{t("appShell.brand")}</Title>
              </Stack>
              <Title order={3} ta="center" c="dimmed" fw={500} size="h4">
                {t("auth.signIn")}
              </Title>
              <TextInput
                label={t("common.field.email")}
                type="email"
                autoFocus
                autoComplete="email"
                {...form.getInputProps("email")}
              />
              <PasswordInput
                label={t("auth.password")}
                autoComplete="current-password"
                {...form.getInputProps("password")}
              />
              {signedOut && !form.isDirty() && !error && (
                <Alert color="blue" variant="light">
                  {t("auth.signedOut")}
                </Alert>
              )}
              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}
              <Button type="submit" loading={submitting} fullWidth>
                {t("auth.signIn")}
              </Button>
              <Anchor component={RouterLink} to="/reset-password" size="sm" ta="center">
                {t("auth.forgotPassword")}
              </Anchor>
            </Stack>
          </form>
        </Paper>
        <VersionStamp ta="center" />
      </Stack>
    </Center>
  );
}
