-- Generic fixed-window rate limiter (see rate-limit.ts). `key` is caller-defined (e.g.
-- `scan:<userId>`) so this table can back multiple rate-limited routes without a schema change.
CREATE TABLE rate_limits (
  key          TEXT NOT NULL,
  window_start INTEGER NOT NULL, -- ms-epoch bucket start: floor(now_ms / window_ms) * window_ms
  window_ms    INTEGER NOT NULL, -- window length in ms; lets pruning tell when a row's window has
                                 -- fully elapsed regardless of which caller/window size wrote it
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
