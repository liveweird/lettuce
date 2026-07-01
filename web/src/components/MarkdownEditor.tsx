import { useEffect, useRef } from "react";
import { Input, useComputedColorScheme } from "@mantine/core";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  linkPlugin,
  linkDialogPlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import classes from "./MarkdownEditor.module.css";

export type MarkdownEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  label: string;
  placeholder?: string;
  maxLength?: number;
};

// A Mantine-friendly WYSIWYG editor whose document model is markdown: `value`/`onChange`
// speak the same markdown string the rest of the app stores and renders (react-markdown).
// MDXEditor is uncontrolled (it reads `markdown` once as its initial value), so we bridge it
// to a controlled string: typing flows out via onChange, and *external* updates to `value`
// (e.g. inserting a template) are pushed back in imperatively via the editor ref.
export default function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
}: MarkdownEditorProps) {
  const scheme = useComputedColorScheme("light");
  const ref = useRef<MDXEditorMethods>(null);
  // The last value we emitted from onChange. Lets us tell "the user typed" (value already
  // matches what the editor holds) from "the parent changed value out from under us".
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      ref.current?.setMarkdown(value);
    }
  }, [value]);

  return (
    <Input.Wrapper
      label={label}
      styles={{ root: { display: "flex", flexDirection: "column", minHeight: 0 } }}
    >
      <MDXEditor
        ref={ref}
        markdown={value}
        placeholder={placeholder}
        className={`${classes.editor} ${scheme === "dark" ? "dark-theme" : ""}`}
        contentEditableClassName={classes.content}
        onChange={(markdown) => {
          if (maxLength != null && markdown.length > maxLength) return;
          lastEmitted.current = markdown;
          onChange(markdown);
        }}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          thematicBreakPlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <BoldItalicUnderlineToggles />
                <ListsToggle />
                <BlockTypeSelect />
                <CreateLink />
              </>
            ),
          }),
        ]}
      />
    </Input.Wrapper>
  );
}
