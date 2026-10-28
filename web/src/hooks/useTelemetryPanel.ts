import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { readStoredJson, writeStoredJson } from "./useStoredState";

// Whether the telemetry panel is open (`lettuce.viewSettings.telemetry.panelOpen`, default closed). Two places act on it: the
// account menu item and the shell's aside, so it cannot be a per-component `useStoredState`. A module-level listener set +
// useSyncExternalStore (the useChangelogSeen idiom) lets every consumer follow a write at once; the snapshot is read from
// localStorage each time, so there is no module state to leak between tests. Whether the panel is SHOWN also needs ADMIN
// (App.tsx): a stored `true` never reaches a non-admin.
const KEY = "telemetry.panelOpen";

const listeners = new Set<() => void>();

// Set when this tab OPENS the panel (the menu item), consumed by the panel once it mounts, which then focuses its heading. A panel
// restored open by a reload never asks, so it does not take focus away from the page.
let focusRequested = false;

// Another tab's write arrives as a `storage` event: re-reading the snapshot is cheap, and useSyncExternalStore re-renders only when
// the boolean actually changed.
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readOpen(): boolean {
  return readStoredJson(KEY) === true;
}

/**
 * Opens or closes the panel on this device and refreshes every mounted consumer. Closing hands focus to the page (the panel's own
 * controls unmount with it, and the close button would otherwise drop focus on the body). A close is committed first
 * (`flushSync`): below `lg` the page is `inert` while the panel covers it, and an inert element cannot take focus. An open is NOT
 * flushed: it must commit together with the menu's own close, so the menu records where focus was before the panel's heading
 * takes it, and does not hand it back to its button 10 ms later.
 */
export function setTelemetryPanelOpen(open: boolean) {
  focusRequested = open;
  writeStoredJson(KEY, open);
  const notifyAll = () => listeners.forEach((notify) => notify());
  if (open) {
    notifyAll();
    return;
  }
  flushSync(notifyAll);
  document.getElementById("main-content")?.focus();
}

/** Flips the stored flag - read at click time, so a tab that has not re-rendered since another tab's write still toggles correctly. */
export function toggleTelemetryPanel() {
  setTelemetryPanelOpen(!readOpen());
}

/** Whether the panel was just opened in this tab and should take focus; true at most once per opening. */
export function takeTelemetryPanelFocusRequest(): boolean {
  const requested = focusRequested;
  focusRequested = false;
  return requested;
}

/** The stored open flag. Combine with `isAdmin()` before showing anything. */
export function useTelemetryPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, readOpen);
}
