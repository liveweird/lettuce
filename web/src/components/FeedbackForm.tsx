import {
  Link as RouterLink,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Container,
  Group,
  Input,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Typography,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getTemplate,
  listTemplates,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import { formatTimestamp } from "../utils/datetime";

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
  showTemplateInsert?: boolean;
  // Epoch millis; when set, shows a read-only "Last modified" field (edit flow only).
  lastModified?: number;
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
  showTemplateInsert = false,
  lastModified,
}: FeedbackFormProps) {
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<FormValues>({
    initialValues: { visibility: initialVisibility, content: initialContent },
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  // pageSize 100 is the list endpoint's max; a deployment with >100 templates would
  // truncate the picker — acceptable for now, matching the endpoint cap.
  const templatesQuery = useQuery({
    queryKey: ["templates", "picker"],
    queryFn: () => listTemplates({ page: 1, pageSize: 100, sort: "name" }),
    enabled: showTemplateInsert,
  });
  const templateOptions = (templatesQuery.data?.items ?? []).map((t) => ({
    value: String(t.id),
    label: t.name,
  }));

  async function insertTemplate() {
    if (selectedTemplateId == null) return;
    setTemplateError(null);
    setInserting(true);
    try {
      // List items carry only contentPreview, so fetch the full content on demand.
      const tpl = await getTemplate(Number(selectedTemplateId));
      const current = form.values.content;
      const sep = current.length > 0 && !current.endsWith("\n") ? "\n\n" : "";
      form.setFieldValue("content", current + sep + tpl.content);
    } catch {
      setTemplateError("Couldn't load that template. Please try again.");
    } finally {
      setInserting(false);
    }
  }

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
              <Stack gap="sm">
                <Select
                  label="Visibility"
                  placeholder="Select visibility"
                  data={VISIBILITY_OPTIONS}
                  allowDeselect={false}
                  {...form.getInputProps("visibility")}
                />
                {showTemplateInsert && (
                  <Stack gap="xs">
                    <Group gap="sm" align="flex-end" wrap="nowrap">
                      <Select
                        label="Template"
                        placeholder={
                          templatesQuery.isLoading ? "Loading…" : "Pick a template"
                        }
                        data={templateOptions}
                        searchable
                        disabled={templatesQuery.isLoading}
                        nothingFoundMessage="No matching templates"
                        value={selectedTemplateId}
                        onChange={setSelectedTemplateId}
                        style={{ flex: 1 }}
                      />
                      <Button
                        type="button"
                        variant="default"
                        onClick={insertTemplate}
                        loading={inserting}
                        disabled={selectedTemplateId == null || inserting}
                      >
                        Insert
                      </Button>
                    </Group>
                    {templateError && (
                      <Alert color="red" variant="light">
                        {templateError}
                      </Alert>
                    )}
                  </Stack>
                )}
                {lastModified != null && (
                  <TextInput
                    label="Last modified"
                    value={formatTimestamp(lastModified)}
                    disabled
                  />
                )}
              </Stack>
            </SimpleGrid>
            <SimpleGrid
              cols={{ base: 1, sm: 2 }}
              spacing="md"
              style={{ flex: 1, minHeight: 0 }}
            >
              <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
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
              <Input.Wrapper
                label="Preview"
                styles={{ root: { display: "flex", flexDirection: "column", minHeight: 0 } }}
              >
                <Box
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-default)",
                    padding: "var(--mantine-spacing-sm)",
                  }}
                >
                  <Typography>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {form.values.content}
                    </ReactMarkdown>
                  </Typography>
                </Box>
              </Input.Wrapper>
            </SimpleGrid>
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
