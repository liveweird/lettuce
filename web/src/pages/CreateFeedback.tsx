import { useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
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
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createFeedback,
  getUserId,
  type FeedbackVisibility,
} from "../api/client";

type FormValues = {
  visibility: FeedbackVisibility;
  content: string;
};

const VISIBILITY_OPTIONS = [
  { value: "PROVIDER_SUBJECT", label: "Provider + subject" },
  { value: "PUBLIC", label: "Public" },
];

export default function CreateFeedback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const subjectId = Number(searchParams.get("subjectId"));
  const subjectName = searchParams.get("subjectName");
  const providerId = getUserId();

  const form = useForm<FormValues>({
    initialValues: { visibility: "PROVIDER_SUBJECT", content: "" },
  });

  const subjectIdIsValid = Number.isFinite(subjectId) && subjectId > 0;
  if (!subjectIdIsValid || providerId == null) return <Navigate to="/" replace />;

  async function onSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createFeedback({
        subjectId,
        providerId: providerId!,
        visibility: values.visibility,
        status: "DRAFT",
        content: values.content,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to provide this feedback.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Create failed (${err.status})`);
        }
      } else {
        setError("Create failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>Provide feedback</Title>
            <TextInput
              label="Subject"
              value={subjectName ?? `#${subjectId}`}
              disabled
            />
            <TextInput label="Provider" value="You" disabled />
            <TextInput label="Status" value="Draft" disabled />
            <Select
              label="Visibility"
              placeholder="Select visibility"
              data={VISIBILITY_OPTIONS}
              allowDeselect={false}
              {...form.getInputProps("visibility")}
            />
            <Textarea
              label="Content"
              placeholder="Write your feedback…"
              rows={6}
              maxLength={5000}
              {...form.getInputProps("content")}
            />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={openCancel} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Modal opened={cancelOpen} onClose={closeCancel} title="Discard feedback?" centered>
        <Stack gap="md">
          <Text>Discard this feedback? Anything you've written won't be saved.</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeCancel}>
              Keep editing
            </Button>
            <Button color="red" component={RouterLink} to="/">
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
