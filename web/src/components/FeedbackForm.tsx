import {
  Link as RouterLink,
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
import type { FeedbackStatus, FeedbackVisibility } from "../api/client";

type FormValues = {
  visibility: FeedbackVisibility;
  content: string;
};

const VISIBILITY_OPTIONS = [
  { value: "PROVIDER_SUBJECT", label: "Provider + subject" },
  { value: "PUBLIC", label: "Public" },
];

export type FeedbackFormProps = {
  title: string;
  subjectDisplay: string;
  initialVisibility: FeedbackVisibility;
  initialContent: string;
  submitting: FeedbackStatus | null;
  error: string | null;
  onSubmit: (status: FeedbackStatus, values: FormValues) => void;
  cancelTo: string;
  discardTitle: string;
  discardMessage: string;
};

export default function FeedbackForm({
  title,
  subjectDisplay,
  initialVisibility,
  initialContent,
  submitting,
  error,
  onSubmit,
  cancelTo,
  discardTitle,
  discardMessage,
}: FeedbackFormProps) {
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<FormValues>({
    initialValues: { visibility: initialVisibility, content: initialContent },
  });

  return (
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(() => onSubmit("DRAFT", form.values))} noValidate>
          <Stack>
            <Title order={2}>{title}</Title>
            <TextInput label="Subject" value={subjectDisplay} disabled />
            <TextInput label="Provider" value="You" disabled />
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
              <Button
                type="button"
                variant="default"
                onClick={openCancel}
                disabled={submitting !== null}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="light"
                loading={submitting === "DRAFT"}
                disabled={submitting !== null}
              >
                Save draft
              </Button>
              <Button
                type="button"
                onClick={() => onSubmit("SENT", form.values)}
                loading={submitting === "SENT"}
                disabled={submitting !== null}
              >
                Save &amp; send
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <Modal opened={cancelOpen} onClose={closeCancel} title={discardTitle} centered>
        <Stack gap="md">
          <Text>{discardMessage}</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeCancel}>
              Keep editing
            </Button>
            <Button color="red" component={RouterLink} to={cancelTo}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
