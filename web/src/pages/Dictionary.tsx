import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconPlus, IconListDetails } from "@tabler/icons-react";
import {
  getDictionary,
  isAdmin,
  updateDictionary,
  type DictionaryEntry,
  type DictionarySlug,
} from "../api/client";
import { showSuccessToast } from "../utils/toast";
import ConfirmActionModal from "../components/ConfirmActionModal";
import EmptyState from "../components/EmptyState";
import { RowControls } from "../components/ParagraphListEditor";
import {
  dictionaryFormValidation,
  dictionarySaveErrorMessage,
  emptyEntryDraft,
  toFormValues,
  toUpdateBody,
  type DictionaryFormValues,
} from "../utils/dictionaryForm";

// The four global dictionaries — the slug is both the route param and the API path segment.
const DICTIONARIES: Record<DictionarySlug, { titleKey: string }> = {
  "career-paths": { titleKey: "dictionary.title.careerPaths" },
  "career-specializations": { titleKey: "dictionary.title.careerSpecializations" },
  "seniority-levels": { titleKey: "dictionary.title.seniorityLevels" },
  "pulse-rotating-questions": { titleKey: "dictionary.title.pulseRotatingQuestions" },
};

const isDictionarySlug = (s: string | undefined): s is DictionarySlug =>
  s != null && s in DICTIONARIES;

/**
 * One page serves all four dictionaries (`/dictionaries/:slug`): everyone gets the ordered
 * read-only list; an ADMIN gets the whole-list document editor instead — add/edit/reorder/
 * remove rows locally, one Save replaces the dictionary atomically (the 1:1 editing idiom;
 * a removed entry is soft-deleted server-side).
 */
export default function Dictionary() {
  const { t } = useTranslation();
  const params = useParams<{ slug: string }>();
  const slug = isDictionarySlug(params.slug) ? params.slug : null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dictionary", slug],
    queryFn: () => getDictionary(slug as DictionarySlug),
    enabled: slug != null,
  });

  if (slug == null) return <Navigate to="/" replace />;

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t(DICTIONARIES[slug].titleKey)}</Title>
          {isError ? (
            <Alert color="red" variant="light" title={t("dictionary.loadFailed")}>
              {error instanceof Error ? error.message : t("dictionary.unknownError")}
            </Alert>
          ) : isLoading || !data ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isAdmin() ? (
            // Keyed by slug: switching between the three nav leaves remounts the editor, so
            // each dictionary starts from its own freshly loaded document.
            <DictionaryEditor key={slug} slug={slug} initialItems={data} />
          ) : (
            <ReadOnlyEntries items={data} />
          )}
        </Stack>
      </Paper>
    </Container>
  );
}

/**
 * The non-admin view: the ordered values as numbered rows, nothing clickable. The viewer's
 * language leads; the other language sits beneath, dimmed — the dictionary IS the one place
 * both languages are the content.
 */
