import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import { VisibilityBadge } from "./FeedbackBadges";

describe("VisibilityBadge", () => {
  test("renders the abbreviated pill with the full label on hover and in the accessible name", () => {
    renderWithProviders(<VisibilityBadge visibility="PROVIDER_REQUESTER_SUBJECT" />);

    const pill = screen.getByText("P+R+S");
    expect(pill).toBeInTheDocument();
    expect(pill.closest("[aria-label]")).toHaveAttribute(
      "aria-label",
      "Visibility: Provider + requester + subject",
    );
    expect(pill.closest("[title]")).toHaveAttribute("title", "Provider + requester + subject");
  });
});
