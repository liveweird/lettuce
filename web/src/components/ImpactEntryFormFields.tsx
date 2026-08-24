import { lazy, Suspense } from "react";
import { Group, Skeleton, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import { MAX_IMPACT_TEXT_LENGTH, type ImpactEntryFormValues } from "../utils/impactLogForm";

// ~0.5 MB of MDXEditor — one lazy chunk, loaded only when an entry form actually renders
// (four instances share it).
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

const SECTIONS: { field: keyof ImpactEntryFormValues & string; labelKey: ParseKeys }[] = [
  { field: "whatHappened", labelKey: "impactLog.whatHappened" },
  { field: "contribution", labelKey: "impactLog.contribution" },
  { field: "whyItMattered", labelKey: "impactLog.whyItMattered" },
  { field: "evidence", labelKey: "impactLog.evidence" },
];

/**
 * The shared create/edit fields of a journal entry (the GoalDefinitionFields idiom): the
 * period date pair (with the CreateDaysOff ordering nudge) and the four markdown sections.
 * MarkdownEditor renders no errors itself — the form errors render below each Suspense.
 */
export default function ImpactEntryFormFields({
  form,
}: {
  form: UseFormReturnType<ImpactEntryFormValues>;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
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
      {SECTIONS.map(({ field, labelKey }) => (
        <Stack key={field} gap={4}>
          <Suspense fallback={<Skeleton height={180} radius="sm" />}>
            <MarkdownEditor
              label={t(labelKey)}
              value={form.values[field]}
              onChange={(md) => form.setFieldValue(field, md)}
              maxLength={MAX_IMPACT_TEXT_LENGTH}
            />
          </Suspense>
          {form.errors[field] && (
            <Text size="sm" c="red">
              {form.errors[field]}
            </Text>
          )}
        </Stack>
      ))}
    </Stack>
  );
}
