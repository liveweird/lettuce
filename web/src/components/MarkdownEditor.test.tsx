import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import MarkdownEditor from "./MarkdownEditor";

// The insertMarkdown$ publisher captured by the usePublisher mock below (hoisted — vi.mock
// factories run before module-level consts).
const insertSpy = vi.hoisted(() => vi.fn());

// Stand in for the Lexical-based editor (which doesn't run in jsdom/happy-dom) with a plain
// textarea that mirrors the parts of the MDXEditor API our wrapper touches: the `markdown`
// initial value, `onChange`, `placeholder`, `className`, a `setMarkdown` on the ref — and the
// toolbarPlugin's toolbarContents, rendered next to the textarea so the emoji item is testable.
vi.mock("@mdxeditor/editor", () => ({
  MDXEditor: ({
    markdown,
    onChange,
    placeholder,
    className,
    ref,
    plugins,
  }: {
    markdown: string;
    onChange?: (md: string) => void;
    placeholder?: string;
    className?: string;
    ref?: { current: unknown };
    plugins?: Array<{ toolbarContents?: () => React.ReactNode }>;
  }) => {
    if (ref) ref.current = { setMarkdown: (md: string) => onChange?.(md) };
    return (
      <div>
        {plugins?.map((p, i) => (p?.toolbarContents ? <div key={i}>{p.toolbarContents()}</div> : null))}
        <textarea
          data-testid="mdx"
          className={className}
          placeholder={placeholder}
          defaultValue={markdown}
          onChange={(e) => onChange?.(e.target.value)}
        />
      </div>
    );
  },
  headingsPlugin: () => ({}),
  listsPlugin: () => ({}),
  quotePlugin: () => ({}),
  linkPlugin: () => ({}),
  linkDialogPlugin: () => ({}),
  thematicBreakPlugin: () => ({}),
  markdownShortcutPlugin: () => ({}),
  toolbarPlugin: (opts: { toolbarContents?: () => React.ReactNode }) => opts,
  UndoRedo: () => null,
  BoldItalicUnderlineToggles: () => null,
  ListsToggle: () => null,
  BlockTypeSelect: () => null,
  CreateLink: () => null,
  usePublisher: () => insertSpy,
  insertMarkdown$: {},
}));

// The real EmojiButton lazy-loads emoji-mart; a stub button forwarding a fixed emoji is enough
// to prove the toolbar item wires the picker to the insertMarkdown$ publisher.
vi.mock("./EmojiButton", () => ({
  default: ({ onSelect, label }: { onSelect: (native: string) => void; label: string }) => (
    <button aria-label={label} onClick={() => onSelect("😀")} />
  ),
}));

function renderEditor(ui: React.ReactElement, colorScheme: "light" | "dark" = "light") {
  return render(<MantineProvider env="test" forceColorScheme={colorScheme}>{ui}</MantineProvider>);
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

  test("the toolbar emoji button publishes the picked emoji into the editor", async () => {
    insertSpy.mockClear();
    renderEditor(<MarkdownEditor value="" onChange={() => {}} label="Content" />);
    await userEvent.click(screen.getByLabelText("Insert emoji"));
    expect(insertSpy).toHaveBeenCalledWith("😀");
  });

  test("pushes an external value change into the editor via the ref", () => {
    const onChange = vi.fn();
    const { rerender } = renderEditor(
      <MarkdownEditor value="one" onChange={onChange} label="Content" />,
    );
    // A value change that did not originate from typing (e.g. template insert) is pushed in
    // imperatively, which the mock surfaces as an onChange.
    rerender(
      <MantineProvider env="test" forceColorScheme="light">
        <MarkdownEditor value="two" onChange={onChange} label="Content" />
      </MantineProvider>,
    );
    expect(onChange).toHaveBeenCalledWith("two");
  });
});
