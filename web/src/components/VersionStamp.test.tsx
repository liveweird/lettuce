import { describe, expect, test } from "vitest";
import VersionStamp from "./VersionStamp";
import { APP_VERSION } from "../changelog/version";
import { renderWithProviders, screen } from "../test/render";

describe("VersionStamp", () => {
  test("renders the app version, build commit and timestamp with a tooltip", () => {
    renderWithProviders(<VersionStamp />);
    const stamp = screen.getByTitle("Build version");
    // Commit/time are injected from the real repo by vite.config.ts, so assert shape, not value:
    // "v<version> · <sha>[+dirty] · YYYY-MM-DD HH:mm".
    expect(stamp.textContent).toMatch(/^v\S+ · \S+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(stamp.textContent!.startsWith(`v${APP_VERSION} · `)).toBe(true);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("renders as a router link when `to` is set", () => {
    renderWithProviders(<VersionStamp to="/changelog" />);
    const link = screen.getByRole("link", { name: /v/ });
    expect(link).toHaveAttribute("href", "/changelog");
    expect(link).toHaveAttribute("title", "Build version");
  });
});
