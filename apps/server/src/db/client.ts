import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

// NUMERIC (OID 1700) → number. Nilai IDR & qty resep jauh di bawah batas
// presisi double; prototipe juga memakai float murni.
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
