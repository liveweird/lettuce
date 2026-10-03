import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import SharedByBanner from "./SharedByBanner";

describe("SharedByBanner", () => {
  test("announces the note politely: role=status, never the assertive alert role", () => {
    renderWithProviders(<SharedByBanner name="Sue Sharer" />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Shared with you by Sue Sharer");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("renders nothing without a sharer name", () => {
    renderWithProviders(<SharedByBanner name={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    renderWithProviders(<SharedByBanner name="" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
