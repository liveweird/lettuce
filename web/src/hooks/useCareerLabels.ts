import { useCallback } from "react";
import { useDictionaryOptions } from "./useDictionaryOptions";
import type { CareerRef } from "../utils/describeActivity";

/**
 * Resolves a career reference (kind + dictionary entry id) to its LIVE label in the viewer's
 * language, over the three career dictionaries' shared `useDictionaryOptions` queries. Fetches
 * only while `enabled` — the activity page asks only when a career row is on the page. Returns
 * undefined for an entry that is no longer active (or while the dictionary is loading), so the
 * caller falls back to the display name frozen on the event.
 */
export function useCareerLabels(enabled: boolean): (kind: CareerRef, id: string) => string | undefined {
  const paths = useDictionaryOptions("career-paths", null, enabled).options;
  const specializations = useDictionaryOptions("career-specializations", null, enabled).options;
  const levels = useDictionaryOptions("seniority-levels", null, enabled).options;
  return useCallback(
    (kind: CareerRef, id: string) => {
      const options = kind === "careerPath" ? paths : kind === "careerSpecialization" ? specializations : levels;
      return options.find((o) => o.value === id)?.label;
    },
    [paths, specializations, levels],
  );
}
