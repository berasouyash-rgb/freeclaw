-- 015: poll_votes.created_at — enables velocity-based vote-fraud
-- detection (poll integrity worker). Default fills new rows; historical
-- rows keep NULL (unknown time — the worker treats them as unscoreable,
-- never as evidence).
ALTER TABLE poll_votes
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS poll_votes_created_idx ON poll_votes (created_at);
CREATE INDEX IF NOT EXISTS poll_votes_poll_created_idx ON poll_votes (poll_id, created_at);
