# Desktop sidebar visibility regression

- **Spec**: [sidebar.spec.ts](../../visual/tests/sidebar.spec.ts)
- **Actor**: synthetic member, desktop 1280×720 with normal animation enabled.
- **Owns**: isolated page context; no server data or mutations.
- **Scope**: geometry and focus assertions, independent of screenshot approval.

## Scenario: deep dictionary entry reveals the active link without scrolling the page or moving focus

1. Open Pulse rotating questions directly with an expanded sidebar.
   - *Expected*: the page is ready and its active sidebar link is fully inside the scroll viewport.
2. Inspect scroll position and focus without clicking or scrolling the active link in the test.
   - *Expected*: the main page remains at the top and the active link has not stolen focus.

## Scenario: expanding the dictionary group and returning from the rail reveal the active item

1. Open Seniority levels directly.
   - *Expected*: its active sidebar link is fully visible.
2. Collapse Dictionaries manually, then expand it again.
   - *Expected*: manual collapse remains respected; expansion reveals the active item after
     the normal animation, and keyboard focus stays on the group button.
3. Toggle the sidebar to its icon rail and back.
   - *Expected*: the active item is revealed again, focus stays on the toggle button and the
     main document has not scrolled.

## Scenario: reopening an active dictionary group reveals its item without animation

1. Enable reduced motion and open Pulse rotating questions directly.
   - *Expected*: the active item is fully visible.
2. Collapse and reopen Dictionaries.
   - *Expected*: the active item becomes fully visible without depending on a transition event;
     focus stays on the group button and the main document stays at the top.
