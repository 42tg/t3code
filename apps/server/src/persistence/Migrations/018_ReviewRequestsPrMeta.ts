import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE review_requests ADD COLUMN pr_body TEXT DEFAULT NULL`;
  yield* sql`ALTER TABLE review_requests ADD COLUMN pr_labels TEXT NOT NULL DEFAULT '[]'`;
});
