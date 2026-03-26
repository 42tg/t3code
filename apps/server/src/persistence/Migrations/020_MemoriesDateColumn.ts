import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Add the date column for daily-scoped memories
  yield* sql`ALTER TABLE projection_memories ADD COLUMN date TEXT`;

  // SQLite doesn't support ALTER CHECK constraints, so we need to drop and
  // recreate. Since CHECK constraints in SQLite are only enforced on INSERT/UPDATE
  // (not retroactively), and the old constraint would block 'daily' scope inserts,
  // we recreate the table with the updated constraint.
  // However, SQLite also doesn't support DROP CONSTRAINT.
  // The simplest approach: the CHECK constraint was defined as part of CREATE TABLE
  // and can't be altered. But SQLite does NOT enforce CHECK constraints from
  // schema — it only enforces them if they were defined. Since the original
  // migration used CHECK (scope IN ('project', 'global')), we need to work around it.
  // Fortunately, we can just disable the check temporarily by renaming + recreating.

  // Actually, SQLite DOES enforce CHECK constraints. Let's recreate the table.
  yield* sql`CREATE TABLE IF NOT EXISTS projection_memories_new (
    memory_id TEXT PRIMARY KEY,
    project_id TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('project', 'global', 'daily')),
    category TEXT NOT NULL CHECK (category IN ('preference', 'pattern', 'decision', 'fact', 'convention')),
    source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    content TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    source_thread_id TEXT,
    source_turn_id TEXT,
    relevance_score REAL NOT NULL DEFAULT 1.0,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    archived_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projection_projects(project_id)
  )`;

  yield* sql`INSERT INTO projection_memories_new SELECT
    memory_id, project_id, scope, category, source, content, title,
    NULL as date,
    source_thread_id, source_turn_id, relevance_score, access_count,
    last_accessed_at, created_at, updated_at, archived_at
    FROM projection_memories`;

  yield* sql`DROP TABLE projection_memories`;
  yield* sql`ALTER TABLE projection_memories_new RENAME TO projection_memories`;

  // Recreate indexes
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_project
    ON projection_memories(project_id) WHERE project_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_scope
    ON projection_memories(scope)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_archived
    ON projection_memories(archived_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_project_active
    ON projection_memories(project_id, archived_at, updated_at DESC)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_daily_date
    ON projection_memories(project_id, date DESC)
    WHERE scope = 'daily'
  `;

  // Recreate FTS5 virtual table and triggers
  yield* sql`DROP TABLE IF EXISTS projection_memories_fts`;
  yield* sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS projection_memories_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      category,
      content=projection_memories,
      content_rowid=rowid
    )
  `;

  // Re-populate FTS
  yield* sql`INSERT INTO projection_memories_fts(rowid, memory_id, title, content, category)
    SELECT rowid, memory_id, title, content, category FROM projection_memories`;

  // Recreate triggers
  yield* sql`DROP TRIGGER IF EXISTS memories_ai`;
  yield* sql`DROP TRIGGER IF EXISTS memories_ad`;
  yield* sql`DROP TRIGGER IF EXISTS memories_au`;

  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(rowid, memory_id, title, content, category)
      VALUES (new.rowid, new.memory_id, new.title, new.content, new.category);
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(projection_memories_fts, rowid, memory_id, title, content, category)
      VALUES ('delete', old.rowid, old.memory_id, old.title, old.content, old.category);
    END
  `;
  yield* sql`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON projection_memories BEGIN
      INSERT INTO projection_memories_fts(projection_memories_fts, rowid, memory_id, title, content, category)
      VALUES ('delete', old.rowid, old.memory_id, old.title, old.content, old.category);
      INSERT INTO projection_memories_fts(rowid, memory_id, title, content, category)
      VALUES (new.rowid, new.memory_id, new.title, new.content, new.category);
    END
  `;
});
