import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { companies, ingredientComponents, ingredients, productionConsumptions } from "../../db/schema";
import { db } from "../../db/client";
import { hitungSaldoCabang } from "../stok/service";
import { tanggalDi } from "../../lib/time";

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface BarisProduksiSelesai {
  /** id baris productions yang baru saja SELESAI produksi (masuk ≥ 'menunggu') */
  id: string;
  branchId: string;
  ingredientId: string;
  qty: number;
}

/**
 * Catat KONSUMSI BAHAN MENTAH untuk baris produksi yang baru selesai
 * dikerjakan: kebutuhan = resep (per 1 batch = isi bahan jadi) × qty/isi.
 * Idempoten per baris (unique production_id+ingredient_id, transisi status
 * sudah compare-and-set). Hanya bahan mentah ber-track_stok yang dicatat —
 * stok bahan tak dilacak memang tak dihitung di mana pun.
 */
export async function catatKonsumsiProduksi(
  tx: Tx,
  companyId: string,
  rows: BarisProduksiSelesai[],
): Promise<void> {
  if (rows.length === 0) return;
  const producedIds = [...new Set(rows.map((r) => r.ingredientId))];
  const input = alias(ingredients, "input_bahan");
  const resepRows = await tx
    .select({
      producedId: ingredientComponents.ingredientId,
      producedIsi: ingredients.isi,
      inputId: ingredientComponents.inputIngredientId,
      qty: ingredientComponents.qty,
      inputTrack: input.trackStok,
    })
    .from(ingredientComponents)
    .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
    .innerJoin(input, eq(input.id, ingredientComponents.inputIngredientId))
    .where(
      and(
        eq(ingredients.companyId, companyId),
        inArray(ingredientComponents.ingredientId, producedIds),
      ),
    );
  if (resepRows.length === 0) return;

  const resepByProduced = new Map<string, typeof resepRows>();
  for (const r of resepRows) {
    if (!r.inputTrack) continue;
    const list = resepByProduced.get(r.producedId) ?? [];
    list.push(r);
    resepByProduced.set(r.producedId, list);
  }
  if (resepByProduced.size === 0) return;

  const [company] = await tx
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId));
  const tanggal = tanggalDi(company?.timezone ?? "Asia/Jakarta");

  const values: (typeof productionConsumptions.$inferInsert)[] = [];
  for (const row of rows) {
    const resep = resepByProduced.get(row.ingredientId);
    if (!resep || row.qty <= 0) continue;
    // resep didefinisikan per 1 BATCH (isi) bahan jadi → skala qty/isi
    const isi = resep[0].producedIsi;
    const batch = isi > 0 ? row.qty / isi : 0;
    if (batch <= 0) continue;
    for (const k of resep) {
      values.push({
        productionId: row.id,
        companyId,
        branchId: row.branchId,
        ingredientId: k.inputId,
        qty: k.qty * batch,
        tanggal,
      });
    }
  }
  if (values.length === 0) return;
  // Pengaman ganda idempotensi (transisi status sudah CAS): baris yang sama
  // tak pernah tercatat dua kali.
  await tx.insert(productionConsumptions).values(values).onConflictDoNothing();
}

export interface BahanKurangProduksi {
  ingredientId: string;
  nama: string;
  satuan: string;
  butuh: number;
  tersedia: number;
}

/**
 * Cek KETERSEDIAAN bahan mentah resep sebelum produksi dimulai ("mulai
 * dikerjakan"): kebutuhan = resep (per 1 batch = isi bahan jadi) × qty/isi,
 * dibandingkan saldo bahan mentah di cabang PELAKSANA (CK). Balikan daftar
 * bahan yang KURANG (butuh > saldo) — kosong berarti aman untuk mulai.
 *
 * Dipakai sebagai pengaman: jangan biarkan produksi dimulai bila bahan
 * bakunya belum diterima/cukup di cabang. Membaca saldo saat ini (committed);
 * panggil SEBELUM membuka transaksi tulis.
 */
export async function bahanKurangUntukProduksi(
  companyId: string,
  rows: BarisProduksiSelesai[],
): Promise<BahanKurangProduksi[]> {
  if (rows.length === 0) return [];
  const producedIds = [...new Set(rows.map((r) => r.ingredientId))];
  const input = alias(ingredients, "input_bahan_cek");
  const resepRows = await db
    .select({
      producedId: ingredientComponents.ingredientId,
      producedIsi: ingredients.isi,
      inputId: ingredientComponents.inputIngredientId,
      qty: ingredientComponents.qty,
      inputTrack: input.trackStok,
      inputNama: input.nama,
      inputSatuan: input.satuan,
    })
    .from(ingredientComponents)
    .innerJoin(ingredients, eq(ingredients.id, ingredientComponents.ingredientId))
    .innerJoin(input, eq(input.id, ingredientComponents.inputIngredientId))
    .where(
      and(
        eq(ingredients.companyId, companyId),
        inArray(ingredientComponents.ingredientId, producedIds),
      ),
    );
  if (resepRows.length === 0) return [];

  const resepByProduced = new Map<string, typeof resepRows>();
  for (const r of resepRows) {
    if (!r.inputTrack) continue; // bahan tak dilacak → tak dihitung stoknya
    const list = resepByProduced.get(r.producedId) ?? [];
    list.push(r);
    resepByProduced.set(r.producedId, list);
  }
  if (resepByProduced.size === 0) return [];

  // Akumulasi kebutuhan per cabang → per bahan mentah (beberapa baris bisa
  // menghasilkan bahan jadi yang sama; kebutuhannya dijumlah).
  type Butuh = { butuh: number; nama: string; satuan: string };
  const butuhPerCabang = new Map<string, Map<string, Butuh>>();
  for (const row of rows) {
    const resep = resepByProduced.get(row.ingredientId);
    if (!resep || row.qty <= 0) continue;
    const isi = resep[0].producedIsi;
    const batch = isi > 0 ? row.qty / isi : 0;
    if (batch <= 0) continue;
    const perCabang = butuhPerCabang.get(row.branchId) ?? new Map<string, Butuh>();
    for (const k of resep) {
      const cur = perCabang.get(k.inputId) ?? {
        butuh: 0,
        nama: k.inputNama,
        satuan: k.inputSatuan,
      };
      cur.butuh += k.qty * batch;
      perCabang.set(k.inputId, cur);
    }
    butuhPerCabang.set(row.branchId, perCabang);
  }

  const kurang: BahanKurangProduksi[] = [];
  for (const [branchId, perCabang] of butuhPerCabang) {
    const saldo = await hitungSaldoCabang(companyId, branchId);
    const saldoByIng = new Map(saldo.map((s) => [s.ingredient_id, s.saldo]));
    for (const [inputId, req] of perCabang) {
      const tersedia = saldoByIng.get(inputId) ?? 0;
      if (req.butuh - tersedia > 1e-6) {
        kurang.push({
          ingredientId: inputId,
          nama: req.nama,
          satuan: req.satuan,
          butuh: req.butuh,
          tersedia,
        });
      }
    }
  }
  return kurang;
}
