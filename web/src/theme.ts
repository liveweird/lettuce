import {
  AppShell,
  Badge,
  Button,
  Drawer,
  Modal,
  MultiSelect,
  NavLink,
  Select,
  Table,
  Tabs,
  Tooltip,
  createTheme,
  rem,
  type MantineColorsTuple, InputWrapper } from "@mantine/core";
import classes from "./theme.module.css";
import { foldedOptionsFilter } from "./utils/text";

// "Lettuce" brand palette — a fresh leaf-green scale (light → dark, indices 0–9).
const lettuce: MantineColorsTuple = [
  "#f0fdf4",
  "#dcfce7",
  "#bbf7d0",
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a",
  "#15803d", // primary (light scheme)
  "#166534", // primary (dark scheme)
  "#14532d",
];

// Inter is bundled (via @fontsource-variable/inter, imported in main.tsx) so it loads same-origin
// and satisfies the CSP `font-src 'self'`; the system stack is the fallback (e.g. in tests).
const sans =
  "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Badge dimensions per size (the vars resolver wins over Mantine's inline size vars): a quiet
// 22px pill at the default size, 18px for the `size="sm"` table/inline cues.
const BADGE_DIMENSIONS: Record<string, { height: string; fz: string; px: string }> = {
  sm: { height: rem(18), fz: rem(11), px: rem(6) },
  md: { height: rem(22), fz: rem(12), px: rem(8) },
};

// Design language (v1.35.0 "clean enterprise SaaS", re-cut in v3.3.0 as "border-first LoB"):
// the brand green is the interactive accent (buttons, links, active nav, subtle row actions)
// at a deep, serious shade; SEMANTIC success is teal (see the status badges) so state colors
// never impersonate the brand; the canvas is a quiet near-white (dark: dark-8) that surfaces
// lift off with hairline borders rather than shadows. Colour tokens (text, dimmed, borders,
// the light-variant inks) live in themeVariables.ts. Don't reintroduce stock-blue actions or
// stock-green success states.
export const theme = createTheme({
  primaryColor: "lettuce",
  // Shade 7 in light mode — deeper, calmer CTAs than the mid-green 6.
  primaryShade: { light: 7, dark: 8 },
  // Pick readable text color on filled brand surfaces automatically.
  autoContrast: true,
  defaultRadius: "md",
  radius: { xs: rem(4), sm: rem(6), md: rem(8), lg: rem(12), xl: rem(16) },
  colors: { lettuce },
  fontFamily: sans,
  // Visible only on keyboard focus; the ring is the brand shade (≥ 3:1 on both grounds).
  focusRing: "auto",
  respectReducedMotion: true,
  headings: {
    fontFamily: sans,
    fontWeight: "600",
    textWrap: "balance",
    // Pages title themselves with order={2}: 1.5rem gives the page title clear rank over
    // section (h3) and card (h4) titles without the stock 1.625rem's poster feel.
    sizes: {
      h1: { fontSize: "1.75rem", lineHeight: "1.25" },
      h2: { fontSize: "1.5rem", lineHeight: "1.3" },
      h3: { fontSize: "1.125rem", lineHeight: "1.4" },
      h4: { fontSize: "1rem", lineHeight: "1.45" },
    },
  },
  // Near-flat resting elevation (surfaces are border-first); md+ stay for hover lifts,
  // popovers, and drawers.
  shadows: {
    xs: "0 1px 1px rgba(16, 24, 40, 0.03)",
    sm: "0 1px 2px rgba(16, 24, 40, 0.04)",
    md: "0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.06)",
    lg: "0 12px 16px -4px rgba(16, 24, 40, 0.1), 0 4px 6px -2px rgba(16, 24, 40, 0.05)",
    xl: "0 20px 24px -4px rgba(16, 24, 40, 0.1), 0 8px 8px -4px rgba(16, 24, 40, 0.04)",
  },
  components: {
    // Every data table in the app: a card-like frame on the quiet canvas, hoverable compact
    // rows (~44px), and a neutral header row (see theme.module.css). New tables inherit all
    // of it — never re-declare these props or add per-table frames.
    Table: Table.extend({
      defaultProps: { highlightOnHover: true, verticalSpacing: "xs", horizontalSpacing: "sm", fz: "sm" },
      classNames: { table: classes.table, thead: classes.tableHead },
    }),
    // The shell surfaces: white header/navbar over a tinted main canvas, crisp separators.
    AppShell: AppShell.extend({
      classNames: {
        main: classes.appMain,
        header: classes.appHeader,
        navbar: classes.appNavbar,
      },
    }),
    NavLink: NavLink.extend({ classNames: { root: classes.navLink } }),
    // Every searchable Select/MultiSelect matches accent-insensitively ("zolw" finds "Żółw"),
    // mirroring the server-side unaccent list filters. A per-site `filter` prop still wins —
    // don't pass one unless it preserves the diacritics folding (see utils/text.ts).
    Select: Select.extend({ defaultProps: { filter: foldedOptionsFilter } }),
    MultiSelect: MultiSelect.extend({ defaultProps: { filter: foldedOptionsFilter } }),
    // Sentence-case light pills everywhere (no uppercase shouting); the status components add
    // the hue dot through StatusPill.
    Badge: Badge.extend({
      defaultProps: { variant: "light", radius: "sm" },
      classNames: { root: classes.badge },
      vars: (_theme, props) => {
        const dims = BADGE_DIMENSIONS[String(props.size ?? "md")];
        return {
          root: dims ? { "--badge-height": dims.height, "--badge-fz": dims.fz, "--badge-padding-x": dims.px } : {},
        };
      },
    }),
    Button: Button.extend({ classNames: { root: classes.button } }),
    Tabs: Tabs.extend({ classNames: { tab: classes.tab } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: "md", openDelay: 300 } }),
    // Every input renders label → input → description → error (v3.5.0): hints and errors
    // sit UNDER the control, so sibling fields in a row stay level whatever their hints.
    // The 17 per-site inputWrapperOrder props this replaced are gone — never re-add one.
    InputWrapper: InputWrapper.extend({ defaultProps: { inputWrapperOrder: ["label", "input", "description", "error"] } }),
    Modal: Modal.extend({
      defaultProps: { radius: "md", centered: true, overlayProps: { backgroundOpacity: 0.45, blur: 2 } },
      classNames: { title: classes.dialogTitle },
    }),
    // The classNames apply to both the plain `<Drawer>` and the compound `<Drawer.Root>`
    // (both style under the "Drawer" name), but defaultProps do NOT: `Drawer.Root` reads
    // "DrawerRoot" and `Drawer.Overlay` reads "DrawerOverlay", so the overlay defaults live on
    // DrawerOverlay — the one place BOTH shapes go through (plain Drawer spreads its own
    // `overlayProps` over it, so a per-site override still wins). `position` reaches the
    // plain shape only; compound drawers (the notifications panel) pass it themselves.
    Drawer: Drawer.extend({
      defaultProps: { position: "right" },
      classNames: { title: classes.dialogTitle },
    }),
    DrawerOverlay: Drawer.Overlay.extend({ defaultProps: { backgroundOpacity: 0.45, blur: 2 } }),
  },
});
