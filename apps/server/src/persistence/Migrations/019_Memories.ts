import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_memories (
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
    )
  `;

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

  /* Composite covering index for the most common query pattern:
     list active memories for a project, ordered by recency. */
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_project_active
    ON projection_memories(project_id, archived_at, updated_at DESC)
  `;

  /* Index for daily-scoped memories filtered by date. */
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_memories_daily_date
    ON projection_memories(project_id, date DESC)
    WHERE scope = 'daily'
  `;
});
