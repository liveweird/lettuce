import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import MarkdownView from "./MarkdownView";
import classes from "./MarkdownView.module.css";

function renderView(markdown: string) {
  return render(
    <MantineProvider env="test">
      <MarkdownView>{markdown}</MarkdownView>
    </MantineProvider>,
  );
}

afterEach(cleanup);

describe("MarkdownView", () => {
  test("renders :shortcode: as the native emoji", () => {
    renderView("Great job :tada: keep it up :+1:");
    expect(screen.getByText("Great job 🎉 keep it up 👍")).toBeInTheDocument();
  });

  test("leaves unknown shortcodes literal", () => {
    renderView("stays :notarealshortcode: literal");
    expect(screen.getByText("stays :notarealshortcode: literal")).toBeInTheDocument();
  });

  test("GFM still renders alongside the emoji plugin", () => {
    renderView("| a | b |\n| - | - |\n| 1 | :tada: |");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("🎉")).toBeInTheDocument();
  });

  test("the rendered column is capped at the reading width", () => {
    renderView("A paragraph of prose.");
    expect(screen.getByText("A paragraph of prose.").parentElement).toHaveClass(classes.prose);
  });

  test("demotes headings one level so the page keeps its single h1", () => {
    renderView("# Title\n\n### Deeper\n\n###### Last");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    const title = screen.getByRole("heading", { level: 2, name: "Title" });
    expect(title).toHaveAttribute("data-md-level", "1");
    expect(screen.getByRole("heading", { level: 4, name: "Deeper" })).toHaveAttribute("data-md-level", "3");
    expect(screen.getByRole("heading", { level: 6, name: "Last" })).toHaveAttribute("data-md-level", "6");
  });
});
