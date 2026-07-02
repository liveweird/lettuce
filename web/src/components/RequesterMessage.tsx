import { Textarea } from "@mantine/core";
import { useTranslation } from "react-i18next";

// Read-only display of the requester's clarification note; renders nothing when empty.
// Shared by the feedback view, the edit triage screen, and the draft editor.
export default function RequesterMessage({ value }: { value?: string | null }) {
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <Textarea
      label={t("feedback.requesterMessageView")}
      value={value}
      autosize
      minRows={2}
      maxRows={6}
      readOnly
      // Match the disabled TextInputs that surround this field (grey background, dimmed text) —
      // readOnly alone renders a white, editable-looking input. Kept readOnly (not disabled) so
      // the message text stays selectable/copyable. The vars are Mantine's own disabled-input
      // tokens, defined on every input root, so this tracks the theme in light and dark.
      styles={{
        input: {
          backgroundColor: "var(--input-disabled-bg)",
          color: "var(--input-disabled-color)",
          opacity: 0.6,
        },
      }}
    />
  );
}
