import { Box, Group, Input, NumberInput, Slider, Stack } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { RetentionRisk, RoleCriticality } from "../api/successionPlans";
import {
  MAX_BENCH_DEPTH,
  MIN_BENCH_DEPTH,
  emptyTextRowDraft,
  type SuccessionPlanFormValues,
} from "../utils/successionForm";
import OrderedTextListEditor from "./OrderedTextListEditor";
import { HintIcon } from "./PulseTeamResultCard";
import { CRITICALITY_COLORS, RISK_COLORS } from "./successionScales";

// Slider scales run mild → severe left-to-right, so "more critical / riskier" reads as
// further right (the badge color maps grade the same direction).
const CRITICALITY_SCALE: readonly RoleCriticality[] = ["STANDARD", "CORE", "CRITICAL"];
const RISK_SCALE: readonly RetentionRisk[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * A discrete three-stop slider over an ordinal enum (v2.44.0 — the criticality/risk Selects
 * were dull): marks carry the option labels, the track takes the current value's badge color.
 * The aria goes on the thumb via `thumbLabel` (the CareerPyramid house rule — a bare
 * aria-label would name the root div nobody can query); tests drive it by keyboard.
 */
function LevelSlider<V extends string>({
  label,
  scale,
  colors,
  value,
  onChange,
  optionLabel,
}: {
  label: string;
  scale: readonly V[];
  colors: Record<V, string>;
  value: V;
  onChange: (value: V) => void;
  optionLabel: (value: V) => string;
}) {
  return (
    <Input.Wrapper label={label} w={220}>
      {/* Mark labels center under the track ends (translateX(-50%), nowrap) and would
          overhang the container — the inner padding pulls the track in so the edge labels
          land inside the 220px column (v2.47.2). */}
      <Box px={26}>
        <Slider
          min={0}
          max={scale.length - 1}
          step={1}
          value={Math.max(0, scale.indexOf(value))}
          onChange={(index) => onChange(scale[index])}
          marks={scale.map((option, index) => ({ value: index, label: optionLabel(option) }))}
          label={(index) => optionLabel(scale[index])}
          color={colors[value]}
            thumbLabel={label}
          mt={6}
          mb="lg"
        />
      </Box>
    </Input.Wrapper>
  );
}

/**
 * The plan's definition fields, shared by the create screen and the Review screen (the
 * GoalDefinitionFields idiom): the two planning sliders, the target bench depth, and the
 * ordered loss-impact list. The seat's person is NOT here — immutable, the pages render it
 * as a MetaStrip cell/picker themselves.
 */
export default function SuccessionPlanFields({
  form,
}: {
  form: UseFormReturnType<SuccessionPlanFormValues>;
}) {
  const { t } = useTranslation();

  return (
    <Stack>
      <Group gap="xl" align="flex-start">
        <LevelSlider
          label={t("succession.criticalityLabel")}
          scale={CRITICALITY_SCALE}
          colors={CRITICALITY_COLORS}
          value={form.values.roleCriticality}
          onChange={(value) => form.setFieldValue("roleCriticality", value)}
          optionLabel={(value) => t(`succession.criticality.${value}`)}
        />
        <LevelSlider
          label={t("succession.riskLabel")}
          scale={RISK_SCALE}
          colors={RISK_COLORS}
          value={form.values.retentionRisk}
          onChange={(value) => form.setFieldValue("retentionRisk", value)}
          optionLabel={(value) => t(`succession.risk.${value}`)}
        />
        <NumberInput
          label={
            // The hint moved off the `description` sub-label (it broke the row's alignment,
            // v2.44.0) into a hover/focus hint icon beside the label.
            <Group gap={4} wrap="nowrap" component="span" display="inline-flex">
              {t("succession.targetBenchDepth")}
              <HintIcon label={t("succession.targetBenchDepthHint")} />
            </Group>
          }
          min={MIN_BENCH_DEPTH}
          max={MAX_BENCH_DEPTH}
          allowDecimal={false}
          w={200}
          {...form.getInputProps("targetBenchDepth")}
        />
      </Group>

      <OrderedTextListEditor
        form={form}
        field="lossImpact"
        label={t("succession.lossImpact")}
        onAdd={() => form.insertListItem("lossImpact", emptyTextRowDraft())}
        emptyLabel={t("succession.noLossImpact")}
        addLabel={t("succession.addLossImpact")}
        rowAria={{
          item: (position) => t("succession.lossImpactAria", { position }),
          moveUp: (position) => t("succession.lossImpactMoveUp", { position }),
          moveDown: (position) => t("succession.lossImpactMoveDown", { position }),
          remove: (position) => t("succession.lossImpactRemove", { position }),
        }}
      />
    </Stack>
  );
}
