-- ============================================================
-- Recover dev DB after switching from a fork branch back to main
-- ============================================================
--
-- WHEN TO USE THIS
-- ----------------
-- Run this if `bun run dev` fails with one of these errors:
--   * SQLiteError: no such column: default_model_selection_json
--   * ProviderSessionDirectoryPersistenceError: Unknown persisted
--     provider 'claudeCode'.
--
-- WHY THIS HAPPENS
-- ----------------
-- The Effect-SQL migrator tracks migrations by numeric ID only,
-- not by name. If your local dev DB was built up on a fork branch
-- whose migrations 14-18 differed from main, those IDs are marked
-- as "applied" and main's migrations 14-18 will never run.
--
-- Concretely, the fork timeline used IDs 14-18 for:
--   14 ProjectionThreadActivityParentAndItemId
--   15 ProjectionThreadsJiraTicket
--   16 ReviewComments
--   17 ReviewRequests
--   18 ReviewRequestsPrMeta
-- whereas main uses the same IDs for:
--   14 ProjectionThreadProposedPlanImplementation
--   15 ProjectionTurnsSourceProposedPlan
--   16 CanonicalizeModelSelections   <- adds default_model_selection_json
--   17 ProjectionThreadsArchivedAt
--   18 ProjectionThreadsArchivedAtIndex
--
-- HOW TO USE
-- ----------
--   1. Stop your dev server.
--   2. Make a backup:
--        cp ~/.t3/dev/state.sqlite ~/.t3/dev/state.sqlite.bak-$(date +%Y%m%d-%H%M%S)
--   3. Apply this script:
--        sqlite3 ~/.t3/dev/state.sqlite < scripts/recover-dev-db.sql
--   4. Start dev again:
--        bun run dev
--
-- This script does NOT touch effect_sql_migrations -- IDs 14-21 are
-- already recorded as applied, so the migrator will not try to re-run
-- anything. We only fill in the schema deltas main expects.
--
-- All operations are wrapped in a single transaction. Re-running the
-- script after a partial failure is not supported -- restore the backup
-- and try again.
-- ============================================================

BEGIN TRANSACTION;

-- ============================================================
-- STEP A: Rename legacy provider 'claudeCode' -> 'claudeAgent'
-- ============================================================
UPDATE provider_session_runtime  SET provider_name = 'claudeAgent' WHERE provider_name = 'claudeCode';
UPDATE provider_session_runtime  SET adapter_key   = 'claudeAgent' WHERE adapter_key   = 'claudeCode';
UPDATE projection_thread_sessions SET provider_name = 'claudeAgent' WHERE provider_name = 'claudeCode';
UPDATE orchestration_events
   SET payload_json = REPLACE(payload_json, '"claudeCode"', '"claudeAgent"')
 WHERE payload_json LIKE '%claudeCode%';

-- ============================================================
-- STEP B: Migration 14 (main) -- ProjectionThreadProposedPlanImplementation
-- ============================================================
ALTER TABLE projection_thread_proposed_plans ADD COLUMN implemented_at TEXT;
ALTER TABLE projection_thread_proposed_plans ADD COLUMN implementation_thread_id TEXT;

-- ============================================================
-- STEP C: Migration 15 -- ProjectionTurnsSourceProposedPlan
-- ============================================================
ALTER TABLE projection_turns ADD COLUMN source_proposed_plan_thread_id TEXT;
ALTER TABLE projection_turns ADD COLUMN source_proposed_plan_id TEXT;

-- ============================================================
-- STEP D: Migration 16 -- CanonicalizeModelSelections
-- ============================================================
ALTER TABLE projection_projects ADD COLUMN default_model_selection_json TEXT;

UPDATE projection_projects
   SET default_model_selection_json = CASE
       WHEN default_model IS NULL THEN NULL
       ELSE json_object(
         'provider',
         CASE WHEN lower(default_model) LIKE '%claude%' THEN 'claudeAgent' ELSE 'codex' END,
         'model',
         default_model
       )
     END
 WHERE default_model_selection_json IS NULL;

ALTER TABLE projection_threads ADD COLUMN model_selection_json TEXT;

UPDATE projection_threads
   SET model_selection_json = json_object(
         'provider',
         COALESCE(
           (SELECT provider_name FROM projection_thread_sessions
              WHERE projection_thread_sessions.thread_id = projection_threads.thread_id),
           CASE WHEN lower(model) LIKE '%claude%' THEN 'claudeAgent' ELSE 'codex' END,
           'codex'
         ),
         'model',
         model
       )
 WHERE model_selection_json IS NULL;

ALTER TABLE projection_projects DROP COLUMN default_model;
ALTER TABLE projection_threads  DROP COLUMN model;

