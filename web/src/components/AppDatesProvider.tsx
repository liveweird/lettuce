import type { ReactNode } from "react";
import { DatesProvider } from "@mantine/dates";
import { useTranslation } from "react-i18next";

/**
 * The one `@mantine/dates` settings provider (v3.5.0): calendar locale follows the UI
 * language (the dayjs locales are registered lazily with each language bundle — a new shipped
 * language adds its `DAYJS_LOCALES` line in i18n.ts), weeks start on Monday. Mounted in main.tsx and the test
 * render wrapper, so every DateField/DateTimeField shares it.
 */
export default function AppDatesProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <DatesProvider settings={{ locale: i18n.resolvedLanguage ?? "en", firstDayOfWeek: 1, consistentWeeks: true }}>
      {children}
    </DatesProvider>
  );
}
