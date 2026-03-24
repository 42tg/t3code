import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_requests (
      id TEXT PRIMARY KEY,
      pr_url TEXT NOT NULL UNIQUE,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL,
      repo_name_with_owner TEXT NOT NULL,
      author_login TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      thread_id TEXT DEFAULT NULL,
      pr_body TEXT DEFAULT NULL,
      pr_labels TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_requests_status
    ON review_requests(status)
  `;
});