function ReadOnlyEntries({ items }: { items: DictionaryEntry[] }) {
  const { t, i18n } = useTranslation();
  const pl = i18n.resolvedLanguage === "pl";
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconListDetails size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
        label={t("dictionary.empty")}
      />
    );
  }
  return (
    <Stack gap="xs">
      {items.map((entry, index) => (
        <Paper key={entry.id} withBorder p="sm" radius="md">
          <Group gap="xs" wrap="nowrap" align="flex-start">
            <Text size="sm" c="dimmed" w={24} ta="right" style={{ flexShrink: 0 }}>
              {index + 1}.
            </Text>
            <div>
              <Text size="sm">{pl ? entry.valuePl : entry.valueEn}</Text>
              <Text size="xs" c="dimmed">
                {pl ? entry.valueEn : entry.valuePl}
              </Text>
            </div>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

function DictionaryEditor({
  slug,
  initialItems,
}: {
  slug: DictionarySlug;
  initialItems: DictionaryEntry[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<DictionaryFormValues>({
    initialValues: toFormValues(initialItems),
    validate: dictionaryFormValidation(t),
  });

  async function save(values: DictionaryFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateDictionary(slug, toUpdateBody(values));
      // Re-seed from the server so new rows carry their minted ids (a resubmit must rename,
      // not insert twice) and the saved state becomes the new dirty/reset baseline.
      const fresh = await getDictionary(slug);
      queryClient.setQueryData(["dictionary", slug], fresh);
      const freshValues = toFormValues(fresh);
      form.setInitialValues(freshValues);
      form.setValues(freshValues);
      form.resetDirty();
      showSuccessToast(t("dictionary.toast.saved"));
    } catch (err) {
      setError(dictionarySaveErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  function discard() {
    form.reset();
    setError(null);
    closeCancel();
  }

  const rows = form.values.entries;

  return (
    <form onSubmit={form.onSubmit(save)} noValidate>
      <Stack>
        {rows.length === 0 && (
          <Text c="dimmed" size="sm">
            {t("dictionary.empty")}
          </Text>
        )}
        {rows.length > 0 && (
          // Column headers for the two language inputs (the placeholders vanish once
          // filled). The row structure is mirrored — number gutter, two grown columns,
          // and an invisible RowControls clone reserving exactly the controls' width —
          // so the labels stay aligned with the columns at any viewport.
          <Group align="flex-start" gap="xs" wrap="nowrap" px="sm" mb={-8}>
            <Box w={24} style={{ flexShrink: 0 }} />
            <Group style={{ flex: 1 }} gap="xs" grow>
              <Text size="sm" fw={500}>
                {t("dictionary.languageEn")}
              </Text>
              <Text size="sm" fw={500}>
                {t("dictionary.languagePl")}
              </Text>
            </Group>
            <Box aria-hidden style={{ visibility: "hidden" }}>
              <RowControls
                index={0}
                count={1}
                onMoveUp={() => {}}
                onMoveDown={() => {}}
                onRemove={() => {}}
                moveUpLabel=""
                moveDownLabel=""
                removeLabel=""
              />
            </Box>
          </Group>
        )}
        {rows.map((row, index) => (
          <Paper key={row.key} withBorder p="sm" radius="md">
            <Group align="flex-start" gap="xs" wrap="nowrap">
              <Text size="sm" c="dimmed" w={24} ta="right" pt={8} style={{ flexShrink: 0 }}>
                {index + 1}.
              </Text>
              {/* Both languages side by side (stacking on narrow screens): every entry is
                  bilingual, both fields required. */}
              <Group style={{ flex: 1 }} gap="xs" align="flex-start" grow>
                <TextInput
                  aria-label={t("dictionary.entryAriaEn", { position: index + 1 })}
                  placeholder={t("dictionary.languageEn")}
                  {...form.getInputProps(`entries.${index}.valueEn`)}
                />
                <TextInput
                  aria-label={t("dictionary.entryAriaPl", { position: index + 1 })}
                  placeholder={t("dictionary.languagePl")}
                  {...form.getInputProps(`entries.${index}.valuePl`)}
                />
              </Group>
              <RowControls
                index={index}
                count={rows.length}
                onMoveUp={() => form.reorderListItem("entries", { from: index, to: index - 1 })}
                onMoveDown={() => form.reorderListItem("entries", { from: index, to: index + 1 })}
                onRemove={() => form.removeListItem("entries", index)}
                moveUpLabel={t("dictionary.moveUp", { position: index + 1 })}
                moveDownLabel={t("dictionary.moveDown", { position: index + 1 })}
                removeLabel={t("dictionary.removeEntry", { position: index + 1 })}
              />
            </Group>
          </Paper>
        ))}
        <Group>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => form.insertListItem("entries", emptyEntryDraft())}
          >
            {t("dictionary.addEntry")}
          </Button>
        </Group>

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
            disabled={submitting || !form.isDirty()}
          >
            {t("common.action.cancel")}
          </Button>
          <Button type="submit" loading={submitting} disabled={!form.isDirty()}>
            {t("common.action.save")}
          </Button>
        </Group>
      </Stack>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("dictionary.discardTitle")}
        message={t("dictionary.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        onConfirm={discard}
      />
    </form>
  );
}
