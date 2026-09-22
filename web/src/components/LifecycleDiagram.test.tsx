import { describe, expect, test } from "vitest";
import { renderWithProviders, screen } from "../test/render";
import LifecycleDiagram from "./LifecycleDiagram";

const NODES = [
  { id: "DRAFT", x: 20, y: 40, label: "Draft" },
  { id: "ACTIVE", x: 275, y: 40, label: "Active" },
  { id: "ARCHIVED", x: 530, y: 40, label: "Archived", terminal: true },
];

const EDGES = [
  { id: "activate", x1: 190, y1: 67, x2: 275, y2: 67, label: "Activate", labelX: 232, labelY: 55 },
  { id: "unlabeled", x1: 275, y1: 100, x2: 190, y2: 100 },
];

describe("LifecycleDiagram", () => {
  test("renders nodes, edge labels, alt text and hint", () => {
    renderWithProviders(
      <LifecycleDiagram
        viewBox="0 0 720 150"
        width={720}
        nodeWidth={170}
        nodeHeight={60}
        nodes={NODES}
        edges={EDGES}
        markerId="test-lc-arrow"
        altText="Diagram of the test lifecycle"
        hint="This is a hint."
      />,
    );
    expect(screen.getByRole("img", { name: "Diagram of the test lifecycle" })).toBeInTheDocument();
    for (const label of ["Draft", "Active", "Archived"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Activate")).toBeInTheDocument();
    expect(screen.getByText("This is a hint.")).toBeInTheDocument();
  });

  test("highlights the active node and dims a non-active terminal node", () => {
    renderWithProviders(
      <LifecycleDiagram
        viewBox="0 0 720 150"
        width={720}
        nodeWidth={170}
        nodeHeight={60}
        nodes={NODES}
        edges={EDGES}
        currentId="ACTIVE"
        markerId="test-lc-arrow"
        altText="Diagram of the test lifecycle"
        hint="This is a hint."
      />,
    );
    const highlighted = document.querySelector('rect[fill="var(--mantine-primary-color-light)"]');
    expect(highlighted).not.toBeNull();
    const active = screen.getByText("Active");
    expect(active).toHaveAttribute("font-weight", "600");
    const archived = screen.getByText("Archived");
    expect(archived).toHaveAttribute("fill", "var(--mantine-color-dimmed)");
  });

  test("with no current id, no node is highlighted and a terminal-marked node still renders plain when active", () => {
    renderWithProviders(
      <LifecycleDiagram
        viewBox="0 0 720 150"
        width={720}
        nodeWidth={170}
        nodeHeight={60}
        nodes={NODES}
        edges={EDGES}
        markerId="test-lc-arrow"
        altText="Diagram of the test lifecycle"
        hint="This is a hint."
      />,
    );
    expect(document.querySelector('rect[fill="var(--mantine-primary-color-light)"]')).toBeNull();
  });

  test("an active terminal node is not dimmed", () => {
    renderWithProviders(
      <LifecycleDiagram
        viewBox="0 0 720 150"
        width={720}
        nodeWidth={170}
        nodeHeight={60}
        nodes={NODES}
        edges={EDGES}
        currentId="ARCHIVED"
        markerId="test-lc-arrow"
        altText="Diagram of the test lifecycle"
        hint="This is a hint."
      />,
    );
    const archived = screen.getByText("Archived");
    expect(archived).toHaveAttribute("fill", "var(--mantine-color-text)");
  });
});
