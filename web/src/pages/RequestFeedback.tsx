import { useMemo, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import EmojiTextarea from "../components/EmojiTextarea";
import { MAX_REQUESTER_MESSAGE_LENGTH } from "../utils/feedbackForm";
import { feedbackViewLink } from "../utils/feedbackLinks";
import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { listAllUsers } from "../api/users";
import { checkFeedbackDuplicate, createFeedback, type FeedbackVisibility } from "../api/feedbacks";
import ConfirmActionModal from "../components/ConfirmActionModal";
import EmptyState from "../components/EmptyState";
import PersonaChip from "../components/PersonaChip";
import PersonaField from "../components/PersonaField";
import { REQUESTER_VISIBILITIES } from "../utils/feedbackVisibility";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

// The provider picker realistically chooses from a bounded set; fetch up to the 100-row
// max (the list endpoint's cap). Fine at this app's scale.
type Provider = { id: number; name: string };

export default function RequestFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const visibilityOptions = REQUESTER_VISIBILITIES.map((value) => ({
    value,
    label: t(`common.visibility.${value}`),
  }));

  const subjectId = Number(searchParams.get("subjectId"));
  const subjectName = searchParams.get("subjectName");
  // Return to the Dashboard tab the user came from; default to subordinates.
  const backTo = searchParams.get("back") ?? "/?tab=subordinates";
  const requesterId = getUserId();

  const [selected, setSelected] = useState<Provider[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<FeedbackVisibility>("PROVIDER_REQUESTER_SUBJECT");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const { data: userPool } = useQuery({
    queryKey: ["users", "requestPicker"],
    // ALL pages (the single-page-picker lesson): this is the org-wide provider pool — a
    // single name-sorted page of 100 silently hides providers in any larger org.
    queryFn: () => listAllUsers(),
    staleTime: 5 * 60 * 1000,
  });

  const subjectIdIsValid = Number.isFinite(subjectId) && subjectId > 0;

  // Early no-duplicate check, one triple per picked provider: providers whose feedback is
  // already in progress get an inline warning with a link, and Request stays disabled until
  // they are removed (the server would 409 anyway).
  const selectedIds = selected.map((p) => p.id).sort((a, b) => a - b);
  const { data: duplicateData } = useQuery({
    queryKey: ["feedbackDuplicate", "request", subjectId, requesterId, selectedIds.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        selectedIds.map(async (providerId) => {
          const result = await checkFeedbackDuplicate({
            subjectId,
            providerId,
            requesterId: requesterId!,
          });
          return [providerId, result] as const;
        }),
      );
      return new Map(entries.filter(([, r]) => r.existingId != null));
    },
    enabled: subjectIdIsValid && requesterId != null && selectedIds.length > 0,
  });
  const duplicates = duplicateData ?? new Map<number, { existingId?: number | null; existingStatus?: string | null }>();
  const hasDuplicates = selected.some((p) => duplicates.has(p.id));

  // A provider cannot be the requester (requester ≠ provider) and cannot be already chosen.
  // The subject IS offered: picking them asks the subject for a self-reflection
  // (provider == subject — see "Self-reflection" in the backend rules).
  const addOptions = useMemo(() => {
    const chosen = new Set(selected.map((p) => p.id));
    return (userPool ?? [])
      .filter((u) => u.id !== requesterId && !chosen.has(u.id))
      .map((u) => ({ value: String(u.id), label: u.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [userPool, selected, requesterId]);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (!subjectIdIsValid || requesterId == null) return <Navigate to={backTo} replace />;

  function add() {
    if (!pick) return;
    const id = Number(pick);
    const user = (userPool ?? []).find((u) => u.id === id);
    if (!user) return;
    setSelected((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, { id, name: user.name }]));
    setPick(null);
  }

  function remove(id: number) {
    setSelected((prev) => prev.filter((p) => p.id !== id));
  }

  async function submit() {
    if (selected.length === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await Promise.all(
        selected.map((p) =>
          createFeedback({
            requesterId: requesterId!,
            subjectId,
            providerId: p.id,
            visibility,
            status: "REQUESTED",
            content: "",
            requesterMessage: message.trim() || undefined,
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      // Requesting feedback mints a requester confirmation — refresh the bell badge immediately.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      showSuccessToast(t("feedback.toast.requested"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "feedback.error.requestPermission",
          conflict: "feedback.error.duplicate",
          invalid: "feedback.error.validationProviders",
          failedStatus: "feedback.error.requestFailedStatus",
          failed: "feedback.error.requestFailed",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("feedback.requestFeedbackTitle")}</Title>

          <Group gap="xl">
            <PersonaField
              label={t("common.field.subject")}
              name={subjectName ?? `#${subjectId}`}
              you={subjectId === requesterId}
            />
            <PersonaField label={t("common.field.requester")} you />
          </Group>

          <Select
            label={t("common.field.visibility")}
            placeholder={t("feedback.selectVisibility")}
            data={visibilityOptions}
            allowDeselect={false}
            value={visibility}
            onChange={(v) => v && setVisibility(v as FeedbackVisibility)}
          />

          <EmojiTextarea
            label={t("feedback.requesterMessageLabel")}
            placeholder={t("feedback.requesterMessagePlaceholder")}
            value={message}
            onChange={setMessage}
            maxLength={MAX_REQUESTER_MESSAGE_LENGTH}
            autosize
            minRows={2}
            maxRows={6}
          />

          <Group align="flex-end" gap="sm">
            <Select
              label={t("feedback.addProvider")}
              placeholder={t("feedback.pickUser")}
              data={addOptions}
              value={pick}
              onChange={setPick}
              searchable
              clearable
              nothingFoundMessage={t("feedback.noUsersAvailable")}
              w={280}
            />
            <Button leftSection={<IconPlus size={16} />} onClick={add} disabled={!pick}>
              {t("feedback.add")}
            </Button>
          </Group>

          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("common.field.provider")}</Table.Th>
                <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {selected.length > 0 ? (
                selected.map((p) => {
                  const dup = duplicates.get(p.id);
                  return (
                    <Table.Tr key={p.id}>
                      <Table.Td>
                        <PersonaChip name={p.name} />
                        {dup?.existingId != null && (
                          <Text size="xs" c="orange.8" mt={4}>
                            {dup.existingStatus === "DRAFT"
                              ? t("feedback.duplicate.draft")
                              : t("feedback.duplicate.requested")}{" "}
                            <Anchor
                              component={RouterLink}
                              to={feedbackViewLink(dup.existingId)}
                              size="xs"
                              fw={600}
                              c="orange"
                            >
                              {t("feedback.duplicate.open")}
                            </Anchor>
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Button
                          color="red"
                          variant="subtle"
                          size="xs"
                          leftSection={<IconTrash size={14} />}
                          onClick={() => remove(p.id)}
                          aria-label={t("feedback.removeName", { name: p.name })}
                        >
                          {t("feedback.remove")}
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  );
                })
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={2}>
                    <EmptyState
                        icon={<IconUserPlus size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                        label={t("feedback.addAtLeastOneProvider")}
                      />
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
              {t("common.action.cancel")}
            </Button>
            <Button
              type="button"
              onClick={submit}
              loading={submitting}
              disabled={selected.length === 0 || hasDuplicates}
            >
              {t("feedback.action.request")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("feedback.discardRequestTitle")}
        message={t("feedback.discardRequestMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
    </Container>
  );
}
