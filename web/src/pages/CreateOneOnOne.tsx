import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from "react-router-dom";
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
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { toReportOptions, useManagedReports } from "../hooks/useManagedReports";
import { createOneOnOne } from "../api/oneonones";
import PersonaField from "../components/PersonaField";
import { todayIsoDate } from "../utils/datetime";
import { oneOnOneSaveErrorMessage } from "../utils/oneOnOneForm";
import { invalidateOneOnOne } from "../utils/oneOnOneQueries";
import { showSuccessToast } from "../utils/toast";

const BACK_TO = "/one-on-ones?tab=managed";

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
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [subordinate, setSubordinate] = useState<string | null>(
    preselected ? String(preselectedId) : null,
  );
  const [meetingDate, setMeetingDate] = useState(todayIsoDate());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // view=managed lists the caller's direct reports — exactly who a 1:1 can be held with.
  // A prefilled subordinate needs no picker (and no fetch).
  const { reports, reportsError } = useManagedReports(!preselected);
  const options = toReportOptions(reports);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("ONE_ON_ONES")) return <Navigate to="/" replace />;

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
      // Creation notifies the subordinate and moves the cards' "Last 1:1" stat.
      await invalidateOneOnOne(queryClient);
      showSuccessToast(t("oneOnOne.toast.created"));
      // Carry the origin (if any) into the edit screen so its Close returns to the card/drill-down
      // this create was launched from, not the generic managed list.
      const editUrl = backParam
        ? `/one-on-ones/${created.id}/edit?from=managed&back=${encodeURIComponent(backParam)}`
        : `/one-on-ones/${created.id}/edit?from=managed`;
      navigate(editUrl, { replace: true });
    } catch (err) {
      // Unlike PUT (where 409 means "not the latest"), a create 409 is unambiguous: the date
      // is earlier than the pair's latest meeting (the chronological rule).
      setError(oneOnOneSaveErrorMessage(err, t, "oneOnOne.error.backdated"));
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
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
              error={reportsError ? t("common.error.optionsFailed") : undefined}
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
