'use strict';
async function withTransaction(db, operation) {
  db.assertScope();
  const client = await db.pool.connect();
  let destroy = false;
  client.rollbackTasks = [];
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
    for (const cleanup of client.rollbackTasks) {
      try {
        await cleanup();
      } catch {
        console.error(
          'FILE_ORPHAN_PENDING: rollback cleanup requires operator review',
        );
      }
    }
    throw error;
  } finally {
    delete client.rollbackTasks;
    client.release(destroy);
  }
}
module.exports = { withTransaction };
