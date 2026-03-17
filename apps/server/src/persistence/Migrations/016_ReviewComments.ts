import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS review_comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER,
      body TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT DEFAULT NULL,
      published_url TEXT DEFAULT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_review_comments_thread
    ON review_comments(thread_id)
  `;
});
