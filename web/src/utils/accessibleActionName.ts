function normalizeActionName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Keeps the visible action label in the control's accessible name. Contextual names supplied by
 * callers remain unchanged when they already contain the label; otherwise the visible label is
 * prefixed so speech-input users can address the control by the text they see.
 */
export function actionAccessibleName(label: string, ariaLabel?: string): string {
  if (!ariaLabel) return label;
  const normalizedLabel = normalizeActionName(label);
  const normalizedAriaLabel = normalizeActionName(ariaLabel);
  if (normalizedLabel && ` ${normalizedAriaLabel} `.includes(` ${normalizedLabel} `)) return ariaLabel;
  return `${label}: ${ariaLabel}`;
}
