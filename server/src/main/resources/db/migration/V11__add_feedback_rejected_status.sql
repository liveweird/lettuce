ALTER TABLE feedbacks DROP CONSTRAINT feedbacks_status_check;
ALTER TABLE feedbacks ADD CONSTRAINT feedbacks_status_check CHECK (status IN (
    'REQUESTED', 'DRAFT', 'SENT', 'WITHDRAWN', 'REJECTED'
));
