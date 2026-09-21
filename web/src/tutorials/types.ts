// Types shared by every per-feature tutorial (tutorials/*.tsx) and the registry (index.ts).
// Kept separate from tourSupport.ts so that module can type-import TutorialId without a runtime
// cycle (verbatimModuleSyntax erases `import type` at build time either way).
import type { Feature } from "../api/session";
import type { TourStepDef } from "../components/tourSupport";

/** One entry per shipped tutorial. Add the next feature's id here (see web/CLAUDE.md's
 *  "Feature tutorials" recipe). */
export type TutorialId =
  | "feedbacks"
  | "goals"
  | "daysOff"
  | "performanceReviews"
  | "oneOnOnes"
  | "impactLog"
  | "teamKpis"
  | "pulse";

export type TutorialDef = {
  id: TutorialId;
  /** The tutorial's own feature gate (TutorialButton checks this before starting it) — omitted
   *  for a feature-ungated area, mirroring TourStepDef's optional `feature`. */
  feature?: Feature;
  /** Where Finish/Abandon land the caller — never `markSeen`d, so the tutorial can always be
   *  replayed. */
  home: string;
  steps: readonly TourStepDef[];
};
