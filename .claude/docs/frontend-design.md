# Frontend design system — v5

The v5 redesign uses the existing React/Mantine application and API. The approved Feedback
and Dashboard previews establish the visual direction; executable domain rules remain the
source of truth. Mock identities, counts, fields and simplified interactions are not requirements.

## Delivery stages and completion criteria

The foundation is implemented in `f9f4134d`. It establishes the theme, navigation and first
Dashboard/Feedback compositions. The completed scope is tracked by page family below.
Shared theme inheritance alone does not complete a family.
Each family requires composition review, preserved behavior, responsive browser inspection and
appropriate tests. Final visual approval precedes any merge to master.

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Tokens, navigation, shared states and v5.0.0 release identity | Implemented; foundation gates passed |
| 2 | Dashboard/Feedback refinement, all lists and relationship cards | Complete |
| 3 | Record reading, forms and editors | Complete |
| 4 | Registries and administrative tools, including read-only variants | Complete |
| 5 | Analysis/planning, account and system screens | Complete |
| 6 | Cross-family visual review, regression/E2E gates and final documentation | Complete; user visual approval required before merging |

Each stage preserves existing URLs, query parameters, view-setting keys, data contracts,
feature gates, authorization and business state transitions. A backend change requires a separate
scope decision; this release does not require API or schema changes.

### Complete page inventory

Every page module is assigned once; reused components are verified with their consuming pages.

- **Reference and people:** Dashboard, Feedback, FeedbackTable, ManagerFeedbacks, ViewFeedback,
  CreateFeedback, EditFeedback, AskFeedback, RequestFeedback, ManagersTable, TeamMembersTable,
  UserDetails.
- **Lists and hubs:** Alerts, Teams, Templates, Users, MyTeamsTable, GoalTable, MyGoals, UserGoals,
  OneOnOneTable, OneOnOnes, UserOneOnOnes, ImpactLogTable, ImpactLog, UserImpactLog,
  SuccessionPlanTable, SuccessionPlans, UserSuccessionPlans, TeamKpiTable, MyTeamKpis, TeamKpis,
  PerformanceReviewTable, UserPerformanceReviews, DaysOffTable.
- **Records and relationships:** ViewGoal, ViewOneOnOne, ViewImpactEntry, ViewPerformanceReview,
  ViewTeamKpi, ViewTemplate, ReviewSuccessionPlan, TeamDetails, UserCareer, UserTeams.
- **Forms:** CreateUser, EditUser, CreateTeam, EditTeam, ChangeUserPassword, UserFeatures,
  ImportUsers, CreateTemplate, EditTemplate, CreateAlert, EditAlert, CreateGoal, EditGoal,
  CreateTeamKpi, EditTeamKpi, CreateOneOnOne, EditOneOnOne, CreateImpactEntry, EditImpactEntry,
  CreatePerformanceReview, EditPerformanceReview, CreateSuccessionPlan, EditSuccessionNomination,
  CreateDaysOff.
- **Registries:** Dictionary, PublicHolidays, DaysOffPoolTypes, ReviewPeriods, IntegrationClients,
  FeatureFlags, PulseCycles.
- **Analysis and planning:** Career, CareerPyramid, Performance, ReviewsDashboard, DaysOff,
  UserDaysOff, OrgChart, Pulse, PulseResults, PulseTrend, PulseParticipation, PulseSurvey.
- **Account and system:** Login, ResetPassword, NotificationPreferences, Kudos, Changelog, NotFound.

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
| Resource list | Feedback, users, teams, goals, 1:1s, reviews, KPIs, impact log, succession, templates, alerts | PageHeader, scope tabs where applicable, ListSurface containing ListToolbar/FilterPanel, ResponsiveTable and PaginationBar |
| Record detail | Feedback, goals, reviews, KPIs, impact entries, templates, succession reviews | Bounded content, identity/status, MetaStrip, domain content, existing history/lifecycle tabs |
| Short form | User/team creation and editing, passwords | Container sm, FormSurface, grouped labelled fields, inline errors, FormFooter |
| Document editor or wizard | Feedback (including Ask/Request), alerts, 1:1 notes, reviews, impact wizard, nominations | Container md, FormSurface, identity context, existing editor/step logic, sticky FormFooter where appropriate |
| Registry/reference | Dictionaries, review periods, holidays, pool kinds, feature flags, integrations, pulse cycles | Shared framing with capability-specific controls; intentional read-only variants |
| Analysis/planning | Performance matrices, Pulse results/trends, career pyramid, days-off calendar, Org chart | Shared header/control language around the existing matrix, chart, grid or canvas |
| Feed/history and system | Kudos, Changelog, event timelines, login/reset, errors and notifications | Shared typography, surfaces, accessible states and domain-specific interactions |

