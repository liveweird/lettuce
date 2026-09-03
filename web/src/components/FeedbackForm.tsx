import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type FeedbackStatus, type FeedbackVisibility } from "../api/feedbacks";
import { getTemplate, listTemplates } from "../api/templates";
import ConfirmActionModal from "./ConfirmActionModal";
import { VisibilityBadge } from "./FeedbackBadges";
import FeedbackHistory from "./FeedbackHistory";
import ReadOnlyField from "./ReadOnlyField";
import { MAX_FEEDBACK_CONTENT_LENGTH } from "../utils/feedbackForm";
import { NO_REQUESTER_VISIBILITIES } from "../utils/feedbackVisibility";
import FeedbackLifecycle from "./FeedbackLifecycle";
import FeedbackMeta, { type PartyDisplay } from "./FeedbackMeta";
import RequesterMessage from "./RequesterMessage";

// The WYSIWYG editor pulls in MDXEditor/Lexical (~0.5 MB minified) — load it on demand so
// screens that render FeedbackForm's consumers without the editor (e.g. the REQUESTED triage
// view) never download it.
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

type FormValues = {
  visibility: FeedbackVisibility;
  content: string;
};

type FeedbackFormProps = {
  title: string;
  // The recipients for the people line (up to four, v3.1.0). Omitted/empty while the
  // subjects are still being picked (the picker-mode create flows) — the meta line then
  // shows only the provider until `subjectControl`'s picks resolve names. A legacy
  // self-reflection subject renders plain via its `isYou` flag.
  subjects?: PartyDisplay[];
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
  // Read-only requester clarification note; when non-empty, a disabled "Message from the
  // requester" field is shown. Immutable (captured at creation).
  requesterMessage?: string | null;
  // Visibility choices for the combo; defaults to the create set (Provider+subject / Public).
  visibilityOptions?: { value: FeedbackVisibility; label: string }[];
  // Epoch millis; when set, shows a read-only "Last modified" field (edit flow only).
  lastModified?: number;
  // When set (edit flow), the bottom section is three tabs — Content+Preview, History (this
  // feedback's audit events), and Lifecycle (the state diagram). Omitted on create (no id) → no tabs.
  feedbackId?: number;
  // Current status of the feedback being edited; highlights the matching node in the Lifecycle tab.
  currentStatus?: FeedbackStatus;
  // When set (DRAFT editor, provider only), a red Delete button is shown that triggers the
  // parent's confirmation flow; `deleting` drives its loading state.
  onDelete?: () => void;
  deleting?: boolean;
  // The no-duplicate early warning (create flows only — edit never passes it): rendered above
  // the editor, and while present both save actions are disabled (the server would 409 anyway).
  duplicate?: ReactNode;
  // An interactive subject control (the kudo create flow's recipient picker, v2.27.0) —
  // rendered as the first element of the editor-controls row.
  subjectControl?: ReactNode;
  // When set, the Visibility Select is replaced by a read-only field showing the (fixed)
  // initial visibility — the kudo create flow pins PUBLIC.
  visibilityReadOnly?: boolean;
  // Extra save-blocking condition from the parent (e.g. no recipient picked yet), ANDed
  // into the duplicate/submitting disables on both save buttons.
  submitDisabled?: boolean;
};

