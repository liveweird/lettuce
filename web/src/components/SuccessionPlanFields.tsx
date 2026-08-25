import { Group, NumberInput, Select, Stack } from "@mantine/core";
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

const CRITICALITIES: readonly RoleCriticality[] = ["CRITICAL", "CORE", "STANDARD"];
const RISKS: readonly RetentionRisk[] = ["HIGH", "MEDIUM", "LOW"];

/**
 * The plan's definition fields, shared by the create screen and the DRAFT-less editor (the
 * GoalDefinitionFields idiom): the two planning labels, the target bench depth, and the
 * ordered loss-impact list. The seat's person is NOT here — immutable, the pages render it
 * as a PersonaField/picker themselves.
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
        <Select
          label={t("succession.criticalityLabel")}
          data={CRITICALITIES.map((value) => ({ value, label: t(`succession.criticality.${value}`) }))}
          allowDeselect={false}
          w={200}
          {...form.getInputProps("roleCriticality")}
        />
        <Select
          label={t("succession.riskLabel")}
          data={RISKS.map((value) => ({ value, label: t(`succession.risk.${value}`) }))}
          allowDeselect={false}
          w={200}
          {...form.getInputProps("retentionRisk")}
        />
        <NumberInput
          label={t("succession.targetBenchDepth")}
          description={t("succession.targetBenchDepthHint")}
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
