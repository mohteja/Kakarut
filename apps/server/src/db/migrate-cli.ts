import { pool } from "./client";
import { runMigrations } from "./migrate";

await runMigrations();
console.log("Migrasi selesai.");
await pool.end();
