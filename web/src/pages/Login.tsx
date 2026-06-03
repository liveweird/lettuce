import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
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

type LocationState = { from?: { pathname?: string } } | null;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signedOut, setSignedOut] = useState<boolean>(() => consumeSignedOut());

  const form = useForm({
    initialValues: { email: "", password: "" },
    validate: {
      email: isEmail("Enter a valid email"),
      password: isNotEmpty("Password is required"),
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
            ? "Invalid email or password"
            : `Login failed (${err.status})`,
        );
      } else {
        setError("Login failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center h="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w={360}>
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={3} ta="center">
              Sign in
            </Title>
            <TextInput
              label="Email"
              type="email"
              autoFocus
              autoComplete="email"
              {...form.getInputProps("email")}
            />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              {...form.getInputProps("password")}
            />
            {signedOut && !form.isDirty() && !error && (
              <Alert color="blue" variant="light">
                You've been signed out.
              </Alert>
            )}
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Button type="submit" loading={submitting} fullWidth>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
