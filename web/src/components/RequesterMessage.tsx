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
    />
  );
}
