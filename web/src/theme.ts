import {
  AppShell,
  Badge,
  Button,
  Drawer,
  Input,
  Menu,
  Modal,
  MultiSelect,
  NavLink,
  Select,
  SegmentedControl,
  Table,
  Tabs,
  Tooltip,
  createTheme,
  rem,
  type MantineColorsTuple,
  InputWrapper,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import classes from "./theme.module.css";
import { foldedOptionsFilter } from "./utils/text";

// Mineral greens derived from the product's leaf mark. Shade 7 is the approved interactive
// accent; the pale shades support selected navigation and restrained secondary surfaces.
const lettuce: MantineColorsTuple = [
  "#f3f8f5",
  "#e5eee8",
  "#cadfd1",
  "#a6cbb5",
  "#75ad8e",
  "#4a8d6b",
  "#277654",
  "#146347", // approved leaf accent
  "#104f39",
  "#0c3d2c",
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
  primaryShade: { light: 7, dark: 6 },
  // Pick readable text color on filled brand surfaces automatically.
  autoContrast: true,
  defaultRadius: "sm",
  radius: { xs: rem(4), sm: rem(6), md: rem(9), lg: rem(10), xl: rem(14) },
  colors: { lettuce },
  fontFamily: sans,
  // Visible only on keyboard focus; the ring is the brand shade (≥ 3:1 on both grounds).
  focusRing: "auto",
  respectReducedMotion: true,
  headings: {
    fontFamily: sans,
    fontWeight: "600",
    textWrap: "balance",
    // Page titles are the one strong typographic gesture. Section and card headings stay
    // compact so dense people-management screens retain a calm hierarchy.
    sizes: {
      h1: { fontSize: "2rem", lineHeight: "1.2" },
      h2: { fontSize: "1.75rem", lineHeight: "1.25" },
      h3: { fontSize: "1.125rem", lineHeight: "1.35" },
      h4: { fontSize: "1rem", lineHeight: "1.45" },
    },
  },
  // Near-flat resting elevation (surfaces are border-first); md+ stay for hover lifts,
  // popovers, and drawers.
  shadows: {
    xs: "0 1px 2px rgba(25, 48, 37, 0.025)",
    sm: "0 1px 2px rgba(25, 48, 37, 0.035)",
    md: "0 8px 24px rgba(25, 48, 37, 0.1)",
    lg: "0 18px 48px rgba(25, 48, 37, 0.14)",
    xl: "0 28px 80px rgba(25, 48, 37, 0.18)",
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
    Input: Input.extend({ classNames: { input: classes.input } }),
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
    Menu: Menu.extend({ classNames: { dropdown: classes.menuDropdown, item: classes.menuItem } }),
    SegmentedControl: SegmentedControl.extend({
      classNames: { root: classes.segmentedRoot, control: classes.segmentedControl, label: classes.segmentedLabel },
    }),
    Tabs: Tabs.extend({ classNames: { tab: classes.tab } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: "md", openDelay: 300 } }),
    // Every date picker's calendar marks today (v4.7.0 — the same "where am I" cue as the
    // days-off month grid's today column).
    DateInput: DateInput.extend({ defaultProps: { highlightToday: true } }),
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
