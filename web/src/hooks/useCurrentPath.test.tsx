import { describe, expect, test } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useCurrentPath } from "./useCurrentPath";

function at(url: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
}

describe("useCurrentPath", () => {
  test("returns pathname plus search", () => {
    const { result } = renderHook(() => useCurrentPath(), { wrapper: at("/goals?tab=own&x=1") });
    expect(result.current).toBe("/goals?tab=own&x=1");
  });

  test("returns the bare pathname without a query and drops the hash", () => {
    const { result } = renderHook(() => useCurrentPath(), { wrapper: at("/users#top") });
    expect(result.current).toBe("/users");
  });
});
