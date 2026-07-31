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
  Paper,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getUser,
  isAdmin,
  updateUser,
  type UserRole,
} from "../api/client";
import RolesMultiSelect from "../components/RolesMultiSelect";
import { saveErrorMessage } from "../utils/saveError";

type FormValues = {
  name: string;
  email: string;
  roles: UserRole[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EditUser() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", email: "", roles: [] },
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
      form.initialize({ name: data.name, email: data.email, roles: [...data.roles] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/users" replace />;
  if (!idIsValid) return <Navigate to="/users" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateUser(id, values);
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.invalidateQueries({ queryKey: ["user", id] });
      navigate("/users", { replace: true });
    } catch (err) {
      // A duplicate email is a field-level problem, not a page-level one.
      if (err instanceof ApiError && err.status === 409) {
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
    <Container size="xs" px={0}>
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
                {t("users.loadUserFailed")}
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
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
                <RolesMultiSelect {...form.getInputProps("roles")} />
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
