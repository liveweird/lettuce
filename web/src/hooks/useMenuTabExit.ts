import { type KeyboardEvent, useState } from "react";

/** The trigger of the OUTERMOST menu an element sits in. Mantine's dropdown is `[role="menu"]` and its `aria-labelledby` is the target's id;
 *  a submenu's target is itself an item of the parent menu, so the walk continues until a trigger sits outside every menu. */
function menuTriggerOf(fromElementInsideMenu: Element): HTMLElement | null {
  let trigger: HTMLElement | null = null;
  let menu = fromElementInsideMenu.closest('[role="menu"]');
  while (menu !== null) {
    const id = menu.getAttribute("aria-labelledby");
    const target = id ? document.getElementById(id) : null;
    if (target === null) break;
    trigger = target;
    menu = target.closest('[role="menu"]');
  }
  return trigger;
}

/**
 * Tab (and Shift+Tab) leaves an open menu (v4.22.0): the menu closes and the focus moves on from its trigger, as the WAI-ARIA menu pattern
 * says. Mantine's `trapFocus` would otherwise swallow the key (menu items are `tabindex="-1"`, so its `scopeTab` finds nothing tabbable and
 * prevents the default; Escape was the only exit). The hook owns the menu's `opened` state: spread `menu` on `<Menu>` and `dropdown` on
 * `<Menu.Dropdown>`.
 *
 * On Tab the handler stops the event before it reaches the trap's `document` listener (which then never prevents the default), focuses the
 * trigger synchronously and closes the menu; the browser's own Tab default then runs from the trigger, to the next stop after it (Shift+Tab:
 * the one before it). Mantine's focus return finds the focus moved on by the time it looks (10 ms after the close) and leaves it alone.
 *
 * The menu must be items only (no Tab stop of its own): the account menu's theme choice is items, since a radiogroup fails axe inside
 * `role="menu"`. It is the BUBBLE `onKeyDown`, not `onKeyDownCapture`: `Popover.Dropdown` swaps the capture handler for its Escape-only one
 * while `closeOnEscape` is on.
 */
export function useMenuTabExit() {
  const [opened, setOpened] = useState(false);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
    const trigger = menuTriggerOf(event.target as Element);
    if (trigger === null) return;
    event.stopPropagation();
    trigger.focus({ preventScroll: true });
    setOpened(false);
  };
  return { menu: { opened, onChange: setOpened }, dropdown: { onKeyDown } };
}
