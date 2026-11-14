// JR東日本の駅時刻表ページを取得して data.json を更新する。
// 変更がなければ data.json は書き換えない。異常があれば終了コード1で失敗させ、古いデータを残す。
import fs from "node:fs";

const PAGES = {
  U_wd: "tt0147/0147020", // 稲毛海岸 上り 平日
  U_hd: "tt0147/0147021", // 稲毛海岸 上り 土休日
  K_wd: "tt0413/0413010", // 海浜幕張 下り 平日
  K_hd: "tt0413/0413011", // 海浜幕張 下り 土休日
};
const BASE = "https://timetables.jreast.co.jp";

// 版(YYMM)の候補: 来月から12か月前まで、新しい順
function candidates() {
  const now = new Date(Date.now() + 9 * 3600e3);
  const out = [];
  for (let i = -1; i <= 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, "0"));
  }
  return out;
}

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (personal timetable app; 1 fetch/day)" } });
  if (!r.ok) return null;
  const t = await r.text();
  return /\d{1,2}時/.test(t) ? t : null;
}

async function fetchLatest(path) {
  for (const v of candidates()) {
    const html = await get(`${BASE}/${v}/timetable/${path}.html`);
    if (html) return { v, html };
  }
  throw new Error(`取得失敗: ${path}`);
}

// 種別の印は分の前、行き先の印は分の後ろに付く
const DEST = new Set(["習", "西", "府", "所", "一", "君", "成", "誉", "安", "勝", "館", "一・成", "幕"]);
export function parse(html) {
  let txt = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
  const end = txt.indexOf("列車種別");
  if (end > 0) txt = txt.slice(0, end);
  const start = txt.search(/(^|\s)\d{1,2}時(\s|$)/);
  if (start < 0) throw new Error("時の見出しが見つからない");
  const toks = txt.slice(start).split(/\s+/).filter(Boolean);
  const out = [];
  let hour = null, type = null, last = null;
  for (const t of toks) {
    let m;
    if ((m = t.match(/^(\d{1,2})時$/))) { hour = +m[1]; type = null; continue; }
    if (hour === null) continue;
    if ((m = t.match(/^(\d{2})[◆●]*$/))) {
      const h = hour < 4 ? hour + 24 : hour;
      last = { m: h * 60 + +m[1], type, dest: null };
      out.push(last);
      type = null;
      continue;
    }
    if (DEST.has(t) && last) { last.dest = t; continue; }
    if (/^(快|特|通快|しも|むさし)/.test(t)) { type = t; continue; }
  }
  // 特急など稲毛海岸に停まらない列車を除く
  return out
    .filter(x => !(x.type && /^(特|しも|むさし)/.test(x.type)))
    .map(x => [x.m, x.type === "快" ? 1 : 0, x.dest])
    .sort((a, b) => a[0] - b[0]);
}

async function main() {
  const old = JSON.parse(fs.readFileSync("data.json", "utf8"));
  const tables = {}, versions = {};
  const errors = [];
  for (const [k, path] of Object.entries(PAGES)) {
    const { v, html } = await fetchLatest(path);
    fs.writeFileSync(`raw/${k}.html`, html);
    const rows = parse(html);
    const before = old.tables[k]?.length || 0;
    if (rows.length < 60) errors.push(`${k}: 本数が少なすぎる (${rows.length})`);
    if (before && Math.abs(rows.length - before) > before * 0.3) errors.push(`${k}: 本数が大きく変化 (${before}→${rows.length})`);
    if (k.endsWith("_wd") && !rows.some(r => r[1])) errors.push(`${k}: 快速が1本も読み取れない`);
    tables[k] = rows;
    versions[k] = v;
    console.log(k, v, rows.length, "本 / 快速", rows.filter(r => r[1]).length);
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  if (JSON.stringify(tables) === JSON.stringify(old.tables)) {
    console.log("変更なし");
    return;
  }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const diff = Object.keys(tables).map(k => `${k}: ${old.tables[k]?.length ?? 0}→${tables[k].length}本 (版${versions[k]})`).join("\n");
  fs.writeFileSync("data.json", JSON.stringify({ updated: today, note: "", versions, tables }));
  fs.writeFileSync("CHANGES.txt", diff + "\n");
  console.log("更新しました\n" + diff);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
