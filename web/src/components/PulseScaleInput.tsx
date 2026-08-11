import { ColorSwatch, Group, Radio, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PulseScaleAnswer } from "../api/client";
import { PULSE_SCALE_VALUES, mantineColorVar, pulseScaleColor } from "../utils/pulseSurveyForm";

/**
 * One driver question (Q2-Q6) on the five-point agreement scale + "Not applicable". A
 * Radio.Group so every point carries its full label; the options stack vertically (v2.5.9 —
 * in a horizontal row the empty radio circles read too much like the colored swatches), with
 * N/A last so it doesn't read as "worse than strongly disagree". Values are the API's wire
 * strings directly. Each point carries its favourability color (the performance-review rating
 * swatch pattern): a swatch beside the label makes the orange→green ramp visible before any
 * selection, and the checked radio fills in the same color.
 */
export default function PulseScaleInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: PulseScaleAnswer | null;
  onChange: (value: PulseScaleAnswer) => void;
  error?: ReactNode;
}) {
  const { t } = useTranslation();

  function scalePoint(point: PulseScaleAnswer, pointLabel: string) {
    return (
      <Radio
        key={point}
        value={point}
        color={pulseScaleColor(point)}
        label={
          <Group gap={6} wrap="nowrap">
            <ColorSwatch size={12} color={mantineColorVar(pulseScaleColor(point))} />
            <span>{pointLabel}</span>
          </Group>
        }
      />
    );
  }

  return (
    <Radio.Group
      label={label}
      withAsterisk
      value={value ?? ""}
      onChange={(v) => onChange(v as PulseScaleAnswer)}
      error={error}
    >
      <Stack gap="sm" pt={6} align="flex-start">
        {PULSE_SCALE_VALUES.map((point) => scalePoint(point, t(`pulse.scale.${point}`)))}
        {scalePoint("NA", t("pulse.scale.na"))}
      </Stack>
    </Radio.Group>
  );
}
