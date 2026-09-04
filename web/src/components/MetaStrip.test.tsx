import { describe, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import MetaStrip from "./MetaStrip";

describe("MetaStrip", () => {
  test("renders each item as a definition (term over detail) in one list", () => {
    renderWithProviders(
      <MetaStrip
        items={[
          { label: "Name", value: "Platform" },
          { label: "Manager", value: <a href="/users/2/details">Alice</a>, key: "manager" },
        ]}
      />,
    );
    const terms = screen.getAllByRole("term");
    expect(terms.map((el) => el.textContent)).toEqual(["Name", "Manager"]);
    const definitions = screen.getAllByRole("definition");
    expect(definitions).toHaveLength(2);
    expect(definitions[0]).toHaveTextContent("Platform");
    expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/users/2/details");
  });
});
