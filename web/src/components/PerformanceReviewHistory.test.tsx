import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PerformanceReviewHistory from "./PerformanceReviewHistory";
import PerformanceReviewStatusBadge from "./PerformanceReviewStatusBadge";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";

type FetchMock = ReturnType<typeof vi.fn>;

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MantineProvider>,
  );
}

function event(id: number, type: string, params: Record<string, string>) {
  return { id, reviewId: 5, userId: 7, userName: "Mona Manager", timestamp: 1_700_000_000_000, type, params };
}

describe("PerformanceReviewHistory", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders each structured event localized — rating changes as the bare fact", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        items: [
          event(1, "CREATED", {}),
          // Since v1.49.0 the params carry only the category — ratings are encrypted at
          // rest, so history records that a rating changed, never the values.
          event(2, "RATING_CHANGED", { category: "ATTITUDE" }),
          event(3, "RATING_CHANGED", { category: "SKILLS" }),
          event(4, "SUMMARY_CHANGED", { category: "DELIVERY" }),
          event(5, "STATUS_CHANGED", { from: "DRAFT", to: "CALIBRATION" }),
          event(6, "SOMETHING_NEW", {}),
        ],
      }),
    );
    renderWithProviders(<PerformanceReviewHistory reviewId={5} />);

    expect(await screen.findByText("Review created")).toBeInTheDocument();
    expect(screen.getByText("Attitude rating changed")).toBeInTheDocument();
    expect(screen.getByText("Skills rating changed")).toBeInTheDocument();
    expect(screen.getByText("Delivery summary updated")).toBeInTheDocument();
    expect(screen.getByText("Status changed from Draft to Calibration")).toBeInTheDocument();
    // Forward-compat: an unknown kind shows its raw type instead of breaking.
    expect(screen.getByText("SOMETHING_NEW")).toBeInTheDocument();
    // The acting user is attributed.
    expect(screen.getAllByText(/Mona Manager/).length).toBeGreaterThan(0);
  });

  test("an empty trail renders the no-history hint", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { items: [] }));
    renderWithProviders(<PerformanceReviewHistory reviewId={5} />);
    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
  });
});

describe("RatingBadge", () => {
  test("renders the number in a pill colored by the orange→green scale", async () => {
    const { default: RatingBadge } = await import("./RatingBadge");
    renderWithProviders(
      <>
        <RatingBadge rating={1} />
        <RatingBadge rating={6} />
      </>,
    );
    const low = screen.getByText("1");
    const high = screen.getByText("6");
    expect(low).toBeInTheDocument();
    expect(high).toBeInTheDocument();
    // The scale's poles carry different Mantine colors (orange.8 vs green.8) — the badges'
    // inline styles (where Mantine resolves the color) must differ.
    const badgeOf = (el: HTMLElement) => el.closest(".mantine-Badge-root") as HTMLElement;
    expect(badgeOf(low).getAttribute("style")).not.toBe(badgeOf(high).getAttribute("style"));
  });
});

describe("PerformanceReviewStatusBadge", () => {
  test("labels every status", () => {
    renderWithProviders(
      <>
        <PerformanceReviewStatusBadge status="DRAFT" />
        <PerformanceReviewStatusBadge status="CALIBRATION" />
        <PerformanceReviewStatusBadge status="PUBLISHED" />
      </>,
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Calibration")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
  });
});
