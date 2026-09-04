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
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import { Fragment, lazy, Suspense, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type FeedbackStatus, type FeedbackVisibility } from "../api/feedbacks";
import { getTemplate, listTemplates } from "../api/templates";
import DiscardGuard from "./DiscardGuard";
import { StatusBadge, VisibilityBadge } from "./FeedbackBadges";
import FeedbackHistory from "./FeedbackHistory";
import FormFooter from "./FormFooter";
import MetaStrip, { type MetaStripItem } from "./MetaStrip";
import PageHeader from "./PageHeader";
import PersonaChip from "./PersonaChip";
import ReadOnlyField from "./ReadOnlyField";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { formatDateTime } from "../utils/datetime";
import { MAX_FEEDBACK_CONTENT_LENGTH } from "../utils/feedbackForm";
import { NO_REQUESTER_VISIBILITIES } from "../utils/feedbackVisibility";
import FeedbackLifecycle from "./FeedbackLifecycle";
import { type PartyDisplay } from "../utils/feedbackSubjects";
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
  // The recipients for the context line (up to four, v3.1.0). Omitted/empty while the
  // subjects are still being picked (the picker-mode create flows) — the strip then shows
  // only the provider until `subjectControl`'s picks resolve names. A legacy self-reflection
  // subject renders plain via its `isYou` flag.
  subjects?: PartyDisplay[];
  initialVisibility: FeedbackVisibility;
  initialContent: string;
  submitting: FeedbackStatus | null;
  error: string | null;
  onSubmit: (status: FeedbackStatus, values: FormValues) => void;
  cancelTo: string;
  discardTitle: string;
  discardMessage: string;
  // Work held outside the form (the create flows' recipient picks) that Cancel must guard too.
  parentDirty?: boolean;
  showTemplateInsert?: boolean;
  // Read-only requester display name; when set, a "Requester" cell is shown.
  requesterDisplay?: string;
  // Read-only requester clarification note; when non-empty, a disabled "Message from the
  // requester" field is shown. Immutable (captured at creation).
  requesterMessage?: string | null;
  // Visibility choices for the combo; defaults to the create set (Provider+subject / Public).
  visibilityOptions?: { value: FeedbackVisibility; label: string }[];
  // Epoch millis; when set, shows a read-only "Last modified" cell (edit flow only).
  lastModified?: number;
  // When set (edit flow), the bottom section is three tabs — Content+Preview, History (this
  // feedback's audit events), and Lifecycle (the state diagram). Omitted on create (no id) → no tabs.
  feedbackId?: number;
  // Current status of the feedback being edited; the header pill + the Lifecycle tab's node.
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
  parentDirty = false,
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
  const { t, i18n } = useTranslation();
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
  // The one cancel guard (v3.5.0): straight out while clean, the area's discard copy once dirty.
  const { requestCancel, guardProps } = useDiscardGuard({
    isDirty: () => parentDirty || form.isDirty(),
    to: cancelTo,
    title: discardTitle,
    message: discardMessage,
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

  // The app-wide person convention: PersonaChip for a named party, plain text for the
  // current user — driven by the explicit isYou flags, never by comparing display strings.
  const party = (display: string, isYou?: boolean) =>
    isYou ? <Text size="sm">{display}</Text> : <PersonaChip name={display} />;
  // The context line (v3.5.0 — the MetaStrip form idiom): who → whom · requested by · when.
  const meta: MetaStripItem[] = [
    { key: "provider", label: t("common.field.provider"), value: party(t("common.state.you"), true) },
  ];
  if (subjects != null && subjects.length > 0) {
    meta.push({
      key: "recipients",
      label: t("feedback.recipientsLabel"),
      value: (
        <Group gap={8} wrap="wrap">
          {subjects.map((s, index) => (
            // Position is the identity here (a name may legitimately repeat).
            <Fragment key={index}>{party(s.display, s.isYou)}</Fragment>
          ))}
        </Group>
      ),
    });
  }
  if (requesterDisplay != null) {
    meta.push({ key: "requester", label: t("common.field.requester"), value: party(requesterDisplay) });
  }
  if (lastModified != null) {
    meta.push({
      key: "lastModified",
      label: t("common.field.lastModified"),
      value: <Text size="sm">{formatDateTime(lastModified, i18n.language)}</Text>,
    });
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
    <Stack gap="sm">
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
    <>
      <PageHeader title={title} badge={currentStatus && <StatusBadge status={currentStatus} />} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit(() => onSubmit("DRAFT", form.values))} noValidate>
            <Stack>
              <MetaStrip items={meta} />
              <RequesterMessage value={requesterMessage} collapsible />
              {duplicate}
              {feedbackId != null ? (
                <Tabs defaultValue="content">
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("feedback.history")}</Tabs.Tab>
                    <Tabs.Tab value="lifecycle">{t("feedback.lifecycle")}</Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="content" pt="md">
                    {editorPane}
                  </Tabs.Panel>
                  <Tabs.Panel value="history" pt="md">
                    <FeedbackHistory feedbackId={feedbackId} />
                  </Tabs.Panel>
                  <Tabs.Panel value="lifecycle" pt="md">
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
              <FormFooter sticky>
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
                  onClick={requestCancel}
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
              </FormFooter>
            </Stack>
          </form>
        </Paper>
      </Container>

      <DiscardGuard {...guardProps} />
    </>
  );
}
