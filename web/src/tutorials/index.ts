// The per-feature tutorial registry — one TutorialDef per shipped tutorial, keyed by TutorialId.
// Tour.tsx reads TUTORIALS[tutorial].steps when a tutorial is running; TutorialButton starts one
// by id. Adding a tutorial: a new tutorials/<area>.tsx, a TutorialId union entry (types.ts), and
// an entry here — see "Feature tutorials" in web/CLAUDE.md.
import { DAYS_OFF_TUTORIAL } from "./daysOff";
import { FEEDBACKS_TUTORIAL } from "./feedbacks";
import { GOALS_TUTORIAL } from "./goals";
import { IMPACT_LOG_TUTORIAL } from "./impactLog";
import { ONE_ON_ONES_TUTORIAL } from "./oneOnOnes";
import { PERFORMANCE_REVIEWS_TUTORIAL } from "./performanceReviews";
import type { TutorialDef, TutorialId } from "./types";

export const TUTORIALS: Record<TutorialId, TutorialDef> = {
  feedbacks: FEEDBACKS_TUTORIAL,
  goals: GOALS_TUTORIAL,
  daysOff: DAYS_OFF_TUTORIAL,
  performanceReviews: PERFORMANCE_REVIEWS_TUTORIAL,
  oneOnOnes: ONE_ON_ONES_TUTORIAL,
  impactLog: IMPACT_LOG_TUTORIAL,
};
