-- Migration 010: FTS5 index over emission_factor names + descriptions.
-- Used by EfMatcherService to rank candidate EFs by extraction-derived hints.
-- Tokenizer: unicode61 handles both English and CJK reasonably for short labels.

CREATE VIRTUAL TABLE ef_fts USING fts5(
  factor_code UNINDEXED,
  year UNINDEXED,
  source UNINDEXED,
  geography UNINDEXED,
  dataset_version UNINDEXED,
  name_zh,
  name_en,
  description_zh,
  description_en,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Backfill from existing rows.
INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                   name_zh, name_en, description_zh, description_en)
SELECT factor_code, year, source, geography, dataset_version,
       COALESCE(name_zh, ''), COALESCE(name_en, ''),
       COALESCE(description_zh, ''), COALESCE(description_en, '')
FROM emission_factor;

CREATE TRIGGER ef_fts_ai AFTER INSERT ON emission_factor BEGIN
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;

CREATE TRIGGER ef_fts_ad AFTER DELETE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
END;

CREATE TRIGGER ef_fts_au AFTER UPDATE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;
