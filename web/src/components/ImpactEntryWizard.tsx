import { lazy, Suspense, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Skeleton,
  Stack,
  Stepper,
  Text,
  TextInput,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import type { ImpactEntryFormValues } from "../utils/impactLogForm";
import { IMPACT_SECTIONS, MAX_IMPACT_TEXT_LENGTH, MAX_IMPACT_TITLE_LENGTH } from "../utils/impactLogForm";
import { charCountDescription } from "../utils/charCount";
import ImpactEntrySections from "./ImpactEntrySections";

// ~0.5 MB of MDXEditor — one lazy chunk; only the ACTIVE step's instance mounts.
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

// The four writing steps, in journey order (the shared IMPACT_SECTIONS carries each step's
// field + the full question shown inside it); `stepKey` is the short name on the Stepper rail.
const STEP_KEYS: ParseKeys[] = [
  "impactLog.step.whatHappened",
  "impactLog.step.contribution",
  "impactLog.step.whyItMattered",
  "impactLog.step.evidence",
];
const SECTIONS = IMPACT_SECTIONS.map((section, i) => ({ ...section, stepKey: STEP_KEYS[i] }));

const REVIEW_STEP = SECTIONS.length;

/**
 * The shared create/edit wizard of a journal entry (v2.37.0 — the repo's first Mantine
 * `Stepper`): the period date pair stays PERMANENTLY visible above the rail (it is not a
 * step; the CreateDaysOff ordering nudge kept), then one markdown section per step and a
 * read-only Review step carrying the submit button. Back — the footer button or clicking a
 * visited step on the rail — never loses input (all values live in the page's single
 * `useForm`; only the rendered step changes); skipping ahead is impossible
 * (`allowNextStepsSelect={false}`, and Next validates the period pair + the current section
 * first). Submit still goes through `form.onSubmit` as the full-validation backstop.
 *
 * The embedding page keeps owning `useForm`, the save handler, toasts, navigation, and the
 * MarkdownEditor-form discard confirm behind [onCancel].
 */
export default function ImpactEntryWizard({
  form,
  submitLabel,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  form: UseFormReturnType<ImpactEntryFormValues>;
  /** The Review step's submit wording — Create on the create screen, Save on the editor. */
  submitLabel: string;
  submitting: boolean;
  /** The page's save-failure message, rendered above the footer (errors stay inline). */
  error: string | null;
  onCancel: () => void;
  /**
   * The page's validated submit (`() => form.onSubmit(save)()` — the PulseSurvey no-form
   * idiom). Deliberately NOT a native type="submit" button: the Evidence step's Next click
   * mounts the submit button under the pointer, and the browser's click ACTIVATION re-hit-tests
   * after React's sync re-render — a type="submit" there submits the form from the Next click
   * itself, skipping the Review step entirely (observed in Chromium). A type="button" has no
   * activation behavior, so the phantom activation is inert.
   */
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  // Next gates on the always-visible header fields (title + period pair) plus the current
  // section — invalid input renders inline at its field and the journey stays put.
  function next() {
    const invalid = [
      form.validateField("title").hasError,
      form.validateField("periodStart").hasError,
      form.validateField("periodEnd").hasError,
      step < SECTIONS.length && form.validateField(SECTIONS[step].field).hasError,
    ].some(Boolean);
    if (!invalid) setStep((s) => Math.min(s + 1, REVIEW_STEP));
  }

  return (
    <Stack gap="lg">
      {/* The entry's header identity (v2.37.0) — like the period pair, the title is NOT a
          step: it stays visible and editable on every step. */}
      <TextInput
        withAsterisk
        label={t("impactLog.title")}
        maxLength={MAX_IMPACT_TITLE_LENGTH}
        description={charCountDescription(form.values.title.length, MAX_IMPACT_TITLE_LENGTH)}
        {...form.getInputProps("title")}
      />
      <Group align="flex-end" gap="md" wrap="wrap">
        <TextInput
          type="date"
          withAsterisk
          label={t("impactLog.periodStart")}
          value={form.values.periodStart}
          error={form.errors.periodStart}
          onChange={(e) => {
            const v = e.currentTarget.value;
            form.setFieldValue("periodStart", v);
            // Keep the range ordered (the CreateDaysOff nudge).
            if (v && form.values.periodEnd && v > form.values.periodEnd) {
              form.setFieldValue("periodEnd", v);
            }
          }}
          w={180}
        />
        <TextInput
          type="date"
          withAsterisk
          label={t("impactLog.periodEnd")}
          min={form.values.periodStart || undefined}
          value={form.values.periodEnd}
          error={form.errors.periodEnd}
          onChange={(e) => form.setFieldValue("periodEnd", e.currentTarget.value)}
          w={180}
        />
      </Group>

      {/* Visited steps are click-to-return; future steps stay unclickable (no skipping). */}
      <Stepper active={step} onStepClick={setStep} allowNextStepsSelect={false} size="sm">
        {SECTIONS.map(({ field, stepKey }) => (
          <Stepper.Step key={field} label={t(stepKey)} />
        ))}
        <Stepper.Step label={t("impactLog.step.review")} />
      </Stepper>

      {step < REVIEW_STEP ? (
        <Stack gap={4}>
          <Suspense fallback={<Skeleton height={180} radius="sm" />}>
            <MarkdownEditor
              label={t(SECTIONS[step].labelKey)}
              value={form.values[SECTIONS[step].field]}
              onChange={(md) => form.setFieldValue(SECTIONS[step].field, md)}
              maxLength={MAX_IMPACT_TEXT_LENGTH}
            />
          </Suspense>
          {form.errors[SECTIONS[step].field] && (
            <Text size="sm" c="var(--lettuce-ink-error)">
              {form.errors[SECTIONS[step].field]}
            </Text>
          )}
        </Stack>
      ) : (
        // The Review step: everything written, rendered read-only in the shared collapsible
        // sections (expanded by default — contract what you're done re-reading).
        <Stack gap="lg">
          <Text size="sm" c="dimmed">
            {t("impactLog.reviewHint")}
          </Text>
          <ImpactEntrySections values={form.values} />
        </Stack>
      )}

      {error && (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      )}

      <Group justify="flex-end" gap="sm">
        <Button type="button" variant="default" onClick={onCancel} disabled={submitting}>
          {t("common.action.cancel")}
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={() => setStep((s) => Math.max(s - 1, 0))}
          disabled={step === 0 || submitting}
        >
          {t("impactLog.action.back")}
        </Button>
        {step < REVIEW_STEP ? (
          <Button type="button" onClick={next}>
            {t("impactLog.action.next")}
          </Button>
        ) : (
          <Button type="button" onClick={onSubmit} loading={submitting}>
            {submitLabel}
          </Button>
        )}
      </Group>
    </Stack>
  );
}
