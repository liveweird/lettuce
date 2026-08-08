import { Flex, Radio } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PulseScaleAnswer } from "../api/client";
import { PULSE_SCALE_VALUES } from "../utils/pulseSurveyForm";

/**
 * One driver question (Q2-Q6) on the five-point agreement scale + "Not applicable". A
 * Radio.Group so every point carries its full label; N/A sits visually apart (pushed to the
 * row's end) so it doesn't read as "worse than strongly disagree". Values are the API's wire
 * strings directly.
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
  return (
    <Radio.Group
      label={label}
      withAsterisk
      value={value ?? ""}
      onChange={(v) => onChange(v as PulseScaleAnswer)}
      error={error}
    >
      <Flex direction={{ base: "column", sm: "row" }} gap="sm" pt={6} wrap="wrap">
        {PULSE_SCALE_VALUES.map((point) => (
          <Radio key={point} value={point} label={t(`pulse.scale.${point}`)} />
        ))}
        <Radio value="NA" label={t("pulse.scale.na")} ml={{ base: 0, sm: "auto" }} />
      </Flex>
    </Radio.Group>
  );
}
