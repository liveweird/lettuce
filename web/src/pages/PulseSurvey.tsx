import { Alert, Button, Container, Group, Paper, Progress, Skeleton, Stack, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconZzz } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  getMyPulseResponse,
  listPulseCycles,
  submitMyPulseResponse,
  type PulseScaleAnswer,
} from "../api/client";
import EmptyState from "../components/EmptyState";
import PulseEnpsInput from "../components/PulseEnpsInput";
import PulseScaleInput from "../components/PulseScaleInput";
import { formatIsoDate } from "../utils/datetime";
import { invalidatePulse } from "../utils/pulseQueries";
import {
  PULSE_MAX_COMMENT,
  answeredCount,
  commentPromptKey,
  emptyPulseFormValues,
  pulseFormValidation,
  pulseSaveErrorMessage,
  toPulseFormValues,
  toPulseSubmitBody,
  type PulseFormValues,
  type PulseScaleField,
} from "../utils/pulseSurveyForm";
import { showSuccessToast } from "../utils/toast";

// The fixed statements Q2-Q5 (localized); Q6 uses the cycle's server-provided rotating text.
const FIXED_LABEL_KEY: Record<Exclude<PulseScaleField, "rotating">, string> = {
  q2: "pulse.q2",
  q3: "pulse.q3",
  q4: "pulse.q4",
  q5: "pulse.q5",
};

/**
 * The "Current survey" tab: one short scrolling form over the OPEN cycle. All six scored
 * questions are required; the comment is optional with a band-dependent prompt. Prevent-
 * duplicate + edit-while-open both fall out of the server's upsert: the form prefills from
 * the saved answers and re-submitting replaces them (until the admin closes the cycle).
 */
export default function PulseSurvey() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cycles = useQuery({ queryKey: ["pulseCycles"], queryFn: listPulseCycles });
  const openCycle = cycles.data?.find((c) => c.status === "OPEN");

  const saved = useQuery({
    queryKey: ["pulseSurvey", openCycle?.id],
    queryFn: async () => {
      try {
        return await getMyPulseResponse(openCycle!.id);
      } catch (err) {
        // 404 = nothing submitted yet — a blank form, not an error.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: openCycle != null,
    retry: false,
  });

  const form = useForm<PulseFormValues>({
    initialValues: emptyPulseFormValues(),
    validate: pulseFormValidation(t),
  });
  if (saved.isSuccess && !form.initialized) {
    form.initialize(saved.data ? toPulseFormValues(saved.data) : emptyPulseFormValues());
  }

  if (cycles.isLoading || (openCycle && saved.isLoading)) {
    return <Skeleton height={280} radius="md" />;
  }
  if (cycles.isError) {
    return (
      <Alert color="red" variant="light">
        {t("pulse.error.loadFailed")}
      </Alert>
    );
  }
  // No open cycle, or not snapshotted as a participant: a clear status message, never data.
  if (!openCycle) {
    return <EmptyState icon={<IconZzz size={32} />} label={t("pulse.noOpenSurvey")} />;
  }
  if (saved.isError) {
    const status = saved.error instanceof ApiError ? saved.error.status : null;
    return (
      <EmptyState
        icon={<IconZzz size={32} />}
        label={status === 403 ? t("pulse.notParticipant") : t("pulse.error.loadFailed")}
      />
    );
  }

  const answered = answeredCount(form.values);
  const alreadySubmitted = saved.data != null;
  const closeDate = formatIsoDate(openCycle.plannedCloseDate, locale);

  async function save(values: PulseFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      await submitMyPulseResponse(openCycle!.id, toPulseSubmitBody(values));
      showSuccessToast(t("pulse.toast.submitted"));
      await invalidatePulse(queryClient);
    } catch (err) {
      setError(pulseSaveErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(save)} noValidate>
          <Stack gap="lg">
            <Text size="sm" c="dimmed">
              {t("pulse.surveyIntro")}
            </Text>
            {alreadySubmitted ? (
              <Alert color="teal" variant="light">
                {t("pulse.editableUntil", { date: closeDate })}
              </Alert>
            ) : (
              <Text size="sm" c="dimmed">
                {t("pulse.closesOn", { date: closeDate })}
              </Text>
            )}
            <div>
              <Text size="sm" c="dimmed">
                {t("pulse.progress", { answered })}
              </Text>
              <Progress value={(answered / 6) * 100} size="sm" mt={4} />
            </div>

            <PulseEnpsInput
              value={form.values.enps}
              onChange={(value) => form.setFieldValue("enps", value)}
              error={form.errors.enps}
            />
            {(Object.keys(FIXED_LABEL_KEY) as (keyof typeof FIXED_LABEL_KEY)[]).map((field) => (
              <PulseScaleInput
                key={field}
                label={t(FIXED_LABEL_KEY[field])}
                value={form.values[field]}
                onChange={(value: PulseScaleAnswer) => form.setFieldValue(field, value)}
                error={form.errors[field]}
              />
            ))}
            {/* Q6: the rotating question, in the cycle's snapshotted wording (admin-authored
                dictionary content — deliberately NOT localized). */}
            <PulseScaleInput
              label={openCycle.rotatingQuestion ?? ""}
              value={form.values.rotating}
              onChange={(value: PulseScaleAnswer) => form.setFieldValue("rotating", value)}
              error={form.errors.rotating}
            />

            <Textarea
              label={t(`pulse.commentPrompt.${commentPromptKey(form.values.enps)}`)}
              description={t("pulse.commentOptional", { max: PULSE_MAX_COMMENT })}
              autosize
              minRows={3}
              maxLength={PULSE_MAX_COMMENT}
              {...form.getInputProps("comment")}
            />
            <Text size="xs" c="dimmed">
              {t("pulse.anonymityNote")}
            </Text>

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button type="submit" loading={submitting}>
                {alreadySubmitted ? t("pulse.action.update") : t("pulse.action.submit")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
