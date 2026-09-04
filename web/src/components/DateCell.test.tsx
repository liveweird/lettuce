import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import DateCell from "./DateCell";

// The exact timestamp behind a relative phrase — the localized formatDateTime (v3.5.0).
const stamp = (ms: number) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

describe("DateCell", () => {
  test("relative mode renders the relative phrase with the exact timestamp as the title", () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 3600 * 1000;
    renderWithProviders(<DateCell value={twoDaysAgo} />);
    const cell = screen.getByText("2 days ago");
    expect(cell).toHaveAttribute("title", stamp(twoDaysAgo));
  });

  test("absolute mode renders the exact timestamp without a title", () => {
    const ms = new Date(2026, 6, 15, 9, 5).getTime();
    renderWithProviders(<DateCell value={ms} mode="absolute" />);
    const cell = screen.getByText(stamp(ms));
    expect(cell).not.toHaveAttribute("title");
  });

  test("date mode renders a localized ISO date", () => {
    renderWithProviders(<DateCell value="2026-07-15" mode="date" />);
    expect(screen.getByText("Jul 15, 2026")).toBeInTheDocument();
  });

  test("a missing value renders the dash", () => {
    renderWithProviders(<DateCell value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
