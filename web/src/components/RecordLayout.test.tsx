import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../test/render";
import RecordLayout from "./RecordLayout";

describe("RecordLayout keyboard reading order", () => {
  test("aside context follows the document, matching its phone reading order", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecordLayout metadataPlacement="aside" metadata={<a href="#person">Person details</a>}>
        <button>History</button>
      </RecordLayout>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "History" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Person details" })).toHaveFocus();
  });

  test("top context precedes a dense document", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RecordLayout metadata={<a href="#person">Person details</a>}>
        <button>History</button>
      </RecordLayout>,
    );
    await user.tab();
    expect(screen.getByRole("link", { name: "Person details" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "History" })).toHaveFocus();
  });
});
