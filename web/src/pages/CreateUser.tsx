import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  CloseButton,
  Code,
  Container,
  CopyButton,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconMail } from "@tabler/icons-react";
import { hasLength, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createUser, isAdmin, type UserRole } from "../api/client";
import { generatePassword } from "../utils/password";
import { saveErrorMessage } from "../utils/saveError";

type FormValues = {
  name: string;
  email: string;
  role: UserRole;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set on successful creation; the confirmation modal is the ONLY place this password ever
  // appears (the server stores just a bcrypt hash), so closing the modal discards it for good.
  const [created, setCreated] = useState<{ email: string; name: string; password: string } | null>(
    null,
  );

  const form = useForm<FormValues>({
    initialValues: { name: "", email: "", role: "USER" },
    validate: {
      name: hasLength({ min: 1, max: 50 }, t("users.validation.nameLength")),
      email: (value) => {
        if (!value) return t("users.validation.emailRequired");
        if (!EMAIL_RE.test(value)) return t("users.validation.emailInvalid");
        if (value.length > 254) return t("users.validation.emailTooLong");
        return null;
      },
      role: (value) => (value === "USER" || value === "ADMIN" ? null : t("users.validation.roleRequired")),
    },
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    const password = generatePassword();
    try {
      await createUser({ ...values, password });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      setCreated({ email: values.email, name: values.name, password });
    } catch (err) {
      // A duplicate email is a field-level problem, not a page-level one.
      if (err instanceof ApiError && err.status === 409) {
        form.setFieldError("email", t("users.emailAlreadyInUse"));
      } else {
        setError(
          saveErrorMessage(err, t, {
            forbidden: "users.noPermissionCreate",
            failedStatus: "users.createFailedStatus",
            failed: "users.createFailedNetwork",
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function closeConfirmation() {
    setCreated(null);
    navigate("/users", { replace: true });
  }

  // Pre-filled onboarding draft for the admin's local mail client. Built entirely client-side —
  // the password never travels anywhere until the admin actually hits Send in their mail app.
  // RFC 6068: the recipient's "@" must stay literal (clients don't decode %40 in the To field);
  // everything else in the address is percent-encoded as usual.
  const mailtoHref = created
    ? `mailto:${encodeURIComponent(created.email).replace(/%40/g, "@")}` +
      `?subject=${encodeURIComponent(t("users.onboardingEmailSubject"))}` +
      `&body=${encodeURIComponent(
        t("users.onboardingEmailBody", {
          name: created.name,
          url: window.location.origin,
          password: created.password,
          // RFC 6068 mandates CRLF line breaks in mailto bodies.
        }).replace(/\n/g, "\r\n"),
      )}`
    : undefined;

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

      {/* One-time password reveal. Deliberate close only (no click-outside / Escape) so the
          password can't be lost by accident — after closing it is unrecoverable by design. */}
      <Modal
        opened={created !== null}
        onClose={closeConfirmation}
        title={t("users.createdTitle")}
        centered
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        {created && (
          <Stack gap="md">
            <Text>{t("users.generatedPasswordNote", { email: created.email })}</Text>
            <Group gap="sm" wrap="nowrap">
              <Code fz="md" px="sm" py={6} style={{ flex: 1, userSelect: "all" }}>
                {created.password}
              </Code>
              <CopyButton value={created.password}>
                {({ copied, copy }) => (
                  <Button variant="light" onClick={copy}>
                    {copied ? t("users.passwordCopied") : t("users.copyPassword")}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Group justify="space-between">
              <Button component="a" href={mailtoHref} variant="light" leftSection={<IconMail size={16} />}>
                {t("users.composeOnboardingEmail")}
              </Button>
              <Button onClick={closeConfirmation}>{t("common.action.close")}</Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Container>
  );
}
