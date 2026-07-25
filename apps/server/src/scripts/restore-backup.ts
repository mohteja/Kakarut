/**
 * PEMULIHAN (RESTORE) cadangan database dari berkas `.jsonl.gz` yang dibuat oleh
 * `lib/backup.ts`. Membaca arsip, lalu MENGHAPUS ISI (TRUNCATE) tabel yang ada di
 * arsip dan memasukkan kembali barisnya.
 *
 *   ⚠️  OPERASI DESTRUKTIF — menimpa data di DATABASE_URL saat ini.
 *
 * Pakai:
 *   tsx src/scripts/restore-backup.ts <berkas.jsonl.gz> --yes
 *   (atau dari root: npm run db:restore -w @kakarut/server -- <berkas> --yes)
 *
 * Tanpa `--yes` hanya menampilkan ringkasan isi arsip (mode telaah, tak menulis).
 *
 * Cara: FK dinonaktifkan sementara (`session_replication_role = replica`) agar
 * urutan tabel tak jadi soal, TRUNCATE + INSERT dalam satu transaksi, lalu
 * dikembalikan. Peran DB harus pemilik tabel (umumnya peran aplikasi).
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import pg from "pg";
import { env } from "../config/env";

interface BarisTabel {
  tabel: string;
  baris: Record<string, unknown>[];
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function main() {
  const args = process.argv.slice(2);
  const berkas = args.find((a) => !a.startsWith("--"));
  const konfirmasi = args.includes("--yes");
  if (!berkas) {
    console.error("Pakai: tsx src/scripts/restore-backup.ts <berkas.jsonl.gz> [--yes]");
    process.exit(1);
  }

  const isi = gunzipSync(readFileSync(berkas)).toString("utf8");
  const lines = isi.split("\n").filter((l) => l.trim());
  const meta = JSON.parse(lines[0]) as { meta?: { dibuat?: string; jumlah_tabel?: number } };
  const tabel: BarisTabel[] = [];
  for (const l of lines.slice(1)) {
    const obj = JSON.parse(l) as BarisTabel;
    if (obj.tabel) tabel.push(obj);
  }

  console.log(`Arsip: ${berkas}`);
  console.log(`Dibuat: ${meta.meta?.dibuat ?? "?"}`);
  console.log(`Tabel: ${tabel.length}`);
  let total = 0;
  for (const t of tabel) {
    total += t.baris.length;
    console.log(`  - ${t.tabel}: ${t.baris.length} baris`);
  }
  console.log(`Total baris: ${total}`);

  if (!konfirmasi) {
    console.log("\nMode telaah (tanpa menulis). Tambahkan --yes untuk MEMULIHKAN (menimpa DB).");
    return;
  }

  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  const client = await pool.connect();
  try {
    console.log(`\nMemulihkan ke ${env.DATABASE_URL ?? "(DATABASE_URL default)"} …`);
    await client.query("BEGIN");
    // Nonaktifkan trigger FK selama restore agar urutan tabel bebas.
    await client.query("SET session_replication_role = replica");
    for (const t of tabel) {
      await client.query(`TRUNCATE TABLE ${quoteIdent(t.tabel)} CASCADE`);
    }
    for (const t of tabel) {
      for (const baris of t.baris) {
        const kolom = Object.keys(baris);
        if (kolom.length === 0) continue;
        const placeholders = kolom.map((_, i) => `$${i + 1}`).join(", ");
        const nilai = kolom.map((k) => {
          const v = baris[k];
          // objek/array (json/jsonb) → string JSON untuk parameter
          return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        });
        await client.query(
          `INSERT INTO ${quoteIdent(t.tabel)} (${kolom.map(quoteIdent).join(", ")})
           VALUES (${placeholders})`,
          nilai,
        );
      }
    }
    await client.query("SET session_replication_role = DEFAULT");
    await client.query("COMMIT");
    console.log(`Selesai: ${tabel.length} tabel, ${total} baris dipulihkan.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Restore GAGAL (di-rollback):", e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
