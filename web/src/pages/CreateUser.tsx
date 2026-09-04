import {
  emptyUserFormValues,
  isUniqueIdConflict,
  userFormValidation,
  type UserFormValues,
} from "../utils/userForm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { IconMail } from "@tabler/icons-react";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { createUser } from "../api/users";
import { type SupportedLanguage } from "../i18n";
import ConfirmActionModal from "../components/ConfirmActionModal";
import FormFooter from "../components/FormFooter";
import PageHeader from "../components/PageHeader";
import RevealablePassword from "../components/RevealablePassword";
import UserFormFields from "../components/UserFormFields";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { generatePassword } from "../utils/password";
import { saveErrorMessage } from "../utils/saveError";
import { invalidateUser } from "../utils/userQueries";

export default function CreateUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set on successful creation; the confirmation modal is the ONLY place this password ever
  // appears (the server stores just a bcrypt hash), so closing the modal discards it for good.
  const [sendEmail, setSendEmail] = useState(false);
  const [created, setCreated] = useState<{
    email: string;
    name: string;
    password: string;
    emailSent: boolean | null;
    language: SupportedLanguage;
  } | null>(null);

  // The shared form vocabulary (utils/userForm.ts); the allowance field stays inert here —
  // it is edit-only, never rendered or submitted by the create page.
  const form = useForm<UserFormValues>({
    initialValues: emptyUserFormValues(),
    validate: userFormValidation(t),
  });
  const { requestCancel, modalProps } = useDiscardGuard({ isDirty: () => form.isDirty(), to: "/users" });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onSubmit(values: UserFormValues) {
    setError(null);
    setSubmitting(true);
    const password = generatePassword();
    try {
      const res = await createUser({
        name: values.name,
        email: values.email,
        roles: values.roles,
        password,
        sendEmail,
        language: values.language,
        ...(values.uniqueId.trim() !== "" ? { uniqueId: values.uniqueId.trim() } : {}),
      });
      await invalidateUser(queryClient);
      setCreated({
        email: values.email,
        name: values.name,
        password,
        emailSent: res.emailSent ?? null,
        language: values.language,
      });
    } catch (err) {
      // A duplicate email or unique id is a field-level problem, not a page-level one —
      // the ProblemDetail detail decides which field (both clashes share the 409).
      if (isUniqueIdConflict(err)) {
        form.setFieldError("uniqueId", t("users.uniqueIdAlreadyInUse"));
      } else if (err instanceof ApiError && err.status === 409) {
        form.setFieldError("email", t("users.emailAlreadyInUse"));
      } else if (err instanceof ApiError && err.status === 503) {
        // Deployment without outbound email — outside saveErrorMessage's vocabulary.
        setError(t("users.emailOptionUnavailable"));
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
  // NOTE: the mass import has a SERVER-side sibling of this message (users/WelcomeEmail.kt);
  // keep the two texts (users.onboardingEmailSubject/Body here) aligned when editing either.
  // RFC 6068: the recipient's "@" must stay literal (clients don't decode %40 in the To field);
  // everything else in the address is percent-encoded as usual.
  // Rendered in the NEW USER'S language (v2.21.0 — matching the server's welcome email rule),
  // not the admin's UI language: i18next's per-call lng override.
  const mailtoHref = created
    ? `mailto:${encodeURIComponent(created.email).replace(/%40/g, "@")}` +
      `?subject=${encodeURIComponent(t("users.onboardingEmailSubject", { lng: created.language }))}` +
      `&body=${encodeURIComponent(
        t("users.onboardingEmailBody", {
          lng: created.language,
          name: created.name,
          url: window.location.origin,
          password: created.password,
          // RFC 6068 mandates CRLF line breaks in mailto bodies.
        }).replace(/\n/g, "\r\n"),
      )}`
    : undefined;

  return (
    <Container size="sm" px={0}>
      <Stack gap="md">
        <PageHeader title={t("users.createUser")} />
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit(onSubmit)} noValidate>
            <Stack>
              <UserFormFields form={form} />
              <Checkbox
                label={t("users.createSendEmail")}
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.currentTarget.checked)}
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
                  {t("common.action.create")}
                </Button>
              </FormFooter>
            </Stack>
          </form>
        </Paper>
      </Stack>

      <ConfirmActionModal {...modalProps} />

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
            <RevealablePassword password={created.password} copyLabel={t("users.copyPassword")} />
            {created.emailSent === true && (
              <Alert color="teal" variant="light">
                {t("users.credentialsEmailed", { email: created.email })}
              </Alert>
            )}
            {created.emailSent === false && (
              <Alert color="orange" variant="light">
                {t("users.credentialsEmailFailed")}
              </Alert>
            )}
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
