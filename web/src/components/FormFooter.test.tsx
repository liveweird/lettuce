import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import FormFooter from "./FormFooter";

describe("FormFooter", () => {
  test("renders its buttons right-aligned, sticky on request", () => {
    const { container, rerender } = renderWithProviders(
      <FormFooter>
        <button type="button">Cancel</button>
      </FormFooter>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(container.querySelector("[class*='sticky']")).toBeNull();
    rerender(
      <FormFooter sticky>
        <button type="button">Save</button>
      </FormFooter>,
    );
    expect(container.querySelector("[class*='sticky']")).not.toBeNull();
  });
});
