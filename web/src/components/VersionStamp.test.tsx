import { describe, expect, test } from "vitest";
import VersionStamp from "./VersionStamp";
import { renderWithProviders, screen } from "../test/render";

describe("VersionStamp", () => {
  test("renders the build commit and timestamp with a tooltip", () => {
    renderWithProviders(<VersionStamp />);
    const stamp = screen.getByTitle("Build version");
    // Injected from the real repo by vite.config.ts, so assert shape, not value:
    // "<sha>[+dirty] · YYYY-MM-DD HH:mm".
    expect(stamp.textContent).toMatch(/^\S+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
