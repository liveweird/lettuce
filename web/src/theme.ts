import { createTheme, Table, type MantineColorsTuple } from "@mantine/core";
import classes from "./theme.module.css";

// "Lettuce" brand palette — a fresh leaf-green scale (light → dark, indices 0–9).
const lettuce: MantineColorsTuple = [
  "#f0fdf4",
  "#dcfce7",
  "#bbf7d0",
  "#86efac",
  "#4ade80",
  "#22c55e",
  "#16a34a", // primary (light scheme)
  "#15803d",
  "#166534", // primary (dark scheme)
  "#14532d",
];

// Inter is bundled (via @fontsource-variable/inter, imported in main.tsx) so it loads same-origin
// and satisfies the CSP `font-src 'self'`; the system stack is the fallback (e.g. in tests).
const sans =
  "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const theme = createTheme({
  primaryColor: "lettuce",
  primaryShade: { light: 6, dark: 8 },
  // Pick readable text color on filled brand surfaces automatically.
  autoContrast: true,
  defaultRadius: "md",
  colors: { lettuce },
  fontFamily: sans,
  headings: { fontFamily: sans, fontWeight: "650" },
  components: {
    // Every data table in the app: tint the header row so it stands apart from data rows
    // (see theme.module.css). New tables inherit this automatically.
    Table: Table.extend({ classNames: { thead: classes.tableHead } }),
  },
});
