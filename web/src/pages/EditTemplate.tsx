import { lazy, Suspense, useEffect, useState } from "react";
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
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { charCountDescription } from "../utils/charCount";
import { MAX_TEMPLATE_CONTENT_LENGTH, MAX_TEMPLATE_NAME_LENGTH } from "../utils/templateForm";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { getTemplate, updateTemplate } from "../api/templates";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { saveErrorMessage } from "../utils/saveError";

const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

type FormValues = {
  name: string;
  content: string;
};

export default function EditTemplate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", content: "" },
    validate: {
      name: hasLength({ min: 1, max: MAX_TEMPLATE_NAME_LENGTH }, t("templates.nameLength")),
      // The editor hard-caps typing; this catches pre-limit legacy rows loaded for editing.
      content: (v) =>
        v.length > MAX_TEMPLATE_CONTENT_LENGTH
          ? t("templates.contentLength")
          : null,
    },
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["template", id],
    queryFn: () => getTemplate(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      form.initialize({ name: data.name, content: data.content });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/templates" replace />;
  if (!idIsValid) return <Navigate to="/templates" replace />;

  async function onSubmit(values: FormValues) {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateTemplate(id, { name: values.name, content: values.content });
      await queryClient.invalidateQueries({ queryKey: ["templates"] });
      await queryClient.invalidateQueries({ queryKey: ["template", id] });
      showSuccessToast(t("templates.toast.updated"));
      navigate("/templates", { replace: true });
    } catch (err) {
      // A duplicate name is a field-level problem, not a page-level one.
      if (err instanceof ApiError && err.status === 409) {
        form.setFieldError("name", t("templates.nameExists"));
      } else {
        setError(
          saveErrorMessage(err, t, {
            forbidden: "templates.editForbidden",
            notFound: "templates.templateGone",
            invalid: "templates.validationError",
            failedStatus: "templates.editFailedStatus",
            failed: "templates.editFailedNetwork",
          }),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("templates.edit")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                {t("templates.notFound")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  {t("templates.backToTemplates")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("templates.loadOneFailed", {
                  suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                })}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  {t("templates.backToTemplates")}
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                <TextInput
                  label={t("common.field.name")}
                  autoFocus
                  maxLength={MAX_TEMPLATE_NAME_LENGTH}
              description={charCountDescription(form.values.name.length, MAX_TEMPLATE_NAME_LENGTH)}
              inputWrapperOrder={["label", "input", "description", "error"]}
                  rightSection={
                    form.values.name ? (
                      <CloseButton
                        size="sm"
                        aria-label={t("templates.clearName")}
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => form.setFieldValue("name", "")}
                      />
                    ) : null
                  }
                  rightSectionPointerEvents="auto"
                  {...form.getInputProps("name")}
                />
                <Suspense fallback={<Skeleton height={220} radius="sm" />}>
                  <MarkdownEditor
                    label={t("common.field.content")}
                    placeholder={t("templates.contentPlaceholder")}
                    maxLength={MAX_TEMPLATE_CONTENT_LENGTH}
                    value={form.values.content}
                    onChange={(md) => form.setFieldValue("content", md)}
                  />
                </Suspense>
                {form.errors.content && (
                  <Text size="sm" c="red">
                    {form.errors.content}
                  </Text>
                )}
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <Group justify="flex-end" gap="sm">
                  <Button type="button" variant="default" onClick={openCancel}>
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

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("templates.discardTitle")}
        message={t("templates.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo="/templates"
      />
    </Container>
  );
}
