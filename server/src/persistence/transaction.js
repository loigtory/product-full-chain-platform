'use strict';
async function withTransaction(db, operation) {
  db.assertScope();
  const client = await db.pool.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    // No public/implicit temporary relation lookup; all runtime repository queries also qualify their schema.
    await client.query(
      `SET LOCAL search_path TO "${db.schema}", pg_catalog, pg_temp`,
    );
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      destroy = true;
    }
    throw error;
  } finally {
    client.release(destroy);
  }
}
module.exports = { withTransaction };
