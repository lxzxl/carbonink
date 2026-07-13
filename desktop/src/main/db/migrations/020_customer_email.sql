-- 020: optional contact email on counterparty rows (customer table).
-- Consumed by the inbound supplier-disclosure reminder action
-- (spec 2026-07-13-inbound-overdue-reminders): the 催办 mailto needs an
-- address; NULL = not captured yet. Applies to both roles, but only the
-- supplier-side UI writes it for now.
ALTER TABLE customer ADD COLUMN email TEXT;
