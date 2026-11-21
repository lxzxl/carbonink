-- Migration 012: doc_type as a property of document.
-- Set by the lazy classify-and-run pipeline on first review-page open.
-- NULL means "not yet classified" OR "LLM was unsure" (confidence < 0.7).
-- The renderer treats NULL identically in both cases: show "未分类" chip,
-- offer manual stage pick on review.

ALTER TABLE document ADD COLUMN doc_type TEXT;

-- Partial index for future filtering by stage in the documents list.
-- (No queries use this yet — Phase 2 may.)
CREATE INDEX idx_document_doc_type ON document(doc_type) WHERE doc_type IS NOT NULL;
