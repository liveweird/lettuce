import { cloneElement, useEffect, useState, type ReactElement, type Ref } from "react";
import { Text, Tooltip, type TextProps } from "@mantine/core";
import { useTimeout } from "@mantine/hooks";

// Text that must stay on ONE line (a person's name or email in a card or table cell) is
// truncated with an ellipsis, and the full text is revealed on demand — "single-line text
// overflow", tooltip variant (v4.21.0). The truncation itself is visual only (the full string is
// in the DOM: the accessible name, find-in-page and copy all still see it). Rules the guide sets,
// and how they land here:
//  - never `title` alone — it is unreachable from the keyboard and on touch — so a Mantine
//    Tooltip, opened on hover AND on keyboard focus of the nearest focusable ancestor (the link
//    or button the text sits in; text itself is not focusable). A scroll region, grid or
//    application container is NOT such an ancestor (focus on it says nothing about this text), so
//    inside one only hover applies;
//  - a tooltip appears only WHEN the text is actually truncated (measured when interest starts,
//    so a later resize or a language switch is always judged on the current layout);
//  - a tooltip that merely repeats the label is hidden from assistive technology (aria-hidden),
//    or a screen reader would announce the text twice — the tooltip is a visual aid only;
//  - shown after the theme's 300 ms intent delay; Escape dismisses it while the keyboard focus
//    host still has focus (a hover-only tooltip has no dismiss key).
// Known limits — this is NOT full WCAG 1.4.13 (Content on Hover or Focus): Mantine's tooltip is
// not hoverable (pointer-events: none), so moving the pointer onto it closes it, and dismissal
// needs the focus host. The tooltip repeats text that is also in the DOM, which is why that is
// tolerated. Touch has no hover or focus: the people this is used for are links to a detail view
// that shows the name in full, which is the guide's "shown in full elsewhere" route.

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
// A focusable container that only SCROLLS or groups its content (ResponsiveTable's matrix scroller,
// DaysOffMonthGrid's wrapper) is not the focus host of the text inside it.
const NOT_A_HOST = '[role="region"], [role="application"], [role="grid"]';
const OPEN_DELAY_MS = 300;

function focusHostOf(target: HTMLElement | null): HTMLElement | null {
  const host = target?.closest<HTMLElement>(FOCUSABLE) ?? null;
  return host && !host.matches(NOT_A_HOST) ? host : null;
}

function isTruncated(el: HTMLElement | null): boolean {
  return el != null && el.scrollWidth > el.clientWidth;
}

// `:focus-visible` throws on engines that do not know it; treat those as "visible".
function focusIsVisible(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/**
 * Wraps ONE truncating element (it must forward a ref — every Mantine `Text`/`Anchor` does) and
 * shows `label` in a tooltip while the element is truncated and hovered or keyboard-focused.
 */
export function TruncationTooltip({ label, children }: { label: string; children: ReactElement<{ ref?: Ref<HTMLElement> }> }) {
  // The truncating element, held as state (a callback ref) so effects re-bind if it is replaced.
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [truncated, setTruncated] = useState(false);

  // The intent delay: the tooltip opens only if the pointer stays for OPEN_DELAY_MS.
  const { start: startTimer, clear: clearTimer } = useTimeout(
    () => {
      setTruncated(isTruncated(target));
      setHover(true);
    },
    OPEN_DELAY_MS,
  );
  const startHover = () => {
    clearTimer();
    startTimer();
  };
  const stopHover = () => {
    clearTimer();
    setHover(false);
    setDismissed(false);
  };

  // Keyboard interest: the nearest focusable ancestor (or the element itself when it is one).
  useEffect(() => {
    const host = focusHostOf(target);
    if (!host) return undefined;
    const onFocusIn = () => {
      if (!focusIsVisible(host)) return;
      setTruncated(isTruncated(target));
      setFocus(true);
    };
    const onFocusOut = () => {
      setFocus(false);
      setDismissed(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    host.addEventListener("keydown", onKeyDown);
    return () => {
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("keydown", onKeyDown);
    };
  }, [target]);

  const child = cloneElement(children, {
    ref: setTarget,
    onMouseEnter: startHover,
    onMouseLeave: stopHover,
  } as Partial<{ ref: Ref<HTMLElement> }>);

  return (
    <Tooltip
      label={<span aria-hidden="true">{label}</span>}
      opened={truncated && !dismissed && (hover || focus)}
      position="top-start"
      multiline
      maw={320}
    >
      {child}
    </Tooltip>
  );
}

type TruncatedTextProps = Omit<TextProps, "truncate" | "children"> & {
  /** The full text; also the tooltip. */
  children: string;
};

/** A one-line, ellipsized Mantine `Text` whose full text is reachable when it is cut off. */
export default function TruncatedText({ children, style, ...props }: TruncatedTextProps) {
  return (
    <TruncationTooltip label={children}>
      {/* minWidth 0 lets the flex child actually shrink so `truncate` can engage. */}
      <Text {...props} truncate style={{ minWidth: 0, ...style }}>
        {children}
      </Text>
    </TruncationTooltip>
  );
}
