import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFilterPanel } from "./useFilterPanel";

const KEY = "lettuce.viewSettings.users.filtersOpen";

describe("useFilterPanel", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("persists the open state per view and restores it on the next mount", () => {
    const first = renderHook(() => useFilterPanel("users"));
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("true");
    first.unmount();

    const second = renderHook(() => useFilterPanel("users"));
    expect(second.result.current[0]).toBe(true);
  });

  test("ignores a stored value that isn't a boolean", () => {
    localStorage.setItem(KEY, JSON.stringify("yes"));
    const { result } = renderHook(() => useFilterPanel("users"));
    expect(result.current[0]).toBe(false);
  });

  test("without a storage key the state is local: nothing read, nothing written (v3.5.2)", () => {
    // Stale values under the keys the old fallbacks would have hit must have no effect …
    localStorage.setItem("lettuce.viewSettings.undefined.filtersOpen", "true");
    localStorage.setItem("lettuce.viewSettings.list.filtersOpen", "true");
    const first = renderHook(() => useFilterPanel(undefined));
    expect(first.result.current[0]).toBe(false);
    act(() => first.result.current[1](true));
    expect(first.result.current[0]).toBe(true);
    first.unmount();
    // … and the toggle persisted nowhere: a fresh mount starts closed again.
    const second = renderHook(() => useFilterPanel(undefined));
    expect(second.result.current[0]).toBe(false);
    expect(localStorage.getItem("lettuce.viewSettings.undefined.filtersOpen")).toBe("true");
    expect(localStorage.getItem("lettuce.viewSettings.list.filtersOpen")).toBe("true");
  });
});
