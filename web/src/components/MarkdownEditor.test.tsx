import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import MarkdownEditor from "./MarkdownEditor";

// Stand in for the Lexical-based editor (which doesn't run in jsdom/happy-dom) with a plain
// textarea that mirrors the parts of the MDXEditor API our wrapper touches: the `markdown`
// initial value, `onChange`, `placeholder`, `className`, and a `setMarkdown` on the ref.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: ({
    markdown,
    onChange,
    placeholder,
    className,
    ref,
  }: {
    markdown: string;
    onChange?: (md: string) => void;
    placeholder?: string;
    className?: string;
    ref?: { current: unknown };
  }) => {
    if (ref) ref.current = { setMarkdown: (md: string) => onChange?.(md) };
    return (
      <textarea
        data-testid="mdx"
        className={className}
        placeholder={placeholder}
        defaultValue={markdown}
        onChange={(e) => onChange?.(e.target.value)}
      />
    );
  },
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  toolbarPlugin: () => ({}),
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  ListsToggle: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
}));

function renderEditor(ui: React.ReactElement, colorScheme: "light" | "dark" = "light") {
  return render(<MantineProvider forceColorScheme={colorScheme}>{ui}</MantineProvider>);
}

afterEach(cleanup);

describe("MarkdownEditor", () => {
  test("renders the label, placeholder and initial markdown value", () => {
    renderEditor(
      <MarkdownEditor value="**hi**" onChange={() => {}} label="Content" placeholder="Write…" />,
    );
    expect(screen.getByText("Content")).toBeInTheDocument();
    const box = screen.getByTestId("mdx") as HTMLTextAreaElement;
    expect(box).toHaveValue("**hi**");
    expect(box).toHaveAttribute("placeholder", "Write…");
  });

  test("forwards edits to onChange", async () => {
    const onChange = vi.fn();
    renderEditor(<MarkdownEditor value="" onChange={onChange} label="Content" />);
    await userEvent.type(screen.getByTestId("mdx"), "x");
    expect(onChange).toHaveBeenLastCalledWith("x");
  });

  test("drops edits that exceed maxLength", async () => {
    const onChange = vi.fn();
    renderEditor(
      <MarkdownEditor value="" onChange={onChange} label="Content" maxLength={3} />,
    );
    // The mock textarea is uncontrolled, so a single onChange fires the whole "abcd" (length 4).
    await userEvent.type(screen.getByTestId("mdx"), "abcd");
    expect(onChange).not.toHaveBeenCalledWith("abcd");
  });

  test("applies the dark-theme class when the color scheme is dark", () => {
    renderEditor(
      <MarkdownEditor value="" onChange={() => {}} label="Content" />,
      "dark",
    );
    expect(screen.getByTestId("mdx").className).toContain("dark-theme");
  });

  test("pushes an external value change into the editor via the ref", () => {
    const onChange = vi.fn();
    const { rerender } = renderEditor(
      <MarkdownEditor value="one" onChange={onChange} label="Content" />,
    );
    // A value change that did not originate from typing (e.g. template insert) is pushed in
    // imperatively, which the mock surfaces as an onChange.
    rerender(
      <MantineProvider forceColorScheme="light">
        <MarkdownEditor value="two" onChange={onChange} label="Content" />
      </MantineProvider>,
    );
    expect(onChange).toHaveBeenCalledWith("two");
  });
});
