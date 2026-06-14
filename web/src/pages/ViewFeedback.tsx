import {
  Link as RouterLink,
  Navigate,
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
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  getFeedback,
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

export default function ViewFeedback() {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const providerName = searchParams.get("providerName");
  const requesterName = searchParams.get("requesterName");

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

  if (!idIsValid) return <Navigate to={RECEIVED} replace />;

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

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
                {notFound
                  ? "Feedback not found."
                  : `Failed to load feedback${fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.`}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={RECEIVED} variant="default">
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
                  <TextInput label="Subject" value="You" disabled />
                  <TextInput
                    label="Provider"
                    value={providerName ?? `#${data!.providerId}`}
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
              <Group justify="flex-end">
                <Button component={RouterLink} to={RECEIVED} variant="default">
                  Close
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
