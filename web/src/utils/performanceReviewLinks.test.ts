import { describe, expect, test } from "vitest";
import {
  reviewCreateLink,
  reviewEditLink,
  reviewViewLink,
  userPerformanceReviewsLink,
} from "./performanceReviewLinks";

describe("performanceReviewLinks", () => {
  test("reviewCreateLink composes prefill and back params with encoding", () => {
    expect(reviewCreateLink()).toBe("/performance-reviews/new");
    expect(reviewCreateLink(7, "/performance?tab=managed")).toBe(
      "/performance-reviews/new?subordinateId=7&back=%2Fperformance%3Ftab%3Dmanaged",
    );
  });

  test("view and edit links carry from and encoded back", () => {
    expect(reviewViewLink(5)).toBe("/performance-reviews/5/view");
    expect(reviewViewLink(5, "own")).toBe("/performance-reviews/5/view?from=own");
    expect(reviewEditLink(5, "managed", "/users/7/performance-reviews")).toBe(
      "/performance-reviews/5/edit?from=managed&back=%2Fusers%2F7%2Fperformance-reviews",
    );
  });

  test("userPerformanceReviewsLink carries origin, teamId, and audit mode", () => {
    expect(userPerformanceReviewsLink(9, "Bob O'Neil", "subordinates")).toBe(
      "/users/9/performance-reviews?name=Bob%20O'Neil&from=subordinates",
    );
    expect(userPerformanceReviewsLink(9, "Bob", "team", 4)).toBe(
      "/users/9/performance-reviews?name=Bob&from=team&teamId=4",
    );
    expect(userPerformanceReviewsLink(9, "Bob", "details", undefined, true)).toBe(
      "/users/9/performance-reviews?name=Bob&from=details&mode=audit",
    );
  });
});
