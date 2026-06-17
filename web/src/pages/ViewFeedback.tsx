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
  Paper,
  SimpleGrid,
  Stack,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  getFeedback,
  getUserId,
  updateFeedback,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";

const RECEIVED = "/feedback?tab=received";

const VISIBILITY_LABEL: Record<FeedbackVisibility, string> = {
  PROVIDER_SUBJECT: "Provider + subject",
  PROVIDER_REQUESTER: "Provider + requester",
  PROVIDER_REQUESTER_SUBJECT: "Provider + requester + subject",
  PUBLIC: "Public",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  REQUESTED: "Requested",
  DRAFT: "Draft",
  SENT: "Sent",
  WITHDRAWN: "Withdrawn",
};

// The single status transition a provider can perform from each status (matches the
// backend state machine in FeedbackService.isAllowedTransition). WITHDRAWN is terminal
// and intentionally absent → the provider sees only Close.
const NEXT_ACTION: Partial<Record<FeedbackStatus, { label: string; next: FeedbackStatus }>> = {
  REQUESTED: { label: "Draft", next: "DRAFT" },
  DRAFT: { label: "Send", next: "SENT" },
  SENT: { label: "Withdraw", next: "WITHDRAWN" },
};

export default function ViewFeedback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const providerName = searchParams.get("providerName");
  const requesterName = searchParams.get("requesterName");
  const as = searchParams.get("as");
  const asProvider = as === "provider";
  const asTeam = as === "team";
  const subjectName = searchParams.get("subjectName");
  const backTo = asTeam
    ? "/feedback?tab=team"
    : asProvider
      ? "/feedback?tab=provided"
      : RECEIVED;
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  // The provider (not the as=provider display hint) is the only one who can change status.
  const isProvider = data != null && getUserId() === data.providerId;
  const action = isProvider ? NEXT_ACTION[data!.status] : undefined;

  async function handleTransition(next: FeedbackStatus) {
    if (!data) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await updateFeedback(id, {
        requesterId: data.requesterId ?? null,
        subjectId: data.subjectId,
        providerId: data.providerId,
        visibility: data.visibility,
        status: next,
        content: data.content,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setActionError("You don't have permission to change this feedback.");
        else if (err.status === 404) setActionError("Feedback no longer exists.");
        else if (err.status === 400) setActionError("This status change is not allowed.");
        else setActionError(`Update failed (${err.status}).`);
      } else {
        setActionError("Update failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const errorMessage =
    errorStatus === 404
      ? "Feedback not found."
      : errorStatus === 403
        ? "You don't have permission to view this feedback."
        : `Failed to load feedback${errorStatus != null ? ` (${errorStatus})` : ""}.`;

  return (
    <Container
      size="sm"
      px={0}
      style={{
        display: "flex",
        flexDirection: "column",
        // Fill the AppShell.Main content area (header 56px + md padding top & bottom).
        minHeight:
          "calc(100dvh - var(--app-shell-header-height, 56px) - 2 * var(--app-shell-padding, 16px))",
      }}
    >
      <Paper
        withBorder
        shadow="sm"
        p="xl"
        radius="md"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Stack style={{ flex: 1 }}>
          <Title order={2}>Feedback</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {errorMessage}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={backTo} variant="default">
                  Close
                </Button>
              </Group>
            </>
          ) : (
            <>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                <Stack gap="sm">
                  <TextInput
                    label="Requester"
                    value={
                      requesterName ??
                      (data!.requesterId != null ? `#${data!.requesterId}` : "None")
                    }
                    disabled
                  />
                  <TextInput
                    label="Subject"
                    value={
                      asProvider || asTeam ? (subjectName ?? `#${data!.subjectId}`) : "You"
                    }
                    disabled
                  />
                  <TextInput
                    label="Provider"
                    value={asProvider ? "You" : (providerName ?? `#${data!.providerId}`)}
                    disabled
                  />
                </Stack>
                <Stack gap="sm">
                  <TextInput
                    label="Visibility"
                    value={VISIBILITY_LABEL[data!.visibility]}
                    disabled
                  />
                  <TextInput label="Status" value={STATUS_LABEL[data!.status]} disabled />
                </Stack>
              </SimpleGrid>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                <Textarea
                  label="Content"
                  value={data!.content}
                  disabled
                  styles={{
                    root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                    wrapper: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                    input: { flex: 1, minHeight: 0, resize: "none" },
                  }}
                />
              </div>
              {actionError && (
                <Alert color="red" variant="light">
                  {actionError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button component={RouterLink} to={backTo} variant="default">
                  Close
                </Button>
                {action && (
                  <Button onClick={() => handleTransition(action.next)} loading={submitting}>
                    {action.label}
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
