import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "./client";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

await migrate(db, { migrationsFolder: dir });
console.log("Migrasi selesai.");
await pool.end();
