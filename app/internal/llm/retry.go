package llm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// maxAttempts mirrors 1.x: the original call plus two retries for transient
// provider failures.
const maxAttempts = 3

// HTTPError is a non-200 provider reply. Only 429 and 5xx are retried.
type HTTPError struct {
	StatusCode int
	Status     string
	Body       string
	RetryAfter time.Duration
}

func (e *HTTPError) Error() string {
	if e.Body == "" {
		return "llm: " + e.Status
	}
	return fmt.Sprintf("llm: %s: %s", e.Status, e.Body)
}

func (e *HTTPError) retryable() bool {
	return e.StatusCode == http.StatusTooManyRequests || e.StatusCode >= 500
}

// httpError drains a bounded amount of the reply and closes it, so the
// connection can be reused between attempts.
func httpError(resp *http.Response) error {
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
	out := &HTTPError{
		StatusCode: resp.StatusCode,
		Status:     resp.Status,
		Body:       strings.TrimSpace(string(body)),
	}
	if seconds, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil &&
		seconds > 0 {
		out.RetryAfter = time.Duration(seconds) * time.Second
	}
	return out
}

// withRetry runs attempt until it succeeds, fails with a non-retryable error,
// or exhausts the attempts. The wait is exponential (500 ms, 1 s) unless the
// provider sent Retry-After, and never longer than 5 s.
func withRetry(ctx context.Context, attempt func() error) error {
	var err error
	for i := 0; i < maxAttempts; i++ {
		if err = attempt(); err == nil {
			return nil
		}
		var httpErr *HTTPError
		if !errors.As(err, &httpErr) || !httpErr.retryable() || i == maxAttempts-1 {
			return err
		}
		delay := 500 * time.Millisecond << i
		if httpErr.RetryAfter > 0 {
			delay = httpErr.RetryAfter
		}
		if delay > 5*time.Second {
			delay = 5 * time.Second
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
	return err
}
