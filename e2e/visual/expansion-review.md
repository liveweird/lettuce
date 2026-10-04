# Desktop visual coverage expansion

Status: first review batch ready for candidate review on `test/desktop-visual-expansion`. New screenshots are
candidates, not approved references. The twelve v4.15.2 baselines accepted on 2026-10-04 remain
unchanged in `snapshots/` and remain CI's reference.

## Staged plan

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Sidebar active-link visibility; Dashboard member/manager; Users and Teams member/admin | Implemented; candidate approval pending |
| 2 | Representative forms/detail pages, including validation, editor and footer states | Planned after stage 1 review |
| 3 | Remaining frequently used feature lists; add states by risk and reuse shared fixtures | Planned after stage 2 review |

Each stage captures candidates, presents them for human review, then promotes approved images
into CI. Approval of the initial twelve images does not approve later changes automatically.
This batch does not claim whole-app visual coverage or change backend APIs.

## Stage 1 behavior and coverage

The v4.15.3 sidebar fix reveals the active destination in its own scroll viewport on direct
entry, route changes, group expansion and rail/expanded switches. It preserves manual collapse,
keyboard focus and the main document's scroll position. Three browser regressions exercise a
1280×720 desktop with normal animation, independently of screenshot assertions.

Six new candidate views use fixed synthetic, generated-schema-typed data:

- Member Dashboard / My managers, 1440×1000: personal tiles and manager cards.
- Manager Dashboard / My subordinates, 1280×1000: management tiles and three cards with varied stats.
- Member Users, 1280×1000, and administrator Users, 1440×1000: long names/emails, mixed roles,
  a missing unique ID and one inactive account, with the appropriate row controls.
- Member Teams, 1280×1000, and administrator Teams, 1440×1000: long team/manager names,
  read-only links versus editing controls.

The existing twelve screenshots also change their displayed version to 4.15.3; dictionary
screens may additionally scroll the sidebar to reveal the active item. No content masks or
pixel-tolerance relaxation are introduced.

## Review and verification

Candidate gallery, old/new/diff evidence and final verification results will be linked here
once capture and review complete. Do not promote candidates or merge until the owner approves
the concrete result. The ordinary visual CI comparison is expected to reject intentionally
changed/missing baselines until that approval step.
