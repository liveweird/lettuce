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
import { useTranslation } from "react-i18next";
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

const DEFAULT_VISIBILITY_VALUES: FeedbackVisibility[] = ["PROVIDER_SUBJECT", "PUBLIC"];

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
  // Read-only requester display name; when set, a disabled "Requester" field is shown.
  requesterDisplay?: string;
  // Visibility choices for the combo; defaults to the create set (Provider+subject / Public).
  visibilityOptions?: { value: FeedbackVisibility; label: string }[];
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
  requesterDisplay,
  visibilityOptions,
  lastModified,
}: FeedbackFormProps) {
  const { t } = useTranslation();
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const resolvedVisibilityOptions =
    visibilityOptions ??
    DEFAULT_VISIBILITY_VALUES.map((value) => ({
      value,
      label: t(`common.visibility.${value}`),
    }));

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
  const templateOptions = (templatesQuery.data?.items ?? []).map((tpl) => ({
    value: String(tpl.id),
    label: tpl.name,
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
      setTemplateError(t("feedback.templateLoadError"));
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
                <TextInput label={t("common.field.subject")} value={subjectDisplay} disabled />
                <TextInput label={t("common.field.provider")} value={t("common.state.you")} disabled />
                {requesterDisplay != null && (
                  <TextInput label={t("common.field.requester")} value={requesterDisplay} disabled />
                )}
              </Stack>
              <Stack gap="sm">
                <Select
                  label={t("common.field.visibility")}
                  placeholder={t("feedback.selectVisibility")}
                  data={resolvedVisibilityOptions}
                  allowDeselect={false}
                  {...form.getInputProps("visibility")}
                />
                {showTemplateInsert && (
                  <Stack gap="xs">
                    <Group gap="sm" align="flex-end" wrap="nowrap">
                      <Select
                        label={t("feedback.template")}
                        placeholder={
                          templatesQuery.isLoading
                            ? t("common.state.loading")
                            : t("feedback.pickTemplate")
                        }
                        data={templateOptions}
                        searchable
                        disabled={templatesQuery.isLoading}
                        nothingFoundMessage={t("feedback.noMatchingTemplates")}
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
                        {t("feedback.insert")}
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
                    label={t("common.field.lastModified")}
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
                  label={t("common.field.content")}
                  placeholder={t("feedback.contentPlaceholder")}
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
                label={t("common.field.preview")}
                styles={{ root: { display: "flex", flexDirection: "column", minHeight: 0 } }}
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
                {t("common.action.cancel")}
              </Button>
              <Button
                type="submit"
                variant="light"
                loading={submitting === "DRAFT"}
                disabled={submitting !== null}
              >
                {t("feedback.action.saveDraft")}
              </Button>
              <Button
                type="button"
                onClick={() => onSubmit("SENT", form.values)}
                loading={submitting === "SENT"}
                disabled={submitting !== null}
              >
                {t("feedback.action.saveAndSend")}
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
              {t("common.action.keepEditing")}
            </Button>
            <Button color="red" component={RouterLink} to={cancelTo}>
              {t("common.action.discard")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}
