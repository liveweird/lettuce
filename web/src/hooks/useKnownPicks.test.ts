import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { isKnownOption, isKnownTeam, useKnownPicks } from "./useKnownPicks";

describe("useKnownPicks", () => {
  test("the stored picks stand until the options arrive, then unknown ones are dropped", () => {
    const stored = ["1", "99"];
    const { result, rerender } = renderHook(
      ({ source }: { source: { id: number }[] | undefined }) => useKnownPicks(stored, source, isKnownTeam),
      { initialProps: { source: undefined as { id: number }[] | undefined } },
    );
    expect(result.current).toBe(stored);
    rerender({ source: [{ id: 1 }, { id: 2 }] });
    expect(result.current).toEqual(["1"]);
  });

  test("keeps the stored array's identity when nothing is dropped, and a stable one when something is", () => {
    const stored = ["a", "b"];
    const options = [{ value: "a" }, { value: "b" }];
    const { result, rerender } = renderHook(
      ({ source }: { source: { value: string }[] | undefined }) => useKnownPicks(stored, source, isKnownOption),
      { initialProps: { source: undefined as { value: string }[] | undefined } },
    );
    rerender({ source: options });
    expect(result.current).toBe(stored);

    const dropped = ["a", "gone"];
    const second = renderHook(() => useKnownPicks(dropped, options, isKnownOption));
    const first = second.result.current;
    second.rerender();
    expect(second.result.current).toBe(first);
    expect(first).toEqual(["a"]);
  });
});
