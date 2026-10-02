-- Mass share (v4.10.0): every row created by one POST /api/v1/shares/batch carries the batch's UUID;
-- single shares stay NULL. The per-(sharer, sharee) daily notification cap counts a batch as ONE
-- notice (COUNT(DISTINCT COALESCE(batch_id, id::text))) — one summary notification is minted per
-- batch — and the audit event share.batch_created names the id. No index: the cap query is already
-- served by idx_document_shares_sharer.
ALTER TABLE document_shares ADD COLUMN batch_id VARCHAR(36) NULL;
