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
  Box,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Typography,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ApiError,
  getFeedback,
  getUserId,
  updateFeedback,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import { formatTimestamp } from "../utils/datetime";

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
  REJECTED: "Rejected",
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
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the tab default.
  const backOverride = searchParams.get("back");
  const backTo =
    backOverride ??
    (asTeam ? "/feedback?tab=team" : asProvider ? "/feedback?tab=provided" : RECEIVED);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

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
  // A requester looking at a request that was never drafted (REQUESTED) or was declined (REJECTED)
  // has no content to read — hide the empty Content section to keep the view simple.
  const isRequester = data != null && data.requesterId != null && getUserId() === data.requesterId;
  const hideContent =
    isRequester && (data!.status === "REQUESTED" || data!.status === "REJECTED");
  // Only stretch the card to viewport height when the growable Content section is shown;
  // otherwise it would span the full window over empty space.
  const fill = !hideContent;

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
        // Fill the AppShell.Main content area (header 56px + md padding top & bottom),
        // but only when Content is shown — otherwise size the card to its content.
        minHeight: fill
          ? "calc(100dvh - var(--app-shell-header-height, 56px) - 2 * var(--app-shell-padding, 16px))"
          : undefined,
      }}
    >
      <Paper
        withBorder
        shadow="sm"
        p="xl"
        radius="md"
        style={{ flex: fill ? 1 : undefined, display: "flex", flexDirection: "column" }}
      >
        <Stack style={{ flex: fill ? 1 : undefined }}>
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
                      data!.requesterId == null
                        ? "None"
                        : (data!.requesterName ?? requesterName ?? `#${data!.requesterId}`)
                    }
                    disabled
                  />
                  <TextInput
                    label="Subject"
                    value={
                      asProvider || asTeam
                        ? (data!.subjectName ?? subjectName ?? `#${data!.subjectId}`)
                        : "You"
                    }
                    disabled
                  />
                  <TextInput
                    label="Provider"
                    value={
                      asProvider
                        ? "You"
                        : (data!.providerName ?? providerName ?? `#${data!.providerId}`)
                    }
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
                  <TextInput
                    label="Last modified"
                    value={formatTimestamp(data!.lastModified)}
                    disabled
                  />
                </Stack>
              </SimpleGrid>
              {!hideContent && (
                <Input.Wrapper
                  label="Content"
                  styles={{
                    root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                  }}
                >
                  <Box
                    tabIndex={-1}
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflow: "auto",
                      border: "1px solid var(--mantine-color-default-border)",
                      borderRadius: "var(--mantine-radius-default)",
                      padding: "var(--mantine-spacing-sm)",
                      backgroundColor: "var(--mantine-color-default-hover)",
                      cursor: "default",
                      outline: "none",
                    }}
                  >
                    <Typography>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{data!.content}</ReactMarkdown>
                    </Typography>
                  </Box>
                </Input.Wrapper>
              )}
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
                  <Button
                    onClick={() =>
                      action.next === "WITHDRAWN"
                        ? openConfirm()
                        : handleTransition(action.next)
                    }
                    loading={submitting}
                  >
                    {action.label}
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Paper>
      <Modal
        opened={confirmOpen}
        onClose={() => {
          if (!submitting) closeConfirm();
        }}
        title="Withdraw feedback?"
        centered
      >
        <Stack gap="md">
          <Text>
            Withdrawing this feedback is permanent — its status becomes{" "}
            <strong>Withdrawn</strong> and cannot be changed back. Continue?
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeConfirm} disabled={submitting}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={submitting}
              onClick={async () => {
                await handleTransition("WITHDRAWN");
                closeConfirm();
              }}
            >
              Withdraw
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
