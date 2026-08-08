import { Chip, Group, Input, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { enpsColor, mantineColorVar } from "../utils/pulseSurveyForm";

/**
 * Q1, the 0-10 eNPS pick. Chips (single-select) rather than a SegmentedControl: an unanswered
 * survey must show NO selection, and chips model the null state cleanly while staying
 * one-tap on mobile. The anchor captions carry the scale's meaning, and each chip carries its
 * eNPS band color (detractors orange → passives yellow → promoters green): the number is
 * tinted while unchecked so the gradient reads at a glance, and the checked chip fills in
 * the same color.
 */
export default function PulseEnpsInput({
  value,
  onChange,
  error,
}: {
  value: number | null;
  onChange: (value: number) => void;
  error?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Input.Wrapper label={t("pulse.q1")} withAsterisk error={error}>
      <Chip.Group
        multiple={false}
        value={value === null ? null : String(value)}
        onChange={(v) => {
          if (typeof v === "string") onChange(Number(v));
        }}
      >
        <Group gap={6} pt={6} wrap="wrap">
          {Array.from({ length: 11 }, (_, score) => (
            <Chip
              key={score}
              value={String(score)}
              size="sm"
              radius="sm"
              variant="outline"
              color={enpsColor(score)}
              styles={
                value === score
                  ? undefined
                  : { label: { color: mantineColorVar(enpsColor(score)) } }
              }
            >
              {score}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <Group justify="space-between" pt={4}>
        <Text size="xs" c="dimmed">
          {t("pulse.q1Low")}
        </Text>
        <Text size="xs" c="dimmed">
          {t("pulse.q1High")}
        </Text>
      </Group>
    </Input.Wrapper>
  );
}
