import pg from "pg";
import { readFile } from "node:fs/promises";
export interface DB {
  query(
    sql: string,
    params?: any[],
  ): Promise<{ rows: any[]; rowCount?: number | null }>;
}
export interface Database extends DB {
  transaction<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function connect(): Promise<Database> {
  if (process.env.LOCAL_DB === "1" && process.env.NODE_ENV !== "production") {
    const { PGlite } = await import("@electric-sql/pglite");
    const p = new PGlite(process.env.LOCAL_DB_PATH);
    return {
      query: async (s, v) => {
        const r = await p.query(s, v);
        return { rows: r.rows, rowCount: r.affectedRows };
      },
      transaction: (fn) =>
        p.transaction((tx) =>
          fn({
            query: async (s, v) => {
              const r = await tx.query(s, v);
              return { rows: r.rows, rowCount: r.affectedRows };
            },
          }),
        ),
      close: () => p.close(),
    };
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
  return {
    query: (s, v) => pool.query(s, v),
    transaction: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(c);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function migrate(db: Database) {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async (tx) => {
    for (const statement of sql.split(";").filter((s) => s.trim()))
      await tx.query(statement);
  });
  const cats = [
    ["steam", "Steam", "#557fea"],
    ["telegram", "Telegram", "#41b9ec"],
    ["roblox", "Roblox", "#c1e55d"],
    ["pubg", "PUBG Mobile", "#ffbf56"],
    ["valorant", "Valorant", "#ff6574"],
    ["playstation", "PlayStation", "#7781ee"],
    ["minecraft", "Minecraft", "#67be75"],
    ["discord", "Discord", "#9290ff"],
    ["dota", "Dota 2", "#e57565"],
    ["other", "Другие товары", "#b8c5cd"],
  ];
  for (const [id, name, color] of cats)
    await db.query(
      "INSERT INTO categories(id,name,color) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [id, name, color],
    );
}
