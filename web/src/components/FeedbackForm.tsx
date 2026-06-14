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
  SimpleGrid,
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
        <form
          onSubmit={form.onSubmit(() => onSubmit("DRAFT", form.values))}
          noValidate
          style={{ flex: 1, display: "flex", flexDirection: "column" }}
        >
          <Stack style={{ flex: 1 }}>
            <Title order={2}>{title}</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Stack gap="sm">
                <TextInput label="Subject" value={subjectDisplay} disabled />
                <TextInput label="Provider" value="You" disabled />
              </Stack>
              <Select
                label="Visibility"
                placeholder="Select visibility"
                data={VISIBILITY_OPTIONS}
                allowDeselect={false}
                {...form.getInputProps("visibility")}
              />
            </SimpleGrid>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <Textarea
                label="Content"
                placeholder="Write your feedback…"
                maxLength={5000}
                styles={{
                  root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                  wrapper: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
                  input: { flex: 1, minHeight: 0, resize: "none" },
                }}
                {...form.getInputProps("content")}
              />
            </div>
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
