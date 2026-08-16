# Template CRUD and the feedback-editor Insert

- **Spec**: [tests/templates.spec.ts](../tests/templates.spec.ts)
- **Actors**: Administrator (template writes are ADMIN-only; also the feedback-editor visitor)
- **Owns** (exclusive server-side state): the templates registry — this file is its one writer
  per the parallel-execution rulebook; it uses a unique-named throwaway template, deleted at the
  end (a feedback draft for AAA One is opened only to exercise Insert and is discarded, never
  saved)

## Scenario: admin creates, edits, views, inserts, and deletes a template

1. The administrator signs in and creates a template on the "New template" screen: a unique name
   and a unique body, then "Create". Why unique: the shared database is long-lived, and
   `templates.name` is freed on soft-delete anyway, so repeated runs never collide.
2. On the templates list, they filter by the template's unique name.
   - *Expected*: the template's row is visible, with its content shown as a preview.
3. They open the template's edit screen, change the name (a "-renamed" suffix), and "Save".
4. They open the template's read-only view.
   - *Expected*: the renamed title and the content render (as plain text under a label).
5. They start providing feedback about AAA One, pick the renamed template in the editor's
   "Template" picker, and click "Insert".
   - *Expected*: the feedback content editor now contains the template's body — the one place
     templates are consumed.
6. They "Cancel" the editor and "Discard" the draft — nothing from this detour persists.
7. Back on the templates list, they filter by the renamed name and delete the template,
   confirming the "Delete" dialog.
8. They load the templates list fresh and filter by the renamed name again. Why a fresh load:
   the in-place list can lose a refetch race against a stale in-flight response (seen once in
   CI-style runs; the server row was correctly deleted).
   - *Expected*: "No templates" — the template is gone.
