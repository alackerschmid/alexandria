CREATE UNIQUE INDEX IF NOT EXISTS idx_scans_user_isbn ON scans(user_id, isbn);
