import { useRef } from "react";
import { Textarea, type TextareaProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import EmojiButton from "./EmojiButton";

type EmojiTextareaProps = Omit<TextareaProps, "value" | "onChange"> & {
  /** Optional to match `form.getInputProps` spreads; treated as "" when absent. */
  value?: string;
  /** Plain-string onChange — `form.getInputProps` accepts raw values, so spreads keep working. */
  onChange: (value: string) => void;
};

// A Mantine Textarea with the shared emoji picker in its rightSection. Picked emoji are
// spliced in at the caret (or appended when the field was never focused); the caret is
// restored after the controlled re-render. Swapping Textarea → EmojiTextarea is prop-
// compatible apart from onChange carrying the string instead of the event.
export default function EmojiTextarea({ value, onChange, maxLength, ...rest }: EmojiTextareaProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (native: string) => {
    const el = ref.current;
    const text = value ?? "";
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = text.slice(0, start) + native + text.slice(end);
    // The native maxLength attribute only guards typing, not programmatic sets.
    if (maxLength != null && next.length > maxLength) return;
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + native.length, start + native.length);
    });
  };

  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      maxLength={maxLength}
      rightSection={<EmojiButton label={t("common.emoji.insert")} onSelect={insert} />}
      rightSectionWidth={36}
      // Pin the button to the top edge — autosize fields grow and a centered icon would float.
      rightSectionProps={{ style: { alignItems: "flex-start", paddingTop: 4 } }}
      rightSectionPointerEvents="all"
      {...rest}
    />
  );
}
