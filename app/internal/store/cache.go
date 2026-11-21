package store

import "context"

// CacheStats is what Settings → Data shows before offering a cleanup.
// ExtractionRawBytes and ExtractionRawCount cover confirmed extractions that
// still hold their raw LLM response; DBFileBytes is the database's logical
// size, page_count × page_size, so it may exceed the file on disk while a WAL
// holds recent writes.
type CacheStats struct {
	ExtractionRawBytes int64
	ExtractionRawCount int64
	DBFileBytes        int64
}

// CacheStats reads the cache sizes. It is a cheap query; VACUUM is not.
func (s *Store) CacheStats(ctx context.Context) (CacheStats, error) {
	var st CacheStats
	if err := s.db.QueryRowContext(ctx, `
		SELECT coalesce(sum(length(raw_response)), 0), count(*)
		FROM extraction
		WHERE status = 'parsed' AND raw_response IS NOT NULL AND length(raw_response) > 0`,
	).Scan(&st.ExtractionRawBytes, &st.ExtractionRawCount); err != nil {
		return CacheStats{}, err
	}
	size, err := s.pageBytes(ctx)
	if err != nil {
		return CacheStats{}, err
	}
	st.DBFileBytes = size
	return st, nil
}

// ClearExtractionRawCache drops the raw LLM responses kept on parsed
// extractions and VACUUMs the file so the space returns to disk. The parsed
// fields, activities, reports and audit rows are untouched.
func (s *Store) ClearExtractionRawCache(ctx context.Context) (rows, freed int64, err error) {
	before, err := s.pageBytes(ctx)
	if err != nil {
		return 0, 0, err
	}
	res, err := s.db.ExecContext(ctx, `
		UPDATE extraction SET raw_response = NULL
		WHERE status = 'parsed' AND raw_response IS NOT NULL AND length(raw_response) > 0`)
	if err != nil {
		return 0, 0, err
	}
	rows, err = res.RowsAffected()
	if err != nil {
		return 0, 0, err
	}
	if rows == 0 {
		return 0, 0, nil
	}
	// VACUUM cannot run inside a transaction; ExecContext is a single
	// autocommitted statement, so it is safe here.
	if _, err := s.db.ExecContext(ctx, `VACUUM`); err != nil {
		return rows, 0, err
	}
	after, err := s.pageBytes(ctx)
	if err != nil {
		return rows, 0, err
	}
	if after < before {
		freed = before - after
	}
	return rows, freed, nil
}

func (s *Store) pageBytes(ctx context.Context) (int64, error) {
	var pages, size int64
	if err := s.db.QueryRowContext(ctx, `PRAGMA page_count`).Scan(&pages); err != nil {
		return 0, err
	}
	if err := s.db.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&size); err != nil {
		return 0, err
	}
	return pages * size, nil
}
