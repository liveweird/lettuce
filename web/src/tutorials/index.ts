// The per-feature tutorial registry — one TutorialDef per shipped tutorial, keyed by TutorialId.
// Tour.tsx reads TUTORIALS[tutorial].steps when a tutorial is running; TutorialButton starts one
// by id. Adding a tutorial: a new tutorials/<area>.tsx, a TutorialId union entry (types.ts), and
// an entry here — see "Feature tutorials" in web/CLAUDE.md.
import { FEEDBACKS_TUTORIAL } from "./feedbacks";
import type { TutorialDef, TutorialId } from "./types";

export const TUTORIALS: Record<TutorialId, TutorialDef> = {
  feedbacks: FEEDBACKS_TUTORIAL,
};
