import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { env } from "@/lib/env";

let pool: Pool | null = null;

export function getPool() {
  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL is required. Run `wrkr db --json` and set DATABASE_URL.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: 10
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
  return getPool().query<T>(sql, values);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function hasDatabase() {
  if (!env.databaseUrl) {
    return false;
  }

  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}
