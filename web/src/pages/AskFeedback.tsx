import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, createFeedback, getUserId, type FeedbackVisibility } from "../api/client";

// "Ask for feedback" only offers the two visibilities where the subject (the requester
// themselves) can read the result.
const VISIBILITY_OPTIONS: { value: FeedbackVisibility; label: string }[] = [
  { value: "PROVIDER_SUBJECT", label: "Provider + subject" },
  { value: "PUBLIC", label: "Public" },
];

export default function AskFeedback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const providerId = Number(searchParams.get("providerId"));
  const providerName = searchParams.get("providerName");
  // Return to the Dashboard tab the user came from; default to managers.
  const backTo = searchParams.get("back") ?? "/?tab=managers";
  const requesterId = getUserId();

  const [visibility, setVisibility] = useState<FeedbackVisibility>("PROVIDER_SUBJECT");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const providerIdIsValid = Number.isFinite(providerId) && providerId > 0;
  if (!providerIdIsValid || requesterId == null) return <Navigate to={backTo} replace />;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      // I'm asking my manager (provider) to give feedback about me: subject == requester == me.
      await createFeedback({
        requesterId: requesterId!,
        subjectId: requesterId!,
        providerId,
        visibility,
        status: "REQUESTED",
        content: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to request this feedback.");
        } else if (err.status === 400) {
          setError("Validation error. Please try again.");
        } else {
          setError(`Request failed (${err.status})`);
        }
      } else {
        setError("Request failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>Ask for feedback</Title>

          <Group grow>
            <TextInput label="Provider" value={providerName ?? `#${providerId}`} disabled />
            <TextInput label="Subject" value="You" disabled />
          </Group>

          <Select
            label="Visibility"
            placeholder="Select visibility"
            data={VISIBILITY_OPTIONS}
            allowDeselect={false}
            value={visibility}
            onChange={(v) => v && setVisibility(v as FeedbackVisibility)}
          />

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} loading={submitting}>
              Send request
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Modal opened={cancelOpen} onClose={closeCancel} title="Discard this request?" centered>
        <Stack gap="md">
          <Text>Discard this feedback request? Nothing will be saved.</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeCancel}>
              Keep editing
            </Button>
            <Button color="red" component={RouterLink} to={backTo}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
