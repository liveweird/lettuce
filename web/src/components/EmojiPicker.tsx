import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import en from "@emoji-mart/data/i18n/en.json";
import pl from "@emoji-mart/data/i18n/pl.json";
import { useComputedColorScheme } from "@mantine/core";
import { useTranslation } from "react-i18next";

// The emoji-mart Picker, loaded only through EmojiButton's React.lazy — the data set is a few
// hundred kB and must never ride the main bundle. `data` and `i18n` are ALWAYS passed
// explicitly: omitting either makes emoji-mart fetch them from a CDN at runtime, which a
// self-hosted deployment must not do.
export default function EmojiPicker({ onSelect }: { onSelect: (native: string) => void }) {
  const scheme = useComputedColorScheme("light");
  const { i18n } = useTranslation();
  const isPl = (i18n.resolvedLanguage ?? "en").startsWith("pl");
  return (
    <Picker
      data={data}
      i18n={isPl ? pl : en}
      theme={scheme}
      previewPosition="none"
      onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
    />
  );
}
