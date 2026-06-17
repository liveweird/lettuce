import { useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Alert, Button, Center, Container, Group, Loader, Paper, Stack, Title } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getFeedback,
  updateFeedback,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";

const PROVIDED = "/feedback?tab=provided";

// The shared form only offers PROVIDER_SUBJECT / PUBLIC (to look exactly like create).
// Drafts created via the Provide-feedback flow always use one of these; clamp anything else.
function clampVisibility(v: FeedbackVisibility): FeedbackVisibility {
  return v === "PROVIDER_SUBJECT" || v === "PUBLIC" ? v : "PROVIDER_SUBJECT";
}

export default function EditFeedback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const subjectName = searchParams.get("subjectName");
  // Return to whichever tab the editor was opened from (team tab for managers).
  const backTo = searchParams.get("from") === "team" ? "/feedback?tab=team" : PROVIDED;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);

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
      navigate(backTo, { replace: true });
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

  return (
    <FeedbackForm
      title="Edit feedback"
      subjectDisplay={subjectName ?? `#${data!.subjectId}`}
      initialVisibility={clampVisibility(data!.visibility)}
      initialContent={data!.content}
      submitting={submitting}
      error={error}
      onSubmit={handleSave}
      cancelTo={backTo}
      discardTitle="Discard changes?"
      discardMessage="Discard your changes? The feedback will remain as it was."
    />
  );
}
