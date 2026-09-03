import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseButton, TextInput } from "@mantine/core";

// A filter TextInput that shows a clear (×) button in its right section while
// non-empty. Every filter panel input uses the shared "contains" placeholder;
// `clearLabel` is the page-local aria-label for the clear button. `hideLabel` renders the
// label as the input's aria-label instead (the toolbar quick search, v3.3.0), so
// getByLabel(label) keeps resolving it.
export default function ClearableTextInput({
  label,
  value,
  onChange,
  clearLabel,
  hideLabel = false,
  placeholder,
  leftSection,
  w,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  clearLabel: string;
  hideLabel?: boolean;
  placeholder?: string;
  leftSection?: ReactNode;
  w?: number | string;
}) {
  const { t } = useTranslation();
  return (
    <TextInput
      label={hideLabel ? undefined : label}
      aria-label={hideLabel ? label : undefined}
      placeholder={placeholder ?? t("common.filter.contains")}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      leftSection={leftSection}
      w={w}
      rightSection={
        value ? (
          <CloseButton
            size="sm"
            aria-label={clearLabel}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange("")}
          />
        ) : null
      }
      rightSectionPointerEvents="auto"
    />
  );
}
