import { useRef } from "react";
import { Group, Textarea, type TextareaProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import CharCount, { type CharCountMode } from "./CharCount";
import { shouldShowCharCount } from "../utils/charCount";
import EmojiButton from "./EmojiButton";

type EmojiTextareaProps = Omit<TextareaProps, "value" | "onChange"> & {
  /** Optional to match `form.getInputProps` spreads; treated as "" when absent. */
  value?: string;
  /** Plain-string onChange — `form.getInputProps` accepts raw values, so spreads keep working. */
  onChange: (value: string) => void;
  /** Character-counter visibility when maxLength is set (v2.18.0); "nearLimit" for dense row editors. */
  counter?: CharCountMode | "none";
};

// A Mantine Textarea with the shared emoji picker in its rightSection. Picked emoji are
// spliced in at the caret (or appended when the field was never focused); the caret is
// restored after the controlled re-render. Swapping Textarea → EmojiTextarea is prop-
// compatible apart from onChange carrying the string instead of the event.
// With maxLength set it also renders the shared CharCount below the input (description slot,
// moved under the field the AlertFormFields inputWrapperOrder way); a caller-passed
// description shares that line, hint left / counter right.
export default function EmojiTextarea({
  value,
  onChange,
  maxLength,
  counter = "always",
  description,
  ...rest
}: EmojiTextareaProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);

  const length = (value ?? "").length;
  const showCounter =
    maxLength != null && counter !== "none" && shouldShowCharCount(length, maxLength, counter);
  const composedDescription = showCounter ? (
    description == null ? (
      <CharCount current={length} max={maxLength} />
    ) : (
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <span>{description}</span>
        <CharCount current={length} max={maxLength} />
      </Group>
    )
  ) : (
    description
  );

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
      description={composedDescription}
      {...rest}
    />
  );
}
