import {
  isUniqueIdConflict,
  userFormValidation,
  type UserFormValues,
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
  Container,
  Group,
  Loader,
  NumberInput,
  Paper,
  Stack,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { getUserId, isAdmin } from "../api/session";
import { getUser, setUserLanguage, updateUser } from "../api/users";
import i18n, { asSupportedLanguage } from "../i18n";
import { showSuccessToast } from "../utils/toast";
import UserFormFields from "../components/UserFormFields";
import { saveErrorMessage } from "../utils/saveError";
import { invalidateUser } from "../utils/userQueries";

export default function EditUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The shared form vocabulary (utils/userForm.ts) — the language rides its own endpoint
  // (v2.21.0), never the whole-user PUT (see onSubmit).
  const form = useForm<UserFormValues>({
    initialValues: {
      name: "",
      email: "",
      roles: [],
      paidDaysOffAllowance: "",
      uniqueId: "",
      language: "en",
    },
    validate: userFormValidation(t),
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
        language: asSupportedLanguage(data.language),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit(values: UserFormValues) {
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
      // The language rides its own endpoint (v2.21.0) — saved only when actually changed,
      // AFTER the main update so a failed save never half-applies.
      if (data && values.language !== asSupportedLanguage(data.language)) {
        await setUserLanguage(id, values.language);
        // Editing one's own account applies the language immediately (the features self-edit
        // precedent); others pick it up at their next sign-in or token refresh.
        if (getUserId() === id) void i18n.changeLanguage(values.language);
      }
      await invalidateUser(queryClient, id);
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
                <UserFormFields form={form} />
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
