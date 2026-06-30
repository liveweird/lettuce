import { useMemo, useState } from "react";
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
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  createFeedback,
  getUserId,
  listUsers,
  type FeedbackVisibility,
} from "../api/client";

// The provider picker realistically chooses from a bounded set; fetch up to the 100-row
// max (the list endpoint's cap). Fine at this app's scale.
const PICKER_PAGE_SIZE = 100;

const VISIBILITY_VALUES: FeedbackVisibility[] = [
  "PROVIDER_REQUESTER",
  "PROVIDER_REQUESTER_SUBJECT",
  "PUBLIC",
];

type Provider = { id: number; name: string };

export default function RequestFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const visibilityOptions = VISIBILITY_VALUES.map((value) => ({
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const { data: userPool } = useQuery({
    queryKey: ["users", "requestPicker"],
    queryFn: () => listUsers({ page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
  });

  const subjectIdIsValid = Number.isFinite(subjectId) && subjectId > 0;

  // A provider can be neither the subject (provider ≠ subject) nor the requester
  // (requester ≠ provider), and not already chosen.
  const addOptions = useMemo(() => {
    const chosen = new Set(selected.map((p) => p.id));
    return (userPool?.items ?? [])
      .filter((u) => u.id !== subjectId && u.id !== requesterId && !chosen.has(u.id))
      .map((u) => ({ value: String(u.id), label: u.name }));
  }, [userPool, selected, subjectId, requesterId]);

  if (!subjectIdIsValid || requesterId == null) return <Navigate to={backTo} replace />;

  function add() {
    if (!pick) return;
    const id = Number(pick);
    const user = (userPool?.items ?? []).find((u) => u.id === id);
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
          }),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      // Requesting feedback mints a requester confirmation — refresh the bell badge immediately.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("feedback.error.requestPermission"));
        } else if (err.status === 400) {
          setError(t("feedback.error.validationProviders"));
        } else {
          setError(t("feedback.error.requestFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("feedback.error.requestFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("feedback.requestFeedbackTitle")}</Title>

          <SimpleSubjectRequester subjectDisplay={subjectName ?? `#${subjectId}`} />

          <Select
            label={t("common.field.visibility")}
            placeholder={t("feedback.selectVisibility")}
            data={visibilityOptions}
            allowDeselect={false}
            value={visibility}
            onChange={(v) => v && setVisibility(v as FeedbackVisibility)}
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
                selected.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{p.name}</Table.Td>
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
                ))
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={2}>
                    <Text c="dimmed" ta="center">
                      {t("feedback.addAtLeastOneProvider")}
                    </Text>
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
              disabled={selected.length === 0}
            >
              {t("feedback.action.request")}
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Modal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("feedback.discardRequestTitle")}
        centered
      >
        <Stack gap="md">
          <Text>{t("feedback.discardRequestMessage")}</Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeCancel}>
              {t("common.action.keepEditing")}
            </Button>
            <Button color="red" component={RouterLink} to={backTo}>
              {t("common.action.discard")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}

function SimpleSubjectRequester({ subjectDisplay }: { subjectDisplay: string }) {
  const { t } = useTranslation();
  return (
    <Group grow>
      <TextInput label={t("common.field.subject")} value={subjectDisplay} disabled />
      <TextInput label={t("common.field.requester")} value={t("common.state.you")} disabled />
    </Group>
  );
}
