import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Divider,
  Fieldset,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconPlus } from "@tabler/icons-react";
import DateField from "../components/DateField";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { deleteOneOnOne, getOneOnOne, updateOneOnOne } from "../api/oneonones";
import ActionItemsEditor from "../components/ActionItemsEditor";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DiscardGuard from "../components/DiscardGuard";
import FormFooter from "../components/FormFooter";
import MetaStrip from "../components/MetaStrip";
import OneOnOneHistory from "../components/OneOnOneHistory";
import PageHeader from "../components/PageHeader";
import ParagraphListEditor from "../components/ParagraphListEditor";
import PersonaChip from "../components/PersonaChip";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { useManagedReports } from "../hooks/useManagedReports";
import {
  oneOnOneFormValidation,
  oneOnOneSaveErrorMessage,
  toFormValues,
  toUpdateBody,
  type OneOnOneFormValues,
} from "../utils/oneOnOneForm";
import { oneOnOneCreateLink, oneOnOneViewLink } from "../utils/oneOnOneLinks";
import { invalidateOneOnOne } from "../utils/oneOnOneQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

export default function EditOneOnOne() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "managed";
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? `/one-on-ones?tab=${from === "team" ? "team" : "managed"}`;

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [newMeetingOpen, { open: openNewMeeting, close: closeNewMeeting }] = useDisclosure(false);

  // The "New 1:1" button (with the same subordinate) only makes sense when the caller can
  // still create one for them — chain-wide since v2.33.0, the same pool CreateOneOnOne
  // resolves its prefilled subordinate against; hidden otherwise rather than 403ing on click.
  const { reports: managedReports, reportsReady: managedReportsReady } = useManagedReports(true);

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

  // Dirtiness is a PAYLOAD compare, not `form.isDirty()` — the three lists' insert/remove/
  // reorder operations don't flip Mantine's dirty flags. Shared by the cancel guard below and
  // the New-1:1 flow's own dirty check.
  const isDirty = () =>
    data != null &&
    JSON.stringify(toUpdateBody(form.values)) !== JSON.stringify(toUpdateBody(toFormValues(data)));

  // The one cancel guard (v3.5.0).
  const { requestCancel, bypassNextNavigation, guardProps } = useDiscardGuard({
    isDirty,
    to: backTo,
    title: t("oneOnOne.discardTitle"),
    message: t("oneOnOne.discardMessage"),
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

  // The "New 1:1" header button targets a fresh meeting with THIS meeting's subordinate,
  // `back` carrying this edit page's own URL (query string included) so the create screen's
  // Cancel returns here — same builder CreateOneOnOne's other entry points use.
  const canStartNewOneOnOne =
    data != null && managedReportsReady && managedReports.some((r) => r.userId === data.subordinateId);
  const newOneOnOneLink = data
    ? oneOnOneCreateLink(data.subordinateId, `${location.pathname}${location.search}`)
    : "";

  async function performSave(values: OneOnOneFormValues, target: string): Promise<boolean> {
    // Belt-and-braces for the chronological rule (the validate rules and the input's `min`
    // usually catch it first; the server 409 is the final backstop).
    if (data?.minMeetingDate != null && values.meetingDate < data.minMeetingDate) {
      form.setFieldError(
        "meetingDate",
        t("oneOnOne.dateBeforePrevious", { date: data.minMeetingDate }),
      );
      return false;
    }
    setError(null);
    setSubmitting(true);
    try {
      await updateOneOnOne(id, toUpdateBody(values));
      await invalidateOneOnOne(queryClient, id);
      showSuccessToast(t("oneOnOne.toast.saved"));
      // A `replace` navigation passes the route blocker unblocked (DiscardGuard's contract),
      // so the just-saved (still "dirty" against its pre-save initial values) form doesn't
      // re-trigger the cancel guard's own confirm on its way out.
      navigate(target, { replace: true });
      return true;
    } catch (err) {
      setError(oneOnOneSaveErrorMessage(err, t));
      setSubmitting(false);
      return false;
    }
  }

  async function save(values: OneOnOneFormValues) {
    await performSave(values, backTo);
  }

  // The New-1:1 modal's three choices. Immediate when the form is clean; a dirty form asks
  // first via the modal below rather than silently discarding an in-progress edit.
  function handleNewOneOnOne() {
    if (isDirty()) {
      openNewMeeting();
      return;
    }
    // Mirror `requestCancel`'s bypass so the route blocker never intercepts this programmatic
    // navigation even though it's a plain push, not a `replace`.
    bypassNextNavigation();
    navigate(newOneOnOneLink);
  }

  async function saveAndContinueThenNewOneOnOne() {
    if (form.validate().hasErrors) return;
    await performSave(form.values, newOneOnOneLink);
    closeNewMeeting();
  }

  function discardAndContinueToNewOneOnOne() {
    closeNewMeeting();
    bypassNextNavigation();
    navigate(newOneOnOneLink);
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
    <>
      <PageHeader
        title={t("oneOnOne.editTitle")}
        mb="lg"
        actions={
          canStartNewOneOnOne && (
            <Button leftSection={<IconPlus size={16} />} onClick={handleNewOneOnOne}>
              {t("oneOnOne.newMeeting")}
            </Button>
          )
        }
      />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            {isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : isError ? (
              <>
                <Alert color="red" variant="light">
                  {loadErrorMessage}
                </Alert>
                <FormFooter>
                  <Button variant="default" onClick={() => navigate(backTo)}>
                    {t("common.action.close")}
                  </Button>
                </FormFooter>
              </>
            ) : data ? (
              <form onSubmit={form.onSubmit(save)} noValidate>
                <Stack>
                  {/* The context line (v3.5.0): the pair and the date — the date input keeps its
                      "Meeting date" name via aria-label. */}
                  <MetaStrip
                    items={[
                      {
                        key: "manager",
                        label: t("oneOnOne.manager"),
                        value: <Text size="sm">{t("common.state.you")}</Text>,
                      },
                      {
                        key: "subordinate",
                        label: t("oneOnOne.subordinate"),
                        value: <PersonaChip name={data.subordinateName} />,
                      },
                      {
                        key: "meetingDate",
                        label: t("oneOnOne.meetingDate"),
                        value: (
                          <DateField
                            aria-label={t("oneOnOne.meetingDate")}
                            w={180}
                            // The pair's previous meeting is the chronological floor (server: 409).
                            minIso={data.minMeetingDate ?? undefined}
                            {...form.getInputProps("meetingDate")}
                          />
                        ),
                      },
                    ]}
                  />

                  <Tabs defaultValue="content" keepMounted={false}>
                    <Tabs.List>
                      <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                      <Tabs.Tab value="history">{t("oneOnOne.history")}</Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value="content" pt="md">
                      {/* Two sections (v3.5.0): the meeting notes, and the action items (its own
                          Fieldset inside ActionItemsEditor). */}
                      <Stack gap="lg">
                        <Fieldset legend={t("oneOnOne.section.notes")}>
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
                          </Stack>
                        </Fieldset>
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

                  <FormFooter sticky>
                    <Button
                      color="red"
                      variant="light"
                      mr="auto"
                      onClick={openDelete}
                      disabled={submitting}
                    >
                      {t("common.action.delete")}
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      onClick={requestCancel}
                      disabled={submitting}
                    >
                      {t("common.action.cancel")}
                    </Button>
                    <Button type="submit" loading={submitting}>
                      {t("common.action.save")}
                    </Button>
                  </FormFooter>
                </Stack>
              </form>
            ) : null}
          </Stack>
        </Paper>
      </Container>

      <DiscardGuard {...guardProps} />
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
      {/* The New-1:1 button's own three-way prompt — a dirty form isn't silently discarded,
          but it also isn't the generic Cancel confirm (which only knows one destination):
          Save/Discard/Cancel, all "…and continue" to the create screen. */}
      <Modal
        opened={newMeetingOpen}
        onClose={() => {
          if (!submitting) closeNewMeeting();
        }}
        title={t("oneOnOne.newMeetingConfirmTitle")}
        centered
      >
        <Stack gap="md">
          <Text>{t("oneOnOne.newMeetingConfirmMessage")}</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeNewMeeting} disabled={submitting}>
              {t("common.action.cancel")}
            </Button>
            <Button
              variant="light"
              color="red"
              onClick={discardAndContinueToNewOneOnOne}
              disabled={submitting}
            >
              {t("oneOnOne.discardAndContinue")}
            </Button>
            <Button onClick={saveAndContinueThenNewOneOnOne} loading={submitting}>
              {t("oneOnOne.saveAndContinue")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
