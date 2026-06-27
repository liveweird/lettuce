import { SegmentedControl } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <SegmentedControl
      size="xs"
      aria-label={t("common.language.label")}
      value={current}
      onChange={(value) => i18n.changeLanguage(value)}
      data={SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: lng.toUpperCase() }))}
    />
  );
}
