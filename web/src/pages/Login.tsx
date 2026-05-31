import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import { ApiError, login } from "../api/client";
import { notifyAuthChange } from "../auth";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      notifyAuthChange();
      navigate("/");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `Login failed (${err.status})`
          : "Login failed";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Center h="100vh" p="md">
      <Paper withBorder shadow="sm" p="xl" radius="md" w={360}>
        <form onSubmit={onSubmit}>
          <Stack>
            <Title order={3} ta="center">
              Sign in
            </Title>
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
              autoFocus
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
            />
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
