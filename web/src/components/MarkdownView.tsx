import { createElement, type ComponentProps } from "react";
import { Typography } from "@mantine/core";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkGemoji from "remark-gemoji";
import classes from "./MarkdownView.module.css";

// Read-only renderer for the markdown strings the app stores (feedback + template content).
// Single home for the Mantine Typography wrapper + the GFM plugin set; the rendered column is
// capped at the reading width (MarkdownView.module.css).

// User markdown sits under the page's one h1 (v4.21.0), so its headings are rendered one level
// lower (# → h2 … ##### → h6, ###### stays h6): no second h1, no skipped level. `data-md-level`
// carries the SOURCE level so the stylesheet can keep that level's size.
const HEADING_TAGS = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;

const headingComponents: Components = Object.fromEntries(
  HEADING_TAGS.map((tag, index) => [
    `h${index + 1}`,
    ({ node: _node, ...props }: ComponentProps<"h1"> & ExtraProps) => createElement(tag, { ...props, "data-md-level": index + 1 }),
  ]),
) as Components;

export default function MarkdownView({ children }: { children: string | null | undefined }) {
  return (
    <Typography className={classes.prose}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkGemoji]} components={headingComponents}>
        {children}
      </ReactMarkdown>
    </Typography>
  );
}
