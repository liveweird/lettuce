import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import DateField from "../components/DateField";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { deleteOneOnOne, getOneOnOne, updateOneOnOne } from "../api/oneonones";
import ActionItemsEditor from "../components/ActionItemsEditor";
import ConfirmActionModal from "../components/ConfirmActionModal";
import OneOnOneHistory from "../components/OneOnOneHistory";
import ParagraphListEditor from "../components/ParagraphListEditor";
import PersonaField from "../components/PersonaField";
import {
  oneOnOneFormValidation,
  oneOnOneSaveErrorMessage,
  toFormValues,
  toUpdateBody,
  type OneOnOneFormValues,
} from "../utils/oneOnOneForm";
import { oneOnOneViewLink } from "../utils/oneOnOneLinks";
import { invalidateOneOnOne } from "../utils/oneOnOneQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

export default function EditOneOnOne() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "managed";
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? `/one-on-ones?tab=${from === "team" ? "team" : "managed"}`;

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const {
    data,
    isLoading,
    isError,
    error: fetchError,
  } = useQuery({
    queryKey: ["oneOnOne", id],
    queryFn: () => getOneOnOne(id),
    enabled: idIsValid,
    retry: false,
  });

  const form = useForm<OneOnOneFormValues>({
    initialValues: { meetingDate: "", points: [], decisions: [], actionItems: [] },
    // Chronological floor: the date may not go below the pair's previous meeting.
    validate: oneOnOneFormValidation(t, data?.minMeetingDate),
  });

  // One-shot: seed the form once the document arrives (initialize is a no-op afterwards).
  if (data && !form.initialized) {
    form.initialize(toFormValues(data));
  }

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("ONE_ON_ONES")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`from` tab / `back`
  // override), so its Close button returns where the user actually started.
  const viewUrl = oneOnOneViewLink(id, from, backOverride ?? undefined);
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && getUserId() !== data.managerId) {
    return <Navigate to={viewUrl} replace />;
  }
  // Older meetings of the pair are immutable records (the server would 409) — only the
  // latest is editable, so anything else opens read-only.
  if (data && data.isLatest === false) {
    return <Navigate to={viewUrl} replace />;
  }

  async function save(values: OneOnOneFormValues) {
    // Belt-and-braces for the chronological rule (the validate rules and the input's `min`
    // usually catch it first; the server 409 is the final backstop).
    if (data?.minMeetingDate != null && values.meetingDate < data.minMeetingDate) {
      form.setFieldError(
        "meetingDate",
        t("oneOnOne.dateBeforePrevious", { date: data.minMeetingDate }),
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await updateOneOnOne(id, toUpdateBody(values));
      await invalidateOneOnOne(queryClient, id);
      showSuccessToast(t("oneOnOne.toast.saved"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(oneOnOneSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await deleteOneOnOne(id);
      await invalidateOneOnOne(queryClient);
      queryClient.removeQueries({ queryKey: ["oneOnOne", id] });
      showSuccessToast(t("oneOnOne.toast.deleted"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(oneOnOneSaveErrorMessage(err, t));
      setDeleting(false);
      closeDelete();
    }
  }

  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const loadErrorMessage =
    errorStatus === 404
      ? t("oneOnOne.error.notFound")
      : errorStatus === 403
        ? t("oneOnOne.error.viewPermission")
        : t("oneOnOne.error.loadFailed");

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("oneOnOne.editTitle")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {loadErrorMessage}
              </Alert>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => navigate(backTo)}>
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          ) : data ? (
            <form onSubmit={form.onSubmit(save)} noValidate>
              <Stack>
                {/* PersonaField matches the input height, so the row needs no special align. */}
                <Group gap="xl">
                  <PersonaField label={t("oneOnOne.manager")} you />
                  <PersonaField label={t("oneOnOne.subordinate")} name={data.subordinateName} />
                  <DateField
                    label={t("oneOnOne.meetingDate")}
                    w={180}
                    // The pair's previous meeting is the chronological floor (server: 409).
                    minIso={data.minMeetingDate ?? undefined}
                    {...form.getInputProps("meetingDate")}
                  />
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("oneOnOne.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <Stack gap="lg">
                      <ParagraphListEditor
                        form={form}
                        listField="points"
                        title={t("oneOnOne.points")}
                        addLabel={t("oneOnOne.addPoint")}
                        emptyLabel={t("oneOnOne.noPoints")}
                      />
                      <Divider />
                      <ParagraphListEditor
                        form={form}
                        listField="decisions"
                        title={t("oneOnOne.decisions")}
                        addLabel={t("oneOnOne.addDecision")}
                        emptyLabel={t("oneOnOne.noDecisions")}
                      />
                      <Divider />
                      <ActionItemsEditor
                        form={form}
                        managerName={t("common.state.you")}
                        subordinateName={data.subordinateName}
                      />
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <OneOnOneHistory
                      meetingId={id}
                      managerName={data.managerName}
                      subordinateName={data.subordinateName}
                    />
                  </Tabs.Panel>
                </Tabs>

                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}

                <Group justify="space-between">
                  <Button
                    color="red"
                    variant="light"
                    onClick={openDelete}
                    disabled={submitting}
                  >
                    {t("common.action.delete")}
                  </Button>
                  <Group gap="sm">
                    <Button
                      type="button"
                      variant="default"
                      onClick={openCancel}
                      disabled={submitting}
                    >
                      {t("common.action.cancel")}
                    </Button>
                    <Button type="submit" loading={submitting}>
                      {t("common.action.save")}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </form>
          ) : null}
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("oneOnOne.discardTitle")}
        message={t("oneOnOne.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
      <ConfirmActionModal
        opened={deleteOpen}
        onClose={closeDelete}
        title={t("oneOnOne.deleteTitle")}
        message={t("oneOnOne.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        loading={deleting}
        onConfirm={remove}
      />
    </Container>
  );
}
