import {
  Box,
  Fieldset,
  Group,
  Input,
  NumberInput,
  Slider,
  Stack,
} from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { RetentionRisk, RoleCriticality } from "../api/successionPlans";
import {
  MAX_BENCH_DEPTH,
  MIN_BENCH_DEPTH,
  emptyTextRowDraft,
  type SuccessionPlanFormValues,
} from "../utils/successionForm";
import FieldGrid from "./FieldGrid";
import OrderedTextListEditor from "./OrderedTextListEditor";
import { HintIcon } from "./PulseTeamResultCard";
import { CRITICALITY_COLORS, RISK_COLORS } from "./successionScales";

// Slider scales run mild → severe left-to-right, so "more critical / riskier" reads as
// further right (the badge color maps grade the same direction).
const CRITICALITY_SCALE: readonly RoleCriticality[] = [
  "STANDARD",
  "CORE",
  "CRITICAL",
];
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
    <Input.Wrapper label={label}>
      {/* Mark labels center under the track ends (translateX(-50%), nowrap) and would
          overhang the container — the inner padding pulls the track in so the edge labels
          land inside the slider's grid column (v2.47.2; the wrapper fills its FieldGrid
          column since v3.12.1). */}
      <Box px={26}>
        <Slider
          min={0}
          max={scale.length - 1}
          step={1}
          value={Math.max(0, scale.indexOf(value))}
          onChange={(index) => onChange(scale[index])}
          marks={scale.map((option, index) => ({
            value: index,
            label: optionLabel(option),
          }))}
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
 * GoalDefinitionFields idiom): the two planning sliders and the target bench depth in the
 * "Seat & criticality" section, the ordered loss-impact list in its own — the same two
 * `Fieldset` sections the Review screen's read-only view draws (v3.12.1; the v3.5.0 shell
 * rule for long forms), the three planning fields on an equal `FieldGrid` so their column
 * starts line up with each other and with the section edge. The seat's person is NOT here —
 * immutable, the pages render it as a MetaStrip cell/picker themselves.
 */
export default function SuccessionPlanFields({
  form,
  tourIds,
}: {
  form: UseFormReturnType<SuccessionPlanFormValues>;
  /** Tutorial anchors for the two Fieldset sections (the create screen only — the Review
   *  screen passes nothing) — a wrapper Box carries `data-tour`, since Fieldset doesn't
   *  forward unknown props. */
  tourIds?: { seat?: string; lossImpact?: string };
}) {
  const { t } = useTranslation();

  return (
    <Stack>
      <Box data-tour={tourIds?.seat}>
      <Fieldset legend={t("succession.section.seat")}>
        <FieldGrid>
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
              <Group
                gap={4}
                wrap="nowrap"
                component="span"
                display="inline-flex"
              >
                {t("succession.targetBenchDepth")}
                <HintIcon label={t("succession.targetBenchDepthHint")} />
              </Group>
            }
            min={MIN_BENCH_DEPTH}
            max={MAX_BENCH_DEPTH}
            allowDecimal={false}
            {...form.getInputProps("targetBenchDepth")}
          />
        </FieldGrid>
      </Fieldset>
      </Box>

      {/* The legend names the list — the editor renders without its own label. */}
      <Box data-tour={tourIds?.lossImpact}>
      <Fieldset legend={t("succession.section.lossImpact")}>
        <OrderedTextListEditor
          form={form}
          field="lossImpact"
          onAdd={() => form.insertListItem("lossImpact", emptyTextRowDraft())}
          emptyLabel={t("succession.noLossImpact")}
          addLabel={t("succession.addLossImpact")}
          rowAria={{
            item: (position) => t("succession.lossImpactAria", { position }),
            moveUp: (position) =>
              t("succession.lossImpactMoveUp", { position }),
            moveDown: (position) =>
              t("succession.lossImpactMoveDown", { position }),
            remove: (position) =>
              t("succession.lossImpactRemove", { position }),
          }}
        />
      </Fieldset>
      </Box>
    </Stack>
  );
}
