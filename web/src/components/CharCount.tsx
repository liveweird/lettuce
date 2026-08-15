import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

/** nearLimit counters stay hidden until the text reaches this share of the limit. */
export const NEAR_LIMIT_RATIO = 0.8;

export type CharCountMode = "always" | "nearLimit";

// The shared "123 / 4000" character counter under capped text fields (v2.18.0). Dimmed while
// under the limit, red when over — over-limit is reachable only through programmatic value
// pushes (e.g. inserting a feedback template), since native maxLength blocks typing/paste.
// The visibility helpers live in utils/charCount.tsx (the tourSupport Fast-Refresh split).
export default function CharCount({
  current,
  max,
  mode = "always",
}: {
  current: number;
  max: number;
  mode?: CharCountMode;
}) {
  const { t } = useTranslation();
  if (mode === "nearLimit" && current < max * NEAR_LIMIT_RATIO) return null;
  return (
    <Text size="xs" c={current > max ? "red" : "dimmed"} ta="right" component="span" display="block">
      {t("common.charCount", { current, max })}
    </Text>
  );
}
