import { charCountDescription } from "../utils/charCount";
import {
  isUniqueIdConflict,
  MAX_EMAIL_LENGTH,
  MAX_UNIQUE_ID_LENGTH,
  MAX_USER_NAME_LENGTH,
} from "../utils/userForm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  CloseButton,
  Container,
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
import { ApiError } from "../api/http";
import { isAdmin, type UserRole } from "../api/session";
import { createUser } from "../api/users";
import { NATIVE_LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type SupportedLanguage } from "../i18n";
import RevealablePassword from "../components/RevealablePassword";
import RolesMultiSelect from "../components/RolesMultiSelect";
import { generatePassword } from "../utils/password";
import { saveErrorMessage } from "../utils/saveError";

type FormValues = {
  name: string;
  email: string;
  roles: UserRole[];
  // Sent only when non-blank (trimmed) — optional, but admins should assign one ASAP
  // (the users list flags the missing state).
  uniqueId: string;
  // The new user's language (v2.21.0) — drives their UI at sign-in and every email sent to
  // them; they can change it themselves later via the header switcher.
  language: SupportedLanguage;
  // No career fields (v2.15.0): a new user's career history starts empty — their management
  // chain records positions on /users/:id/career.
};

// Linear-time (no ambiguous backtracking): dot-separated domain labels may not contain dots.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

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

  const form = useForm<FormValues>({
    // Roles hold only ADDITIONAL privileges — a new user starts as a plain user (empty set).
    initialValues: {
      name: "",
      email: "",
      roles: [],
      uniqueId: "",
      language: "en",
    },
    validate: {
      name: hasLength({ min: 1, max: 50 }, t("users.validation.nameLength")),
      email: (value) => {
        if (!value) return t("users.validation.emailRequired");
        if (!EMAIL_RE.test(value)) return t("users.validation.emailInvalid");
        if (value.length > 254) return t("users.validation.emailTooLong");
        return null;
      },
    },
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
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
      await queryClient.invalidateQueries({ queryKey: ["users"] });
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
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>{t("users.createUser")}</Title>
            <TextInput
              label={t("common.field.name")}
              autoFocus
              maxLength={MAX_USER_NAME_LENGTH}
              description={charCountDescription(form.values.name.length, MAX_USER_NAME_LENGTH)}
              inputWrapperOrder={["label", "input", "description", "error"]}
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
              maxLength={MAX_EMAIL_LENGTH}
              description={charCountDescription(form.values.email.length, MAX_EMAIL_LENGTH)}
              inputWrapperOrder={["label", "input", "description", "error"]}
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
            <TextInput
              label={t("users.uniqueId")}
              maxLength={MAX_UNIQUE_ID_LENGTH}
              // The counter takes over the description slot near the cap (the name idiom);
              // otherwise the slot explains the set-once semantics.
              description={
                charCountDescription(form.values.uniqueId.length, MAX_UNIQUE_ID_LENGTH) ??
                t("users.uniqueIdHint")
              }
              inputWrapperOrder={["label", "input", "description", "error"]}
              {...form.getInputProps("uniqueId")}
            />
            <RolesMultiSelect {...form.getInputProps("roles")} />
            <Select
              label={t("common.language.label")}
              description={t("users.languageHint")}
              data={SUPPORTED_LANGUAGES.map((lng) => ({
                value: lng,
                label: NATIVE_LANGUAGE_NAMES[lng],
              }))}
              allowDeselect={false}
              {...form.getInputProps("language")}
            />
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