-- Event payload transforms (project.created / project.meta-updated)
UPDATE orchestration_events
   SET payload_json = CASE
       WHEN json_type(payload_json, '$.defaultModel') = 'null' THEN json_remove(
         json_set(payload_json, '$.defaultModelSelection', json('null')),
         '$.defaultProvider', '$.defaultModel', '$.defaultModelOptions'
       )
       ELSE json_remove(
         json_set(payload_json, '$.defaultModelSelection',
           json_patch(
             json_object(
               'provider',
               CASE
                 WHEN json_extract(payload_json, '$.defaultProvider') IS NOT NULL
                   THEN json_extract(payload_json, '$.defaultProvider')
                 WHEN lower(json_extract(payload_json, '$.defaultModel')) LIKE '%claude%'
                   THEN 'claudeAgent'
                 ELSE 'codex'
               END,
               'model',
               json_extract(payload_json, '$.defaultModel')
             ),
             CASE
               WHEN json_type(payload_json, '$.defaultModelOptions') IS NULL THEN '{}'
               WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                 OR json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
               THEN CASE
                 WHEN (
                   CASE
                     WHEN json_extract(payload_json, '$.defaultProvider') IS NOT NULL
                       THEN json_extract(payload_json, '$.defaultProvider')
                     WHEN lower(json_extract(payload_json, '$.defaultModel')) LIKE '%claude%'
                       THEN 'claudeAgent'
                     ELSE 'codex'
                   END
                 ) = 'claudeAgent'
                 THEN CASE
                   WHEN json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
                     THEN json_object('options', json(json_extract(payload_json, '$.defaultModelOptions.claudeAgent')))
                   WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                     THEN json_object('options', json(json_extract(payload_json, '$.defaultModelOptions.codex')))
                   ELSE '{}'
                 END
                 ELSE CASE
                   WHEN json_type(payload_json, '$.defaultModelOptions.codex') IS NOT NULL
                     THEN json_object('options', json(json_extract(payload_json, '$.defaultModelOptions.codex')))
                   WHEN json_type(payload_json, '$.defaultModelOptions.claudeAgent') IS NOT NULL
                     THEN json_object('options', json(json_extract(payload_json, '$.defaultModelOptions.claudeAgent')))
                   ELSE '{}'
                 END
               END
               ELSE json_object('options', json(json_extract(payload_json, '$.defaultModelOptions')))
             END
           )
         ),
         '$.defaultProvider', '$.defaultModel', '$.defaultModelOptions'
       )
     END
 WHERE event_type IN ('project.created', 'project.meta-updated')
   AND json_type(payload_json, '$.defaultModelSelection') IS NULL
   AND json_type(payload_json, '$.defaultModel') IS NOT NULL;

-- Event payload transforms (thread.created / thread.meta-updated / thread.turn-start-requested)
UPDATE orchestration_events
   SET payload_json = json_remove(
       json_set(payload_json, '$.modelSelection',
         json_patch(
           json_object(
             'provider',
             CASE
               WHEN json_extract(payload_json, '$.provider') IS NOT NULL
                 THEN json_extract(payload_json, '$.provider')
               WHEN lower(json_extract(payload_json, '$.model')) LIKE '%claude%'
                 THEN 'claudeAgent'
               ELSE 'codex'
             END,
             'model',
             json_extract(payload_json, '$.model')
           ),
           CASE
             WHEN json_type(payload_json, '$.modelOptions') IS NULL THEN '{}'
             WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
               OR json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
             THEN CASE
               WHEN (
                 CASE
                   WHEN json_extract(payload_json, '$.provider') IS NOT NULL
                     THEN json_extract(payload_json, '$.provider')
                   WHEN lower(json_extract(payload_json, '$.model')) LIKE '%claude%'
                     THEN 'claudeAgent'
                   ELSE 'codex'
                 END
               ) = 'claudeAgent'
               THEN CASE
                 WHEN json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
                   THEN json_object('options', json(json_extract(payload_json, '$.modelOptions.claudeAgent')))
                 WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
                   THEN json_object('options', json(json_extract(payload_json, '$.modelOptions.codex')))
                 ELSE '{}'
               END
               ELSE CASE
                 WHEN json_type(payload_json, '$.modelOptions.codex') IS NOT NULL
                   THEN json_object('options', json(json_extract(payload_json, '$.modelOptions.codex')))
                 WHEN json_type(payload_json, '$.modelOptions.claudeAgent') IS NOT NULL
                   THEN json_object('options', json(json_extract(payload_json, '$.modelOptions.claudeAgent')))
                 ELSE '{}'
               END
             END
             ELSE json_object('options', json(json_extract(payload_json, '$.modelOptions')))
           END
         )
       ),
       '$.provider', '$.model', '$.modelOptions'
     )
 WHERE event_type IN ('thread.created', 'thread.meta-updated', 'thread.turn-start-requested')
   AND json_type(payload_json, '$.modelSelection') IS NULL
   AND json_type(payload_json, '$.model') IS NOT NULL;

-- Backfill thread.created events that predate the model field entirely
UPDATE orchestration_events
   SET payload_json = json_set(payload_json, '$.modelSelection',
       json(json_object('provider', 'codex', 'model', 'gpt-5.4'))
     )
 WHERE event_type = 'thread.created'
   AND json_type(payload_json, '$.modelSelection') IS NULL
   AND json_type(payload_json, '$.model') IS NULL;

-- ============================================================
-- STEP E: Migration 17 -- ProjectionThreadsArchivedAt
-- ============================================================
ALTER TABLE projection_threads ADD COLUMN archived_at TEXT;

-- ============================================================
-- STEP F: Migration 18 -- ProjectionThreadsArchivedAtIndex
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projection_threads_project_archived_at
  ON projection_threads(project_id, archived_at);

COMMIT;
