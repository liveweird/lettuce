import { Collapse, Stack, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import { IMPACT_SECTIONS, type ImpactSectionField } from "../utils/impactLogForm";
import MarkdownView from "./MarkdownView";
import ProseBox from "./ProseBox";

// One collapsible section: the label doubles as the toggle (the RequesterMessage idiom —
// rotating chevron + aria-expanded), starting EXPANDED; the state is per-section and local.
function Section({ labelKey, value }: { labelKey: ParseKeys; value: string }) {
  const { t } = useTranslation();
  const [opened, { toggle }] = useDisclosure(true);
  return (
    <div>
      <UnstyledButton
        onClick={toggle}
        aria-expanded={opened}
        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <IconChevronRight
          size={14}
          style={{ transform: opened ? "rotate(90deg)" : "none", transition: "transform 150ms ease" }}
        />
        <Text size="sm" fw={500} component="span">
          {t(labelKey)}
        </Text>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <ProseBox>
          <MarkdownView>{value}</MarkdownView>
        </ProseBox>
      </Collapse>
    </div>
  );
}

/**
 * The read-only rendering of a journal entry's four sections — shared by the view screen's
 * Content tab and the wizard's Review step. Each section expands/contracts independently
 * (expanded by default).
 */
export default function ImpactEntrySections({
  values,
}: {
  values: Record<ImpactSectionField, string>;
}) {
  return (
    <Stack gap="lg">
      {IMPACT_SECTIONS.map(({ field, labelKey }) => (
        <Section key={field} labelKey={labelKey} value={values[field]} />
      ))}
    </Stack>
  );
}