`RecordLayout` puts metadata alongside prose documents (Feedback, goals, impact, templates).
Dense 1:1 action tables, review ratings, KPI graphs and succession workspaces keep their full
content width with metadata above and compact document padding so their desktop tables remain
above the normal layout breakpoint. Aside documents place context after content in both DOM
and phone reading order. `FormSurface` owns responsive padding (`compact` preserves the
import-results table width); `FormFooter` uses that padding for its sticky action band. Existing field order, save boundaries and editor logic
remain feature-owned. `ListSurface` owns the border around toolbar, table and pagination.

These are composition rules, not interchangeable generic screens. A dictionary retains its
compact numbered three-column table. Matrices retain aligned columns and local scroll regions;
the calendar and Org chart retain their own navigation models. Never hide overflowing actions
or broadly turn every table into cards.

## Interaction contract

- Primary New actions belong in PageHeader. RowActions shows a labelled primary action and
  retains contextual accessible names, topic menus and destructive confirmations. When a
  contextual name does not already contain the visible label, `actionAccessibleName` prefixes
  that label so visible text remains part of the accessible name.
- Primary text search stays visible; secondary filters expand below it. Card collections use
  `ListSurface cards` so their own borders do not sit inside an oversized outer frame.
  Search/filter/sort/pagination retain their current data and persistence behavior. Keep the
  distinct loading, failed, empty and filtered-empty states.
- Dashboard person cards lead with authorized collaboration/review facts. Returned career path
  and specialization remain visible near identity; seniority belongs to profile details.
  Secondary profile and leave
  details are expandable when collaboration is present; cards without collaboration and person
  detail pages keep the facts exposed. Menus stay outside the disclosure. Null private values
  must not become a misleading "Not set" or "never". Pending feedback and open, unsubmitted
  Pulse surveys receive actionable callouts. The authored-review metric is a count, not a
  completion fraction over current reports. Feedback/1:1 topic menus lead card actions; the
  remaining authorized links sit in a labelled More actions menu.
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

## Verification record — 2026-10-01

All 94 page modules are assigned in the inventory above. Each family has been reviewed against
the shared contract; existing canonical hubs, relationship timelines and specialized data views
were retained where appropriate. Implementation remains on `feat/v5-design-system` until user
approval of the final appearance. No backend, API, schema or dependency change is part of this
release. Existing view-setting keys are preserved.

- Production frontend build, ESLint and Knip passed. API regeneration produced no schema diff.
- Frontend coverage passed: 212 files / 1,898 tests; 94.89% lines, 92.14% statements,
  90.16% functions and 88.75% branches. The final heading-alignment adjustment also passed
  the focused settings, changelog, reviews and keyboard-order suites (47 tests).
- All 143 Playwright journeys have passing results against the production SPA preview backed
  by the development API/PostgreSQL stack. The final broad run passed 135; the two remaining
  test synchronization/navigation fixes were verified by rerunning all seven Goals/Days-off
  journeys. The dependency-blocked Alerts phase (one test) and Pulse phase (five tests) then
  passed sequentially. No assertions or accessibility rules were waived.
- E2E TypeScript and 56 spec/scenario pairs passed. Changed journeys update their companions
  and the E2E coverage map.
- Backend strict dependency verification, `check` and `:server:installDist` passed for the
  foundation; backend sources and dependency locks remained unchanged throughout completion.
- Independent reviews covered shared surfaces, cards, lists, registries, records, analysis,
  permissions, stored filters and navigation. Findings were resolved: compact desktop widths
  for import/1:1 tables, metadata keyboard order, Polish word wrapping, and the performance
  tutorial's Reports control location.

Browser acceptance includes 1440/1280/1024/390px geometry, English/Polish, light/dark, ordinary
members, managers, HR auditors and admins. The suites cover long names and multi-recipient
feedback, readable dictionaries without admin controls, reachable row/menu actions, return
journeys, dirty-form protection, local calendar/matrix scrolling and WCAG A/AA checks.
Manual captures also inspected Dashboard, Feedback, forms, career, days off, Org chart,
dictionaries and Changelog at desktop and phone widths. The failed-run 1:1 fixture was removed;
other owned test entities use their journey cleanup or documented development residue sweep.
