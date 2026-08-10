import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import i18next from "i18next";
import EmojiPicker from "./EmojiPicker";

// Record the props the emoji-mart Picker receives — the component's whole job is passing
// the right ones (data + i18n explicitly, or emoji-mart silently fetches them from a CDN).
const pickerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@emoji-mart/react", () => ({
  default: (props: Record<string, unknown>) => {
    pickerProps.current = props;
    return <div data-testid="picker" />;
  },
}));
vi.mock("@emoji-mart/data", () => ({ default: { marker: "data" } }));
vi.mock("@emoji-mart/data/i18n/en.json", () => ({ default: { marker: "en" } }));
vi.mock("@emoji-mart/data/i18n/pl.json", () => ({ default: { marker: "pl" } }));

function renderPicker(colorScheme: "light" | "dark" = "light", onSelect = vi.fn()) {
  render(
    <MantineProvider env="test" forceColorScheme={colorScheme}>
      <EmojiPicker onSelect={onSelect} />
    </MantineProvider>,
  );
  return onSelect;
}

afterEach(() => {
  cleanup();
  pickerProps.current = null;
});

describe("EmojiPicker", () => {
  test("passes the bundled data and English i18n explicitly (never the CDN default)", () => {
    renderPicker();
    expect(pickerProps.current?.data).toEqual({ marker: "data" });
    expect(pickerProps.current?.i18n).toEqual({ marker: "en" });
    expect(pickerProps.current?.theme).toBe("light");
  });

  test("follows the dark color scheme", () => {
    renderPicker("dark");
    expect(pickerProps.current?.theme).toBe("dark");
  });

  test("uses the Polish i18n set under the pl locale", async () => {
    await i18next.changeLanguage("pl");
    try {
      renderPicker();
      expect(pickerProps.current?.i18n).toEqual({ marker: "pl" });
    } finally {
      await i18next.changeLanguage("en");
    }
  });

  test("maps onEmojiSelect to onSelect with the native character", () => {
    const onSelect = renderPicker();
    (pickerProps.current?.onEmojiSelect as (e: { native: string }) => void)({ native: "🥬" });
    expect(onSelect).toHaveBeenCalledWith("🥬");
  });
});
