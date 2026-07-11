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
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  deleteOneOnOne,
  getOneOnOne,
  getUserId,
  updateOneOnOne,
} from "../api/client";
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

export default function EditOneOnOne() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "managed";
  const backOverride = searchParams.get("back");
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
    validate: oneOnOneFormValidation(t),
  });

  // One-shot: seed the form once the document arrives (initialize is a no-op afterwards).
  if (data && !form.initialized) {
    form.initialize(toFormValues(data));
  }

  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && getUserId() !== data.managerId) {
    return <Navigate to={`/one-on-ones/${id}/view`} replace />;
  }

  async function save(values: OneOnOneFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateOneOnOne(id, toUpdateBody(values));
      await queryClient.invalidateQueries({ queryKey: ["oneOnOnes"] });
      await queryClient.invalidateQueries({ queryKey: ["oneOnOne", id] });
      queryClient.invalidateQueries({ queryKey: ["oneOnOneEvents", id] });
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
      await queryClient.invalidateQueries({ queryKey: ["oneOnOnes"] });
      queryClient.removeQueries({ queryKey: ["oneOnOne", id] });
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
                <Group gap="xl" align="flex-end">
                  <PersonaField label={t("oneOnOne.manager")} you />
                  <PersonaField label={t("oneOnOne.subordinate")} name={data.subordinateName} />
                  <TextInput
                    type="date"
                    label={t("oneOnOne.meetingDate")}
                    w={180}
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
