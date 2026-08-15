import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import EmojiTextarea from "./EmojiTextarea";

// The picker plumbing is EmojiButton's concern (tested there); here a stub that inserts a
// fixed emoji exercises the caret-splice logic.
vi.mock("./EmojiButton", () => ({
  default: ({ onSelect, label }: { onSelect: (native: string) => void; label: string }) => (
    <button aria-label={label} onClick={() => onSelect("😀")} />
  ),
}));

function renderArea(props: Partial<React.ComponentProps<typeof EmojiTextarea>> = {}) {
  const onChange = vi.fn();
  render(
    <MantineProvider env="test">
      <EmojiTextarea aria-label="Note" value="hello world" onChange={onChange} {...props} />
    </MantineProvider>,
  );
  return { onChange, area: screen.getByLabelText("Note") as HTMLTextAreaElement };
}

afterEach(cleanup);

describe("EmojiTextarea", () => {
  test("typing forwards the plain string", async () => {
    const { onChange, area } = renderArea({ value: "" });
    await userEvent.type(area, "x");
    expect(onChange).toHaveBeenLastCalledWith("x");
  });

  test("splices the emoji at the caret", async () => {
    const { onChange, area } = renderArea();
    area.focus();
    area.setSelectionRange(5, 5);
    await userEvent.click(screen.getByLabelText("Insert emoji"));
    expect(onChange).toHaveBeenCalledWith("hello😀 world");
  });

  test("replaces a selection", async () => {
    const { onChange, area } = renderArea();
    area.focus();
    area.setSelectionRange(6, 11);
    await userEvent.click(screen.getByLabelText("Insert emoji"));
    expect(onChange).toHaveBeenCalledWith("hello 😀");
  });

  test("blocks an insert that would exceed maxLength", async () => {
    const { onChange } = renderArea({ value: "12345", maxLength: 6 });
    // The emoji is 2 UTF-16 units — 5 + 2 > 6.
    await userEvent.click(screen.getByLabelText("Insert emoji"));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("renders the counter when maxLength is set", () => {
    renderArea({ maxLength: 20 });
    expect(screen.getByText("11 / 20")).toBeInTheDocument();
  });

  test("counter='none' suppresses it and no maxLength means no counter", () => {
    renderArea({ maxLength: 20, counter: "none" });
    expect(screen.queryByText("11 / 20")).not.toBeInTheDocument();
    cleanup();
    renderArea();
    expect(screen.queryByText(/\/ \d+$/)).not.toBeInTheDocument();
  });

  test("nearLimit counter stays hidden until 80% of the cap", () => {
    renderArea({ maxLength: 100, counter: "nearLimit" }); // 11 chars < 80
    expect(screen.queryByText("11 / 100")).not.toBeInTheDocument();
    cleanup();
    renderArea({ maxLength: 12, counter: "nearLimit" }); // 11 >= 9.6
    expect(screen.getByText("11 / 12")).toBeInTheDocument();
  });

  test("a caller-passed description shares the line with the counter", () => {
    renderArea({ maxLength: 20, description: "Optional hint" });
    expect(screen.getByText("Optional hint")).toBeInTheDocument();
    expect(screen.getByText("11 / 20")).toBeInTheDocument();
  });

  test("passes label and error through to the Textarea", () => {
    const onChange = vi.fn();
    render(
      <MantineProvider env="test">
        <EmojiTextarea label="Comment" error="Required" value="" onChange={onChange} />
      </MantineProvider>,
    );
    expect(screen.getByText("Comment")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});
