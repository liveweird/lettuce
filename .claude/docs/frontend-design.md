# Frontend design system — v5

The v5 redesign uses the existing React/Mantine application and API. The approved Feedback
and Dashboard previews establish the visual direction; executable domain rules remain the
source of truth. Mock identities, counts, fields and simplified interactions are not requirements.

## Delivery stages

1. Define the shared visual contract, navigation groups and page families.
2. Implement theme and generic page/list/form primitives with compatible props.
3. Integrate navigation, Dashboard/people cards and Feedback as reference implementations.
4. Inspect specialized screens and correct concrete integration problems.
5. Independently review and run frontend, backend/package and browser quality gates.
6. Synchronize guidance, E2E scenarios and bilingual v5.0.0 release notes.

Each stage preserves existing URLs, query parameters, view-setting keys, data contracts,
feature gates, authorization and business state transitions. A backend change requires a separate
scope decision; this release does not require API or schema changes.

## Visual contract

Tokens live in `web/src/themeVariables.ts`, component defaults in `theme.ts`, and shared
styles in `theme.module.css`. Inter stays bundled locally. Light mode uses white content,
mineral navigation, ink text, muted secondary text, leaf-green interactions and quiet borders.
Dark mode applies the same hierarchy through its own contrast-tested tokens. Teal remains
semantic success. Do not hardcode page-specific colors or copy the prototype's small font sizes.

Page headings are 28px on desktop and 24px on phones. Ordinary controls and body text remain
readable; secondary metadata is subordinate rather than faint. Use borders and spacing to group
content, with restrained rounding and no resting card elevation. Menus and dialogs may use
shadows. Keep semantic heading levels, keyboard focus and reduced-motion support.

## Information architecture

| Section | Destinations |
| --- | --- |
| Overview | Dashboard, Kudos |
| My work | Feedback, 1:1 meetings, Goals, Impact log, Career, Days off |
| Team | Team KPIs, Performance, Pulse, Succession plans |
| People / Directory | Users, Teams, Org chart |
| Reference / Resources | Feedback templates, Review periods, Public holidays, Paid-leave pools |
| Reference / Dictionaries | Career paths, Career specializations, Seniority levels, Pulse questions |
| Administration / Settings | Pulse cycles, Feature flags, Integration clients, Alerts |

`appShell/navModel.ts` owns structure and gates. Shared resources stay readable by ordinary
users. Administration appears only when an authorized destination survives filtering. HR audit
reads do not imply administrative write rights. Existing relationship and feature gates apply
independently of section labels. The collapsed rail and mobile navigation expose the same
destinations. Tours follow this structure and the same gates; the historic `nav-config` anchor
now targets Resources.

## Page families

| Pattern | Screens | Shared composition |
| --- | --- | --- |
| Overview and relationships | Dashboard, person/team drill-downs | PageHeader, existing-data summary, scope tabs, person cards |
| Resource list | Feedback, users, teams, goals, 1:1s, reviews, KPIs, impact log, succession, templates, alerts | PageHeader, scope tabs where applicable, ListToolbar/FilterPanel, ResponsiveTable, PaginationBar |
| Record detail | Feedback, goals, reviews, KPIs, impact entries, templates, succession reviews | Bounded content, identity/status, MetaStrip, domain content, existing history/lifecycle tabs |
| Short form | User/team creation and editing, passwords | Container sm, grouped labelled fields, inline errors, FormFooter |
| Document editor or wizard | Feedback (including Ask/Request), alerts, 1:1 notes, reviews, impact wizard, nominations | Container md, identity context, existing editor/step logic, sticky FormFooter where appropriate |
| Registry/reference | Dictionaries, review periods, holidays, pool kinds, feature flags, integrations, pulse cycles | Shared framing with capability-specific controls; intentional read-only variants |
| Analysis/planning | Performance matrices, Pulse results/trends, career pyramid, days-off calendar, Org chart | Shared header/control language around the existing matrix, chart, grid or canvas |
| Feed/history and system | Kudos, Changelog, event timelines, login/reset, errors and notifications | Shared typography, surfaces, accessible states and domain-specific interactions |

These are composition rules, not interchangeable generic screens. A dictionary retains its
compact numbered three-column table. Matrices retain aligned columns and local scroll regions;
the calendar and Org chart retain their own navigation models. Never hide overflowing actions
or broadly turn every table into cards.

## Interaction contract

- Primary New actions belong in PageHeader. RowActions shows a labelled primary action and
  retains contextual accessible names, topic menus and destructive confirmations. When a
  contextual name does not already contain the visible label, `actionAccessibleName` prefixes
  that label so visible text remains part of the accessible name.
- Search/filter/sort/pagination retain their current data and persistence behavior. Keep the
  distinct loading, failed, empty and filtered-empty states.
- Dashboard person cards lead with authorized collaboration/review facts. Profile and leave
  details are expandable when collaboration is present; cards without collaboration and person
  detail pages keep the facts exposed. Menus stay outside the disclosure. Null private values
  must not become a misleading "Not set" or "never".
- Back, Close, Cancel and post-save navigation use the existing sanitized link builders and
  discard guard. Save and Cancel may legitimately target different pages.
- Retain Feedback's received/provided/team/audit scopes, immutable recipient set, request
  triage, requester content redaction, history and lifecycle. Visual grouping cannot relax gates.
- All application copy is translated in English and Polish. Disabled features remove their
  navigation, actions and tutorial stops consistently. HR remains an auditor under existing rules.

## Acceptance

Use real browser geometry as well as unit tests: 1440, 1280, 1024 and 390px, representative
English/Polish and light/dark states, regular users, managers, relationship-less HR and admins.
Check absent editing controls, long names/content, reachable actions, keyboard navigation,
disclosures, local scrolling and nested return journeys. Do not waive axe contrast failures.
Every changed E2E journey updates its scenario and coverage-map entry. Follow the full gate
sequence in `testing.md`; never run backend database tests and E2E concurrently.
