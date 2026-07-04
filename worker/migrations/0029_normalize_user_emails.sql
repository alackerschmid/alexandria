-- Normalize existing emails to lowercase/trimmed form to match the app-layer normalization
-- added in auth.ts register/login. Before applying remotely, check for case-only duplicates:
-- SELECT lower(email), COUNT(*) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1
UPDATE users SET email = lower(trim(email));
