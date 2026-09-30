import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import { VisibilityBadge } from "./FeedbackBadges";

describe("VisibilityBadge", () => {
  test("renders the full visibility label on the pill, hover title, and accessible name", () => {
    renderWithProviders(<VisibilityBadge visibility="PROVIDER_REQUESTER_SUBJECT" />);

    const pill = screen.getByText("Provider + requester + subject");
    expect(pill).toBeInTheDocument();
    expect(pill.closest("[aria-label]")).toHaveAttribute(
      "aria-label",
      "Visibility: Provider + requester + subject",
    );
    expect(pill.closest("[title]")).toHaveAttribute("title", "Provider + requester + subject");
  });
});
