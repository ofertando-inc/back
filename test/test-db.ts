import { Client } from 'pg';

const TABLES_TO_TRUNCATE = ['reports', 'votes', 'offers', 'users'] as const;

export async function resetTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for e2e tests');
  }

  const client = new Client({
    connectionString: databaseUrl,
  });

  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.join(', ')} CASCADE`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
