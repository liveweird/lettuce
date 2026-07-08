import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { isOneOfOrNull, isString, useStoredState } from "./useStoredState";

const KEY = "lettuce.viewSettings.test.value";

describe("useStoredState", () => {
  afterEach(() => {
    localStorage.clear();
  });

  test("falls back to the initial value when nothing is stored", () => {
    const { result } = renderHook(() => useStoredState("test.value", "default", isString));
    expect(result.current[0]).toBe("default");
  });

  test("persists on set and restores on the next mount", () => {
    const first = renderHook(() => useStoredState("test.value", "", isString));
    act(() => first.result.current[1]("hello"));
    expect(first.result.current[0]).toBe("hello");
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify("hello"));
    first.unmount();

    const second = renderHook(() => useStoredState("test.value", "", isString));
    expect(second.result.current[0]).toBe("hello");
  });

  test("rejects a stored value that fails validation", () => {
    localStorage.setItem(KEY, JSON.stringify("BOGUS"));
    const { result } = renderHook(() =>
      useStoredState<string | null>("test.value", null, isOneOfOrNull(["A", "B"])),
    );
    expect(result.current[0]).toBeNull();
  });

  test("survives corrupt JSON in storage", () => {
    localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useStoredState("test.value", "default", isString));
    expect(result.current[0]).toBe("default");
  });

  test("round-trips null for nullable select state", () => {
    const first = renderHook(() =>
      useStoredState<string | null>("test.value", "A", isOneOfOrNull(["A", "B"])),
    );
    act(() => first.result.current[1](null));
    first.unmount();

    const second = renderHook(() =>
      useStoredState<string | null>("test.value", "A", isOneOfOrNull(["A", "B"])),
    );
    expect(second.result.current[0]).toBeNull();
  });
});