export default function FeedbackForm({
  title,
  subjects,
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
  requesterMessage,
  visibilityOptions,
  lastModified,
  feedbackId,
  currentStatus,
  onDelete,
  deleting = false,
  duplicate,
  subjectControl,
  visibilityReadOnly = false,
  submitDisabled = false,
}: FeedbackFormProps) {
  const { t } = useTranslation();
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const resolvedVisibilityOptions =
    visibilityOptions ??
    NO_REQUESTER_VISIBILITIES.map((value) => ({
      value,
      label: t(`common.visibility.${value}`),
    }));

  const form = useForm<FormValues>({
    initialValues: { visibility: initialVisibility, content: initialContent },
    validate: {
      // The editor hard-caps typing, but template insertion pushes the value externally —
      // this catches that path at submit time (see insertTemplate).
      content: (v) =>
        v.length > MAX_FEEDBACK_CONTENT_LENGTH
          ? t("feedback.contentTooLong", { max: MAX_FEEDBACK_CONTENT_LENGTH })
          : null,
    },
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

  // A single WYSIWYG markdown editor (its document model is markdown, so `content` stays the
  // same string we store and render read-only elsewhere). On edit this lives in the "Content"
  // tab (alongside a "History" tab); on create it is rendered directly.
  const editor = (
    <Suspense fallback={<Skeleton height={220} radius="sm" />}>
      <MarkdownEditor
        label={t("common.field.content")}
        placeholder={t("feedback.contentPlaceholder")}
        maxLength={MAX_FEEDBACK_CONTENT_LENGTH}
        value={form.values.content}
        onChange={(md) => form.setFieldValue("content", md)}
      />
      {form.errors.content && (
        <Text size="sm" c="var(--lettuce-ink-error)">
          {form.errors.content}
        </Text>
      )}
    </Suspense>
  );

  // The interactive controls live in one compact row right above the editor (not in a
  // metadata grid up top) so the editor keeps the bulk of the viewport.
  const editorControls = (
    <Group gap="sm" align="flex-end" wrap="wrap">
      {subjectControl}
      {visibilityReadOnly ? (
        <ReadOnlyField label={t("common.field.visibility")}>
          <VisibilityBadge visibility={form.values.visibility} />
        </ReadOnlyField>
      ) : (
        <Select
          label={t("common.field.visibility")}
          placeholder={t("feedback.selectVisibility")}
          data={resolvedVisibilityOptions}
          allowDeselect={false}
          w={280}
          {...form.getInputProps("visibility")}
        />
      )}
      {showTemplateInsert && (
        // One nowrap unit, so a crowded controls row (picker mode adds a third Select) wraps
        // the template picker and its Insert button together, never the button alone.
        <Group gap="sm" align="flex-end" wrap="nowrap">
          <Select
            label={t("feedback.template")}
            placeholder={
              templatesQuery.isLoading ? t("common.state.loading") : t("feedback.pickTemplate")
            }
            data={templateOptions}
            searchable
            disabled={templatesQuery.isLoading}
            nothingFoundMessage={t("feedback.noMatchingTemplates")}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
            w={280}
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
      )}
    </Group>
  );

  const editorPane = (
    <Stack gap="sm" style={{ flex: 1, minHeight: 0 }}>
      {editorControls}
      {templateError && (
        <Alert color="red" variant="light">
          {templateError}
        </Alert>
      )}
      {editor}
    </Stack>
  );

  return (
    <Container
      size="md"
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
            <FeedbackMeta
              title={title}
              status={currentStatus}
              providerDisplay={t("common.state.you")}
              providerIsYou
              subjects={subjects}
              requesterDisplay={requesterDisplay}
              lastModified={lastModified}
            />
            <RequesterMessage value={requesterMessage} collapsible />
            {duplicate}
            {feedbackId != null ? (
              <Tabs
                defaultValue="content"
                style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
              >
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("feedback.history")}</Tabs.Tab>
                  <Tabs.Tab value="lifecycle">{t("feedback.lifecycle")}</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel
                  value="content"
                  pt="md"
                  style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
                >
                  {editorPane}
                </Tabs.Panel>
                <Tabs.Panel value="history" pt="md" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  <FeedbackHistory feedbackId={feedbackId} />
                </Tabs.Panel>
                <Tabs.Panel value="lifecycle" pt="md" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  <FeedbackLifecycle currentStatus={currentStatus} />
                </Tabs.Panel>
              </Tabs>
            ) : (
              editorPane
            )}
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="sm">
              {onDelete != null && (
                <Button
                  type="button"
                  color="red"
                  variant="light"
                  mr="auto"
                  onClick={onDelete}
                  loading={deleting}
                  disabled={submitting !== null || deleting}
                >
                  {t("common.action.delete")}
                </Button>
              )}
              <Button
                type="button"
                variant="default"
                onClick={openCancel}
                disabled={submitting !== null || deleting}
              >
                {t("common.action.cancel")}
              </Button>
              <Button
                type="submit"
                variant="light"
                loading={submitting === "DRAFT"}
                disabled={submitting !== null || deleting || duplicate != null || submitDisabled}
              >
                {t("feedback.action.saveDraft")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!form.validate().hasErrors) onSubmit("SENT", form.values);
                }}
                loading={submitting === "SENT"}
                disabled={submitting !== null || deleting || duplicate != null || submitDisabled}
              >
                {t("feedback.action.saveAndSend")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={discardTitle}
        message={discardMessage}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={cancelTo}
      />
    </Container>
  );
}
