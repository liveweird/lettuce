import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setTelemetryPanelOpen, takeTelemetryPanelFocusRequest, toggleTelemetryPanel, useTelemetryPanelOpen } from "./useTelemetryPanel";

describe("useTelemetryPanelOpen", () => {
  afterEach(() => {
    localStorage.clear();
    // The focus request is module state: an opening no panel consumed must not leak into the next test.
    takeTelemetryPanelFocusRequest();
  });

  test("is closed by default, follows a write in every mounted consumer and survives a remount", () => {
    const first = renderHook(() => useTelemetryPanelOpen());
    const second = renderHook(() => useTelemetryPanelOpen());
    expect(first.result.current).toBe(false);
    act(() => setTelemetryPanelOpen(true));
    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);
    expect(localStorage.getItem("lettuce.viewSettings.telemetry.panelOpen")).toBe("true");
    first.unmount();
    expect(renderHook(() => useTelemetryPanelOpen()).result.current).toBe(true);
    act(() => setTelemetryPanelOpen(false));
    expect(second.result.current).toBe(false);
  });

  test("closing hands focus to the page's main region", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.append(main);
    try {
      act(() => setTelemetryPanelOpen(true));
      expect(document.activeElement).not.toBe(main);
      act(() => setTelemetryPanelOpen(false));
      expect(document.activeElement).toBe(main);
    } finally {
      main.remove();
    }
  });

  test("follows another tab's write, and a toggle reads the stored flag rather than a stale render", () => {
    const { result } = renderHook(() => useTelemetryPanelOpen());
    expect(result.current).toBe(false);
    // Another tab writes the flag: this tab learns of it only through the storage event.
    localStorage.setItem("lettuce.viewSettings.telemetry.panelOpen", "true");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "lettuce.viewSettings.telemetry.panelOpen" }));
    });
    expect(result.current).toBe(true);
    act(() => toggleTelemetryPanel());
    expect(result.current).toBe(false);
    act(() => toggleTelemetryPanel());
    expect(result.current).toBe(true);
  });

  test("an opening asks the panel for focus exactly once; a close or a stored flag never does", () => {
    expect(takeTelemetryPanelFocusRequest()).toBe(false);
    act(() => setTelemetryPanelOpen(true));
    expect(takeTelemetryPanelFocusRequest()).toBe(true);
    expect(takeTelemetryPanelFocusRequest()).toBe(false);
    act(() => setTelemetryPanelOpen(true));
    act(() => setTelemetryPanelOpen(false));
    expect(takeTelemetryPanelFocusRequest()).toBe(false);
    localStorage.setItem("lettuce.viewSettings.telemetry.panelOpen", "true");
    expect(renderHook(() => useTelemetryPanelOpen()).result.current).toBe(true);
    expect(takeTelemetryPanelFocusRequest()).toBe(false);
  });

  test("anything but a stored true reads as closed", () => {
    localStorage.setItem("lettuce.viewSettings.telemetry.panelOpen", '"yes"');
    expect(renderHook(() => useTelemetryPanelOpen()).result.current).toBe(false);
    localStorage.setItem("lettuce.viewSettings.telemetry.panelOpen", "not json");
    expect(renderHook(() => useTelemetryPanelOpen()).result.current).toBe(false);
  });
});
