import { Collapse, Text, Textarea, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

// Read-only display of the requester's clarification note; renders nothing when empty.
// Shared by the feedback view, the edit triage screen, and the draft editor.
//
// `collapsible` renders it as a one-line toggle (collapsed by default) so the compact
// view/edit headers don't spend vertical space on it until the reader asks; the triage
// screen keeps the always-open variant — there the message IS the point of the screen.
export default function RequesterMessage({
  value,
  collapsible = false,
}: {
  value?: string | null;
  collapsible?: boolean;
}) {
  const { t } = useTranslation();
  const [opened, { toggle }] = useDisclosure(false);
  if (!value) return null;

  if (collapsible) {
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
          <Text size="sm" c="dimmed" component="span">
            {t("feedback.requesterMessageView")}
          </Text>
        </UnstyledButton>
        <Collapse expanded={opened}>
          <Text
            size="sm"
            pl="md"
            py={4}
            style={{
              whiteSpace: "pre-wrap",
              borderLeft: "3px solid var(--mantine-color-default-border)",
            }}
          >
            {value}
          </Text>
        </Collapse>
      </div>
    );
  }

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
