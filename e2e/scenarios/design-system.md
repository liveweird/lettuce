# V5 shared design and role variants

- **Spec**: [tests/design-system.spec.ts](../tests/design-system.spec.ts)
- **Actors**: Manager AAA, AAA One, HR auditor, administrator and one throwaway regular user.
- **Owns**: the throwaway user's account and language preference, deleted after the test. Seeded accounts are read-only; theme selection is browser-local.
- **Since**: 5.0.0

## Scenario: dashboard details and labelled actions remain reachable at every supported width

1. Manager AAA opens My subordinates at desktop, laptop, tablet and phone widths.
2. They use the keyboard to expand AAA One's profile and days-off details.
   - Expected: Last login becomes visible; collapsing the section hides secondary details again.
3. They open the labelled Feedbacks menu with details collapsed.
   - Expected: Provide feedback remains available and the page fits the screen at every width.

## Scenario: employees and HR keep readable reference tables without administrative controls

1. An employee and then the relationship-less HR auditor open Directory and Resources.
   - Expected: Users and Review periods remain reachable; Administration is absent.
2. Each visits all three career dictionaries at desktop and phone widths.
   - Expected: numbered values and language controls retain three aligned columns with visible headers; the page fits the screen.

## Scenario: Polish dark-mode forms and references remain accessible on a phone

1. An administrator creates a temporary regular user, who signs in and chooses Polish and the dark theme.
2. On a phone, they visit Career paths, New feedback and New days off without submitting the forms.
   - Expected: headings are visible, pages fit the screen and automated WCAG A/AA checks report no violations, including contrast.
3. The temporary account is removed, including when a check fails.
