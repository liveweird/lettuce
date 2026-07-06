import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import PersonaChip from "./PersonaChip";

// A labeled party display for form headers (Ask/Request/triage): an input-style label over
// the app's standard person rendering — PersonaChip for a named counterparty, plain "You"
// text for the current user (the same chip-vs-plain-text convention as the table cells).
// Replaces the old disabled-TextInput look.
export default function PersonaField({
  label,
  name,
  you = false,
}: {
  label: string;
  name?: string;
  you?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      {you ? <Text size="sm">{t("common.state.you")}</Text> : <PersonaChip name={name ?? ""} />}
    </Stack>
  );
}
