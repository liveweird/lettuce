import { Box, Input, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import PersonaChip from "./PersonaChip";

// A labeled party display for form headers (Ask/Request/triage, the 1:1 screens): an
// input-style label over the app's standard person rendering — PersonaChip for a named
// counterparty, plain "You" text for the current user (the same chip-vs-plain-text convention
// as the table cells). Built as Input.Wrapper + a value row matching the default Mantine input
// height, so the field sits pixel-flush when sharing a row with real inputs (the 1:1 edit
// header's meeting-date TextInput) — and follows the read-only-field convention
// (Input.Wrapper + Text, never a disabled input).
export default function PersonaField({
  label,
  name,
  you = false,
  to,
  ariaLabel,
}: {
  label: string;
  name?: string;
  you?: boolean;
  /** Optional user-details link (v2.47.2 — the name-as-link idiom reaching form headers);
   *  the "You" branch stays plain per the house rule. */
  to?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <Input.Wrapper label={label}>
      {/* mih mirrors the default input height; content is vertically centered like input text. */}
      <Box mih={36} display="flex" style={{ alignItems: "center" }}>
        {you ? <Text size="sm">{t("common.state.you")}</Text> : <PersonaChip name={name ?? ""} to={to} ariaLabel={ariaLabel} />}
      </Box>
    </Input.Wrapper>
  );
}
