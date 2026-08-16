import { charCountDescription } from "../utils/charCount";
import {
  isUniqueIdConflict,
  MAX_EMAIL_LENGTH,
  MAX_UNIQUE_ID_LENGTH,
  MAX_USER_NAME_LENGTH,
} from "../utils/userForm";
import { useEffect, useState } from "react";
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
  CloseButton,
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin, type UserRole } from "../api/session";
import { getUser, updateUser } from "../api/users";
import { showSuccessToast } from "../utils/toast";
import RolesMultiSelect from "../components/RolesMultiSelect";
import { saveErrorMessage } from "../utils/saveError";

type FormValues = {
  name: string;
  email: string;
  roles: UserRole[];
  // The career triple left this form in v2.15.0 — it lives on /users/:id/career now,
  // managed by the person's management chain, not by admins.
  // Whole days ("" = unset). Sent only when set — omitting encodes "leave unchanged",
  // so clearing a set allowance is inexpressible client-side too.
  paidDaysOffAllowance: number | "";
  // Sent only when non-blank (trimmed) — the allowance semantics: emptying the field
  // leaves the server value unchanged, clearing a set id is inexpressible.
  uniqueId: string;
};

// Linear-time (no ambiguous backtracking): dot-separated domain labels may not contain dots.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export default function EditUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: {
      name: "",
      email: "",
      roles: [],
      paidDaysOffAllowance: "",
      uniqueId: "",
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

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      form.initialize({
        name: data.name,
        email: data.email,
        roles: [...data.roles],
        paidDaysOffAllowance: data.paidDaysOffAllowance ?? "",
        uniqueId: data.uniqueId ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateUser(id, {
        name: values.name,
        email: values.email,
        roles: values.roles,
        ...(values.paidDaysOffAllowance !== ""
          ? { paidDaysOffAllowance: values.paidDaysOffAllowance }
          : {}),
        ...(values.uniqueId.trim() !== "" ? { uniqueId: values.uniqueId.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      showSuccessToast(t("users.toast.updated"));
      navigate("/users", { replace: true });
    } catch (err) {
      // A duplicate email or unique id is a field-level problem, not a page-level one —
      // the ProblemDetail detail decides which field (both clashes share the 409).
      if (isUniqueIdConflict(err)) {
        form.setFieldError("uniqueId", t("users.uniqueIdAlreadyInUse"));
      } else if (err instanceof ApiError && err.status === 409) {
        form.setFieldError("email", t("users.emailAlreadyInUse"));
      } else {
        setError(
          saveErrorMessage(err, t, {
            forbidden: "users.noPermissionEdit",
            notFound: "users.userNoLongerExists",
            failedStatus: "users.editFailedStatus",
            failed: "users.editFailedNetwork",
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("users.editUser")}</Title>
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
                <Button component={RouterLink} to="/users" variant="default">
                  {t("users.backToUsers")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("users.loadUserFailed", {
                  suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                })}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/users" variant="default">
                  {t("users.backToUsers")}
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
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
                <NumberInput
                  label={t("users.paidDaysOffAllowance")}
                  description={t("users.paidDaysOffAllowanceHint")}
                  min={0}
                  max={365}
                  allowDecimal={false}
                  clampBehavior="strict"
                  {...form.getInputProps("paidDaysOffAllowance")}
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
                    {t("common.action.save")}
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
