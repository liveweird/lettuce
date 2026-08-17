import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import en from "@emoji-mart/data/i18n/en.json";
import pl from "@emoji-mart/data/i18n/pl.json";
import { useComputedColorScheme } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { asSupportedLanguage, type SupportedLanguage } from "../i18n";

// The emoji-mart Picker, loaded only through EmojiButton's React.lazy — the data set is a few
// hundred kB and must never ride the main bundle. `data` and `i18n` are ALWAYS passed
// explicitly: omitting either makes emoji-mart fetch them from a CDN at runtime, which a
// self-hosted deployment must not do.

// One emoji-mart i18n file per supported language (they ride the lazy picker chunk, a few KB
// each) — the Record makes a missed language a compile error when SUPPORTED_LANGUAGES grows.
const EMOJI_I18N: Record<SupportedLanguage, unknown> = { en, pl };

export default function EmojiPicker({ onSelect }: { onSelect: (native: string) => void }) {
  const scheme = useComputedColorScheme("light");
  const { i18n } = useTranslation();
  return (
    <Picker
      data={data}
      i18n={EMOJI_I18N[asSupportedLanguage(i18n.resolvedLanguage)]}
      theme={scheme}
      previewPosition="none"
      onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
    />
  );
}
