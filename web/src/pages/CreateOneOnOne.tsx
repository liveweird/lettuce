import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createOneOnOne, listTeamMembers } from "../api/client";
import PersonaField from "../components/PersonaField";
import { todayIsoDate } from "../utils/datetime";
import { saveErrorMessage } from "../utils/saveError";

const BACK_TO = "/one-on-ones?tab=managed";

// The subordinate picker chooses from the caller's direct reports; fetch up to the 100-row
// max (the list endpoint's cap). Fine at this app's scale.
const PICKER_PAGE_SIZE = 100;

/**
 * Creating a 1:1 is deliberately minimal — subordinate + date — and immediately lands on the
 * edit screen: the server copies the previous meeting's unresolved action items on create, so
 * the manager starts documenting from the open backlog rather than an empty form.
 *
 * The Dashboard's "New 1:1" card button prefills the subordinate via query params
 * (`subordinateId`/`subordinateName`/`back` — the app-wide create-screen convention); a
 * prefilled subordinate renders read-only and Cancel returns to `back`.
 */
export default function CreateOneOnOne() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const preselectedId = Number(searchParams.get("subordinateId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const subordinateName = searchParams.get("subordinateName");
  const backTo = searchParams.get("back") ?? BACK_TO;

  const [subordinate, setSubordinate] = useState<string | null>(
    preselected ? String(preselectedId) : null,
  );
  const [meetingDate, setMeetingDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // view=managed lists the caller's direct reports — exactly who a 1:1 can be held with.
  // A prefilled subordinate needs no picker (and no fetch).
  const { data: reports } = useQuery({
    queryKey: ["teamMembers", "oneOnOnePicker"],
    queryFn: () =>
      listTeamMembers({ view: "managed", page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: !preselected,
  });

  // One row per (user, team) arrives; the picker wants one option per person.
  const options = useMemo(() => {
    const seen = new Map<number, string>();
    for (const row of reports?.items ?? []) {
      if (!seen.has(row.userId)) seen.set(row.userId, row.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ value: String(id), label: name }));
  }, [reports]);

  async function submit() {
    if (!subordinate || !meetingDate) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createOneOnOne({
        subordinateId: Number(subordinate),
        meetingDate,
        points: [],
        decisions: [],
        actionItems: [],
      });
      await queryClient.invalidateQueries({ queryKey: ["oneOnOnes"] });
      // Creation notifies the subordinate — refresh the bell badge.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(`/one-on-ones/${created.id}/edit?from=managed`, { replace: true });
    } catch (err) {
      // Unlike PUT (where 409 means "not the latest"), a create 409 is unambiguous: the date
      // is earlier than the pair's latest meeting (the chronological rule).
      setError(
        saveErrorMessage(err, t, {
          forbidden: "oneOnOne.error.permission",
          notFound: "oneOnOne.error.gone",
          conflict: "oneOnOne.error.backdated",
          invalid: "oneOnOne.error.validation",
          failedStatus: "oneOnOne.error.saveFailedStatus",
          failed: "oneOnOne.error.saveFailed",
        }),
      );
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("oneOnOne.createTitle")}</Title>
          <Text c="dimmed" size="sm">
            {t("oneOnOne.createHint")}
          </Text>

          {preselected ? (
            // Launched from a subordinate's Dashboard card: the party is fixed, not editable.
            <PersonaField
              label={t("oneOnOne.subordinate")}
              name={subordinateName ?? `#${preselectedId}`}
            />
          ) : (
            <Select
              label={t("oneOnOne.subordinate")}
              placeholder={t("oneOnOne.pickSubordinate")}
              data={options}
              value={subordinate}
              onChange={setSubordinate}
              searchable
              clearable
              nothingFoundMessage={t("oneOnOne.noReports")}
            />
          )}

          <TextInput
            type="date"
            label={t("oneOnOne.meetingDate")}
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.currentTarget.value)}
            w={200}
          />

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button component={RouterLink} to={backTo} variant="default" disabled={submitting}>
              {t("common.action.cancel")}
            </Button>
            <Button
              type="button"
              onClick={submit}
              loading={submitting}
              disabled={!subordinate || !meetingDate}
            >
              {t("common.action.create")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
