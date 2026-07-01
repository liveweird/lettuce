import { useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  deleteFeedback,
  getFeedback,
  getUserId,
  pickUpFeedback,
  rejectFeedback,
  sendFeedback,
  updateFeedback,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";
import RequesterMessage from "../components/RequesterMessage";

const PROVIDED = "/feedback?tab=provided";

// The visibility options offered in the editor depend on whether the feedback has a requester:
// a requester-backed feedback must be able to keep a requester-inclusive visibility (otherwise
// saving would strip the requester's read access), while a plain one stays Provider+subject / Public.
const NO_REQUESTER_VISIBILITY_VALUES: FeedbackVisibility[] = ["PROVIDER_SUBJECT", "PUBLIC"];
const REQUESTER_VISIBILITY_VALUES: FeedbackVisibility[] = [
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

function visibilityValuesFor(hasRequester: boolean) {
  return hasRequester ? REQUESTER_VISIBILITY_VALUES : NO_REQUESTER_VISIBILITY_VALUES;
}

// Keep the preselected value within the offered set; if the stored visibility is out of set, fall
// back to a sensible default (the most inclusive requester option, or Provider+subject otherwise).
function clampVisibility(v: FeedbackVisibility, hasRequester: boolean): FeedbackVisibility {
  const allowed = visibilityValuesFor(hasRequester);
  if (allowed.includes(v)) return v;
  return hasRequester ? "PROVIDER_REQUESTER_SUBJECT" : "PROVIDER_SUBJECT";
}

export default function EditFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const subjectName = searchParams.get("subjectName");
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the tab default;
  // otherwise return to whichever tab the editor was opened from (team tab for managers).
  const backTo =
    searchParams.get("back") ??
    (searchParams.get("from") === "team" ? "/feedback?tab=team" : PROVIDED);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [rejectOpen, { open: openReject, close: closeReject }] = useDisclosure(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const {
    data,
    isLoading,
    isError,
    error: fetchError,
  } = useQuery({
    queryKey: ["feedback", id],
    queryFn: () => getFeedback(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={backTo} replace />;

  async function handleSave(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
    if (!data) return;
    // Accepting a request (REQUESTED → DRAFT) keeps the provider on this screen and reloads it
    // as the editor; every other save returns to the originating tab.
    const accepted = data.status === "REQUESTED" && status === "DRAFT";
    setError(null);
    setSubmitting(status);
    try {
      // Map the editor's intent onto the new verb design: content edits go through PUT, lifecycle
      // moves go through the POST action endpoints.
      if (data.status === "REQUESTED" && status === "DRAFT") {
        await pickUpFeedback(id); // Accept
      } else if (data.status === "REQUESTED" && status === "REJECTED") {
        await rejectFeedback(id); // Reject
      } else if (status === "SENT") {
        // Save & send: persist the draft content, then transition.
        await updateFeedback(id, { content: values.content, visibility: values.visibility });
        await sendFeedback(id);
      } else {
        // Save draft: content/visibility edit only.
        await updateFeedback(id, { content: values.content, visibility: values.visibility });
      }
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
      // A status transition (e.g. send/reject) mints notifications — refresh the bell badge.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      if (!accepted) navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("feedback.error.editPermission"));
        } else if (err.status === 404) {
          setError(t("feedback.error.gone"));
        } else if (err.status === 409) {
          setError(t("feedback.error.invalidTransition"));
        } else if (err.status === 400) {
          setError(t("feedback.error.validation"));
        } else {
          setError(t("feedback.error.saveFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("feedback.error.saveFailed"));
      }
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDelete() {
    if (!data) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteFeedback(id);
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
      // Deleting a draft notifies its requester — refresh the bell badge.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      closeDelete();
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("feedback.error.editPermission"));
        } else if (err.status === 404) {
          setError(t("feedback.error.gone"));
        } else if (err.status === 400) {
          setError(t("feedback.error.deleteNotDraft"));
        } else {
          setError(t("feedback.error.deleteFailed"));
        }
      } else {
        setError(t("feedback.error.deleteFailed"));
      }
    } finally {
      setDeleting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  if (isLoading || isError) {
    return (
      <Container size="xs" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            <Title order={2}>{t("feedback.editTitle")}</Title>
            {isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : (
              <>
                <Alert color="red" variant="light">
                  {notFound
                    ? t("feedback.error.notFound")
                    : fetchError instanceof ApiError
                      ? t("feedback.error.loadFailedStatus", { status: fetchError.status })
                      : t("feedback.error.loadFailed")}
                </Alert>
                <Group justify="flex-end">
                  <Button component={RouterLink} to={backTo} variant="default">
                    {t("feedback.backToFeedback")}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      </Container>
    );
  }

  // A REQUESTED feedback is a request the provider hasn't picked up yet — a triage decision,
  // not an editing screen. Offer Close / Reject / Accept instead of the editor (Accept = pick up
  // the request → DRAFT, then reload as the editor). Only `REQUESTED → DRAFT` and
  // `REQUESTED → REJECTED` are valid transitions, so "Save & send" must not be offered here.
  if (data!.status === "REQUESTED" && getUserId() === data!.providerId) {
    const subjectDisplay = data!.subjectName ?? subjectName ?? `#${data!.subjectId}`;
    const requesterDisplay =
      data!.requesterName ??
      (data!.requesterId != null ? `#${data!.requesterId}` : t("feedback.unknown"));
    const decide = (status: FeedbackStatus) =>
      handleSave(status, { visibility: data!.visibility, content: data!.content ?? "" });
    return (
      <Container size="xs" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            <Title order={2}>{t("feedback.requestTitle")}</Title>
            <Text>
              {t("feedback.triageLine", { requester: requesterDisplay, subject: subjectDisplay })}
            </Text>
            <TextInput label={t("common.field.subject")} value={subjectDisplay} disabled />
            <TextInput label={t("common.field.requester")} value={requesterDisplay} disabled />
            <RequesterMessage value={data!.requesterMessage} />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="sm">
              <Button
                variant="default"
                onClick={() => navigate(backTo, { replace: true })}
                disabled={submitting !== null}
              >
                {t("common.action.close")}
              </Button>
              <Button
                color="red"
                variant="light"
                onClick={openReject}
                loading={submitting === "REJECTED"}
                disabled={submitting !== null}
              >
                {t("feedback.action.reject")}
              </Button>
              <Button
                onClick={() => decide("DRAFT")}
                loading={submitting === "DRAFT"}
                disabled={submitting !== null}
              >
                {t("feedback.action.accept")}
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Modal
          opened={rejectOpen}
          onClose={closeReject}
          title={t("feedback.rejectTitle")}
          centered
        >
          <Stack gap="md">
            <Text>{t("feedback.rejectBody")}</Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={closeReject}>
                {t("common.action.keepEditing")}
              </Button>
              <Button
                color="red"
                onClick={() => {
                  closeReject();
                  decide("REJECTED");
                }}
              >
                {t("feedback.action.reject")}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Container>
    );
  }

  const hasRequester = data!.requesterId != null;
  const visibilityOptions = visibilityValuesFor(hasRequester).map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));
  // Delete is a draft-only, provider-only action (mirrors the backend guard).
  const canDelete = data!.status === "DRAFT" && getUserId() === data!.providerId;
  return (
    <>
      <FeedbackForm
        title={t("feedback.editTitle")}
        feedbackId={data!.id}
        currentStatus={data!.status}
        subjectDisplay={subjectName ?? `#${data!.subjectId}`}
        initialVisibility={clampVisibility(data!.visibility, hasRequester)}
        visibilityOptions={visibilityOptions}
        requesterDisplay={hasRequester ? (data!.requesterName ?? `#${data!.requesterId}`) : undefined}
        requesterMessage={data!.requesterMessage}
        initialContent={data!.content ?? ""}
        lastModified={data!.lastModified}
        submitting={submitting}
        error={error}
        onSubmit={handleSave}
        cancelTo={backTo}
        showTemplateInsert
        discardTitle={t("feedback.discardChangesTitle")}
        discardMessage={t("feedback.discardChangesMessage")}
        onDelete={canDelete ? openDelete : undefined}
        deleting={deleting}
      />
      {canDelete && (
        <Modal opened={deleteOpen} onClose={closeDelete} title={t("feedback.deleteTitle")} centered>
          <Stack gap="md">
            <Text>{t("feedback.deleteBody")}</Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={closeDelete} disabled={deleting}>
                {t("common.action.keepEditing")}
              </Button>
              <Button color="red" onClick={handleDelete} loading={deleting}>
                {t("common.action.delete")}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}
