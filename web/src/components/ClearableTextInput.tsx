import { useTranslation } from "react-i18next";
import { CloseButton, TextInput } from "@mantine/core";

// A filter TextInput that shows a clear (×) button in its right section while
// non-empty. Every filter panel input uses the shared "contains" placeholder;
// `clearLabel` is the page-local aria-label for the clear button.
export default function ClearableTextInput({
  label,
  value,
  onChange,
  clearLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <TextInput
      label={label}
      placeholder={t("common.filter.contains")}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
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
