-- 1:1 meetings: the pair-latest index (v4.15.0, perf finding F12). Every "latest meeting of a
-- (manager, subordinate) pair" question — the write rules' latestMeetingOfPair, the carry-over
-- source, the roster stats' DISTINCT ON (v4.14.0) and the list's latestOnly filter — seeks the pair
-- and reads newest-first by (meeting_date DESC, id DESC); marked_as_deleted rides along as an INCLUDE
-- column so those scans are index-only. Deliberately NOT a partial index: the soft-delete flag is a
-- bind parameter in every statement, and a generic plan cannot prove a partial-index predicate from a
-- parameter. The V23 single-column indexes stay (other predicates still use them).
CREATE INDEX idx_one_on_one_meetings_pair_latest
    ON one_on_one_meetings (manager_id, subordinate_id, meeting_date DESC, id DESC)
    INCLUDE (marked_as_deleted);
