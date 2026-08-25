-- Succession plans (v2.42.0): a manager's private planning records for critical roles/seats.
-- Each plan names ONE person (user_id, someone in the owning manager's transitive chain at
-- creation) whose succession is being planned, with a role criticality, a retention risk, an
-- ordered list of short loss-impact texts (a JSON array stored as ONE application-encrypted
-- value — enc:v1:… envelope, never filtered/sorted in SQL, see infra/crypto/FieldCipher.kt),
-- and a target bench depth (the minimum nominated successors). The owner (manager_id) is the
-- only writer; managers in the OWNER's transitive chain and HR read — the planned-for person
-- and the nominated candidates never see anything. OPEN -> CLOSED is the whole lifecycle
-- (CLOSED is terminal and read-only; delete stays available). Rows soft-delete per the house
-- convention.
CREATE TABLE succession_plans (
    id                 BIGSERIAL   PRIMARY KEY,
    manager_id         BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- the owner/author
    user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- the seat's person
    role_criticality   VARCHAR(20) NOT NULL CHECK (role_criticality IN ('CRITICAL', 'CORE', 'STANDARD')),
    retention_risk     VARCHAR(20) NOT NULL CHECK (retention_risk IN ('HIGH', 'MEDIUM', 'LOW')),
    loss_impact        TEXT        NOT NULL,  -- encrypted at rest (a JSON array of short texts)
    target_bench_depth INT         NOT NULL,  -- minimum nominated successors (app-validated 1..10)
    status             VARCHAR(20) NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
    created_at         BIGINT      NOT NULL,  -- epoch millis, immutable
    last_reviewed_at   BIGINT      NOT NULL,  -- bumped by every plan/nomination mutation
    marked_as_deleted  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_succession_plans_manager_id ON succession_plans(manager_id);
CREATE INDEX idx_succession_plans_user_id ON succession_plans(user_id);
CREATE INDEX idx_succession_plans_marked_as_deleted ON succession_plans(marked_as_deleted);
-- One OPEN plan per (owner, person) — other managers may keep their own; closed/deleted plans
-- never block a new one. The route pre-checks for a friendly 409 detail; this index is the
-- concurrent-write backstop (23505 -> 409).
CREATE UNIQUE INDEX uq_succession_plans_owner_user_open
    ON succession_plans(manager_id, user_id)
    WHERE marked_as_deleted = FALSE AND status = 'OPEN';

-- Successor nominations: a plan's bench. Each names an active user (any user except the seat's
-- person — cross-team/lateral candidates are expected, hence no chain requirement) with a
-- readiness window, a nomination type, an ordered list of short competency-gap texts (the same
-- encrypted-JSON-array shape as loss_impact), and a candidate-awareness level (metadata only —
-- the candidate is never notified or granted any read whatever the value). Mutations are
-- owner-only via the parent plan and allowed only while it is OPEN; every one bumps the plan's
-- last_reviewed_at. Rows soft-delete; the CASCADE never fires (the parent soft-deletes).
CREATE TABLE succession_nominations (
    id                BIGSERIAL   PRIMARY KEY,
    plan_id           BIGINT      NOT NULL REFERENCES succession_plans(id) ON DELETE CASCADE,
    candidate_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    readiness         VARCHAR(30) NOT NULL CHECK (readiness IN ('READY_NOW', 'READY_SOON', 'FUTURE_PIPELINE', 'EMERGENCY_INTERIM')),
    nomination_type   VARCHAR(20) NOT NULL CHECK (nomination_type IN ('PRIMARY', 'SECONDARY', 'CROSS_TEAM')),
    competency_gaps   TEXT        NOT NULL,  -- encrypted at rest (a JSON array of short texts)
    awareness         VARCHAR(20) NOT NULL CHECK (awareness IN ('TRANSPARENT', 'IMPLICIT', 'CONFIDENTIAL')),
    created_at        BIGINT      NOT NULL,  -- epoch millis, immutable
    last_modified     BIGINT      NOT NULL,
    marked_as_deleted BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_succession_nominations_plan_id ON succession_nominations(plan_id);
CREATE INDEX idx_succession_nominations_marked_as_deleted ON succession_nominations(marked_as_deleted);
-- One nomination per candidate per plan (partial over active rows, like the plan index above).
CREATE UNIQUE INDEX uq_succession_nominations_plan_candidate
    ON succession_nominations(plan_id, candidate_id)
    WHERE marked_as_deleted = FALSE;

-- Development action items: links from a nomination to EXISTING personal goals of the candidate
-- (goals.subordinate_id = the nomination's candidate_id, enforced by the application together
-- with the linking manager's goal-read right). A plain join table of the hard-delete class
-- (team_members/goal_milestones): rows are wholesale-replaced on every nomination PUT, position
-- = payload order. Goals themselves are untouched — a linked goal renders to its subordinate
-- exactly as before, with no hint of the succession context.
CREATE TABLE succession_nomination_goals (
    nomination_id BIGINT NOT NULL REFERENCES succession_nominations(id) ON DELETE CASCADE,
    goal_id       BIGINT NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
    position      INT    NOT NULL,
    PRIMARY KEY (nomination_id, goal_id)
);

CREATE INDEX idx_succession_nomination_goals_goal_id ON succession_nomination_goals(goal_id);
