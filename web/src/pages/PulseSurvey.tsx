import { Alert, Button, Container, Group, Paper, Progress, Skeleton, Stack, Text, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconZzz } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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

// One question per wizard step: 0 = Q1 eNPS, 1-4 = the fixed statements, 5 = the rotating
// question, 6 = the optional comment (+ submit). The fixed Q2-Q5 labels are localized; Q6
// uses the cycle's server-provided rotating text.
const TOTAL_STEPS = 7;
const COMMENT_STEP = TOTAL_STEPS - 1;
const STEP_FIELD: Record<number, PulseScaleField> = { 1: "q2", 2: "q3", 3: "q4", 4: "q5", 5: "rotating" };
const FIXED_LABEL_KEY: Record<Exclude<PulseScaleField, "rotating">, string> = {
  q2: "pulse.q2",
  q3: "pulse.q3",
  q4: "pulse.q4",
  q5: "pulse.q5",
};

function stepAnswered(step: number, values: PulseFormValues): boolean {
  if (step === COMMENT_STEP) return true;
  if (step === 0) return values.enps !== null;
  return values[STEP_FIELD[step]] !== null;
}

/**
 * The "Current survey" tab as a WIZARD (v2.0.1): one question per step, Back/Next traversal,
 * and auto-advance a beat after answering a scored question. All six scored questions stay
 * required — Next gates per step, the form validation backstops the submit. Prevent-duplicate
 * + edit-while-open both fall out of the server's upsert: the wizard prefills from the saved
 * answers and re-submitting replaces them (until the admin closes the cycle); a successful
 * save restarts at the first question for review.
 */
export default function PulseSurvey() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const advanceTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (advanceTimer.current != null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

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

  // Answering a scored question advances after a short beat (the selection stays visible for
  // a moment); Back is the way to linger. Re-answering an already-given answer advances too.
  function scheduleAdvance() {
    if (advanceTimer.current != null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => {
      advanceTimer.current = null;
      setStep((current) => Math.min(current + 1, COMMENT_STEP));
    }, 250);
  }

  function goTo(next: number) {
    if (advanceTimer.current != null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    setStep(Math.max(0, Math.min(next, COMMENT_STEP)));
  }

  async function save(values: PulseFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      await submitMyPulseResponse(openCycle!.id, toPulseSubmitBody(values));
      showSuccessToast(t("pulse.toast.submitted"));
      await invalidatePulse(queryClient);
      // Restart at the first question — the saved state prefills for review/editing.
      goTo(0);
    } catch (err) {
      setError(pulseSaveErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  const scaleField = STEP_FIELD[step];
  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
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
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                {t("pulse.stepCounter", { current: step + 1, total: TOTAL_STEPS })}
              </Text>
              <Text size="sm" c="dimmed">
                {t("pulse.progress", { answered })}
              </Text>
            </Group>
            <Progress value={(answered / 6) * 100} size="sm" mt={4} />
          </div>

          {step === 0 && (
            <PulseEnpsInput
              value={form.values.enps}
              onChange={(value) => {
                form.setFieldValue("enps", value);
                scheduleAdvance();
              }}
              error={form.errors.enps}
            />
          )}
          {scaleField != null && (
            <PulseScaleInput
              // Q6: the rotating question, in the cycle's snapshotted wording (admin-authored
              // dictionary content — deliberately NOT localized).
              label={
                scaleField === "rotating"
                  ? (openCycle.rotatingQuestion ?? "")
                  : t(FIXED_LABEL_KEY[scaleField])
              }
              value={form.values[scaleField]}
              onChange={(value: PulseScaleAnswer) => {
                form.setFieldValue(scaleField, value);
                scheduleAdvance();
              }}
              error={form.errors[scaleField]}
            />
          )}
          {step === COMMENT_STEP && (
            <>
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
            </>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
          <Group justify="space-between">
            <Button variant="default" onClick={() => goTo(step - 1)} disabled={step === 0}>
              {t("pulse.action.back")}
            </Button>
            {step < COMMENT_STEP ? (
              <Button
                variant="default"
                onClick={() => goTo(step + 1)}
                disabled={!stepAnswered(step, form.values)}
              >
                {t("pulse.action.next")}
              </Button>
            ) : (
              <Button onClick={() => form.onSubmit(save)()} loading={submitting}>
                {alreadySubmitted ? t("pulse.action.update") : t("pulse.action.submit")}
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
