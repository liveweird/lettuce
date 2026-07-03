import { Text, type TextProps } from "@mantine/core";
import { useTranslation } from "react-i18next";

// __APP_COMMIT__ / __APP_COMMIT_TIME__ come from `define` in vite.config.ts.
// The timestamp is git's %cI (strict ISO, committer-local); slicing to minutes
// avoids timezone re-interpretation.
export default function VersionStamp(props: TextProps) {
  const { t } = useTranslation();
  const time = __APP_COMMIT_TIME__.slice(0, 16).replace("T", " ");
  return (
    <Text size="xs" c="dimmed" title={t("common.buildInfo")} {...props}>
      {__APP_COMMIT__}
      {time && ` · ${time}`}
    </Text>
  );
}
