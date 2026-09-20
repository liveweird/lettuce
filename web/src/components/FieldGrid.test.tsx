import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import FieldGrid from "./FieldGrid";

// FieldGrid is a thin SimpleGrid wrapper (v3.12.1) — its only logic is the `cols` default and
// the pass-through of any other SimpleGrid prop. Mantine renders the resolved column config as
// an inline `<style>` rule (`--sg-cols` + its container-query breakpoints) rather than a DOM
// attribute, so that rule's text is what these tests read.
function inlineStyleRules(): string {
  return [...document.querySelectorAll('style[data-mantine-styles="inline"]')]
    .map((el) => el.textContent ?? "")
    .join("\n");
}

function renderGrid(props: Partial<React.ComponentProps<typeof FieldGrid>> = {}) {
  return render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <FieldGrid {...props}>
        <div>field one</div>
        <div>field two</div>
      </FieldGrid>
    </MantineProvider>,
  );
}

describe("FieldGrid", () => {
  test("renders its children", () => {
    renderGrid();
    expect(screen.getByText("field one")).toBeInTheDocument();
    expect(screen.getByText("field two")).toBeInTheDocument();
  });

  test("defaults to one column, widening to three from 40em of container width", () => {
    renderGrid();
    const rules = inlineStyleRules();
    expect(rules).toContain("--sg-cols:1;");
    expect(rules).toContain("@container simple-grid (min-width: 40em)");
    expect(rules).toContain("--sg-cols:3;");
  });

  test("honours a custom cols prop", () => {
    renderGrid({ cols: 2 });
    const rules = inlineStyleRules();
    expect(rules).toContain("--sg-cols:2;");
    expect(rules).not.toContain("@container simple-grid (min-width: 40em)");
  });

  test("passes through other SimpleGrid props", () => {
    renderGrid({ id: "field-grid" });
    expect(document.getElementById("field-grid")).toBeInTheDocument();
  });
});
