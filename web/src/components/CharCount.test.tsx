import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import CharCount from "./CharCount";
import { charCountDescription, shouldShowCharCount } from "../utils/charCount";

afterEach(cleanup);

function renderCount(props: React.ComponentProps<typeof CharCount>) {
  render(
    <MantineProvider env="test">
      <CharCount {...props} />
    </MantineProvider>,
  );
}

describe("CharCount", () => {
  test("always mode renders current / max", () => {
    renderCount({ current: 3, max: 10 });
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
  });

  test("nearLimit mode hides below 80% and shows from 80%", () => {
    renderCount({ current: 7, max: 10, mode: "nearLimit" });
    expect(screen.queryByText("7 / 10")).not.toBeInTheDocument();
    cleanup();
    renderCount({ current: 8, max: 10, mode: "nearLimit" });
    expect(screen.getByText("8 / 10")).toBeInTheDocument();
  });

  test("turns red when over the limit (the programmatic-push path)", () => {
    renderCount({ current: 11, max: 10 });
    const el = screen.getByText("11 / 10");
    // Mantine resolves c="red" into a red color token somewhere on the element —
    // assert on the serialized element rather than a specific mechanism.
    expect(el.outerHTML).toContain("red");
  });

  test("shouldShowCharCount mirrors the modes", () => {
    expect(shouldShowCharCount(0, 10, "always")).toBe(true);
    expect(shouldShowCharCount(7, 10, "nearLimit")).toBe(false);
    expect(shouldShowCharCount(8, 10, "nearLimit")).toBe(true);
  });

  test("charCountDescription is undefined while hidden so no empty description renders", () => {
    expect(charCountDescription(1, 10)).toBeUndefined();
    expect(charCountDescription(9, 10)).toBeDefined();
    expect(charCountDescription(1, 10, "always")).toBeDefined();
  });
});
