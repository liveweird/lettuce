import { MultiSelect } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { accessibleRenderPill } from "./accessiblePill";

// A feedback may address up to four people (v3.1.0) — mirrors the server's MAX_FEEDBACK_SUBJECTS.
const MAX_FEEDBACK_RECIPIENTS = 4;

/**
 * The recipient picker of the feedback/kudo create screens' picker mode (v3.1.0): a searchable
 * MultiSelect over the caller's user pool capped at MAX_FEEDBACK_RECIPIENTS (Mantine hides the
 * remaining options once the cap is reached), selection order preserved — the first pick is the
 * feedback's anchor subject. Filtering is theme-owned (accent-insensitive), pills carry a named
 * remove button. `value` holds user ids as strings (the MultiSelect contract).
 */
export default function RecipientsMultiSelect({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <MultiSelect
      label={label}
      description={t("feedback.recipientsHint", { max: MAX_FEEDBACK_RECIPIENTS })}
      placeholder={value.length === 0 ? t("feedback.pickUser") : undefined}
      data={options}
      value={value}
      onChange={onChange}
      maxValues={MAX_FEEDBACK_RECIPIENTS}
      searchable
      hidePickedOptions
      clearable
      nothingFoundMessage={t("feedback.noUsersAvailable")}
      error={error}
      renderPill={accessibleRenderPill((name) => t("feedback.removeRecipient", { name }))}
      w={360}
    />
  );
}
