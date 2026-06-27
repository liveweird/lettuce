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
import {
  ApiError,
  getFeedback,
  getUserId,
  updateFeedback,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";

const PROVIDED = "/feedback?tab=provided";

// The visibility options offered in the editor depend on whether the feedback has a requester:
// a requester-backed feedback must be able to keep a requester-inclusive visibility (otherwise
// saving would strip the requester's read access), while a plain one stays Provider+subject / Public.
const NO_REQUESTER_VISIBILITY_OPTIONS: { value: FeedbackVisibility; label: string }[] = [
  { value: "PROVIDER_SUBJECT", label: "Provider + subject" },
  { value: "PUBLIC", label: "Public" },
];
const REQUESTER_VISIBILITY_OPTIONS: { value: FeedbackVisibility; label: string }[] = [
  { value: "PROVIDER_REQUESTER", label: "Provider + requester" },
  { value: "PROVIDER_REQUESTER_SUBJECT", label: "Provider + requester + subject" },
  { value: "PUBLIC", label: "Public" },
];

function visibilityOptionsFor(hasRequester: boolean) {
  return hasRequester ? REQUESTER_VISIBILITY_OPTIONS : NO_REQUESTER_VISIBILITY_OPTIONS;
}

// Keep the preselected value within the offered set; if the stored visibility is out of set, fall
// back to a sensible default (the most inclusive requester option, or Provider+subject otherwise).
function clampVisibility(v: FeedbackVisibility, hasRequester: boolean): FeedbackVisibility {
  const allowed = visibilityOptionsFor(hasRequester).map((o) => o.value);
  if (allowed.includes(v)) return v;
  return hasRequester ? "PROVIDER_REQUESTER_SUBJECT" : "PROVIDER_SUBJECT";
}

export default function EditFeedback() {
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
  const [rejectOpen, { open: openReject, close: closeReject }] = useDisclosure(false);

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
      await updateFeedback(id, {
        requesterId: data.requesterId ?? null,
        subjectId: data.subjectId,
        providerId: data.providerId,
        visibility: values.visibility,
        status,
        content: values.content,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
      if (!accepted) navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to edit this feedback.");
        } else if (err.status === 404) {
          setError("Feedback no longer exists.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Save failed (${err.status})`);
        }
      } else {
        setError("Save failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(null);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  if (isLoading || isError) {
    return (
      <Container size="xs" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            <Title order={2}>Edit feedback</Title>
            {isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : (
              <>
                <Alert color="red" variant="light">
                  {notFound
                    ? "Feedback not found."
                    : `Failed to load feedback${fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.`}
                </Alert>
                <Group justify="flex-end">
                  <Button component={RouterLink} to={backTo} variant="default">
                    Back to feedback
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
      data!.requesterName ?? (data!.requesterId != null ? `#${data!.requesterId}` : "Unknown");
    const decide = (status: FeedbackStatus) =>
      handleSave(status, { visibility: data!.visibility, content: data!.content });
    return (
      <Container size="xs" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            <Title order={2}>Feedback request</Title>
            <Text>
              {requesterDisplay} requested feedback from you about {subjectDisplay}. Accept to start a
              draft you can write and send, or reject the request.
            </Text>
            <TextInput label="Subject" value={subjectDisplay} disabled />
            <TextInput label="Requester" value={requesterDisplay} disabled />
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
                Close
              </Button>
              <Button
                color="red"
                variant="light"
                onClick={openReject}
                loading={submitting === "REJECTED"}
                disabled={submitting !== null}
              >
                Reject
              </Button>
              <Button
                onClick={() => decide("DRAFT")}
                loading={submitting === "DRAFT"}
                disabled={submitting !== null}
              >
                Accept
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Modal opened={rejectOpen} onClose={closeReject} title="Reject feedback request?" centered>
          <Stack gap="md">
            <Text>Reject this feedback request? This is final and cannot be undone.</Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={closeReject}>
                Keep editing
              </Button>
              <Button
                color="red"
                onClick={() => {
                  closeReject();
                  decide("REJECTED");
                }}
              >
                Reject
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Container>
    );
  }

  const hasRequester = data!.requesterId != null;
  return (
    <FeedbackForm
      title="Edit feedback"
      subjectDisplay={subjectName ?? `#${data!.subjectId}`}
      initialVisibility={clampVisibility(data!.visibility, hasRequester)}
      visibilityOptions={visibilityOptionsFor(hasRequester)}
      initialContent={data!.content}
      lastModified={data!.lastModified}
      submitting={submitting}
      error={error}
      onSubmit={handleSave}
      cancelTo={backTo}
      showTemplateInsert
      discardTitle="Discard changes?"
      discardMessage="Discard your changes? The feedback will remain as it was."
    />
  );
}
