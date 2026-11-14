// JR東日本の駅時刻表ページを取得して data.json を更新する。
// 変更がなければ data.json は書き換えない。異常があれば終了コード1で失敗させ、古いデータを残す。
import fs from "node:fs";

const PAGES = {
  U_wd: "tt0147/0147020", // 稲毛海岸 上り 平日
  U_hd: "tt0147/0147021", // 稲毛海岸 上り 土休日
  K_wd: "tt0413/0413010", // 海浜幕張 下り 平日
  K_hd: "tt0413/0413011", // 海浜幕張 下り 土休日
  M_wd: "tt0413/0413020", // 海浜幕張 上り 平日（東京方面・特急あり）
  M_hd: "tt0413/0413021", // 海浜幕張 上り 土休日
  T_wd: "tt1039/1039070", // 東京 京葉線 下り 平日
  T_hd: "tt1039/1039071", // 東京 京葉線 下り 土休日
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
// 1行 = [分(0時起点、深夜は24時以降), 種別(0=普通 1=快速 2=特急), 行き先の印|null, 列車名|null, 補足|null, 運転日注意(1/0)]
const DEST = new Set(["習", "西", "府", "所", "一", "君", "成", "誉", "安", "勝", "館", "一・成", "幕"]);
export function parse(html) {
  let txt = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\u3000/g, " ");
  // 凡例から列車名を読む（例: わ=わかしお 水君=水戸偕楽園君津号）
  const names = {};
  const li = txt.indexOf("列車種別");
  if (li > 0) {
    const legend = txt.slice(li, li + 400).split("行き先")[0];
    for (const m of legend.matchAll(/([^\s=]+)=([^\s=]+)/g)) {
      if (!["無印", "快", "特", "通快"].includes(m[1])) names[m[1]] = m[2];
    }
    txt = txt.slice(0, li);
  }
  const start = txt.search(/(^|\s)\d{1,2}時(\s|$)/);
  if (start < 0) throw new Error("時の見出しが見つからない");
  const toks = txt.slice(start).split(/\s+/).filter(Boolean);
  const out = [];
  let hour = null, type = null, last = null;
  for (const t of toks) {
    let m;
    if ((m = t.match(/^(\d{1,2})時$/))) { hour = +m[1]; type = null; continue; }
    if (hour === null) continue;
    if ((m = t.match(/^(\d{2})([◆●]*)$/))) {
      const h = hour < 4 ? hour + 24 : hour;
      last = { m: h * 60 + +m[1], type, dest: null, caution: m[2].includes("◆") };
      out.push(last);
      type = null;
      continue;
    }
    if (t === "◆" && last) { last.caution = true; continue; }
    if (DEST.has(t) && last) { last.dest = t; continue; }
    if (/^(快|特|通快|しも|むさし)/.test(t)) { type = t; continue; }
  }
  return out
    // 武蔵野線直通の「しもうさ」「むさしの」は京葉線内の対象外
    .filter(x => !(x.type && /^(しも|むさし)/.test(x.type)))
    .map(x => {
      const kind = !x.type ? 0 : x.type.startsWith("特") ? 2 : 1;
      let name = null;
      if (kind === 2) {
        const key = x.type.slice(1);
        name = (names[key] || key || "特急").replace(/号$/, "");
      }
      return [x.m, kind, x.dest, name, null, x.caution ? 1 : 0];
    })
    .sort((a, b) => a[0] - b[0])
    // 運転日の違う同じ時刻の列車が2本載ることがあるので1本にまとめる
    .filter((r, i, a) => i === 0 || JSON.stringify(r) !== JSON.stringify(a[i - 1]));
}

// 稲毛海岸は特急が通過するので除く
const noTokkyu = rows => rows.filter(r => r[1] !== 2);

// 東京発の特急は海浜幕張に停まるものだけ残し、海浜幕張の発車時刻を補足に入れる
export function pairTokyo(tokyo, makuhari) {
  const mk = makuhari.filter(r => r[1] === 2).map(r => r[0]);
  const used = new Set();
  return tokyo.flatMap(r => {
    if (r[1] !== 2) return [r];
    const hit = mk.find(x => !used.has(x) && x - r[0] >= 18 && x - r[0] <= 40);
    if (hit == null) return [];
    used.add(hit);
    return [[r[0], r[1], r[2], r[3], hit, r[5]]];
  });
}

async function main() {
  fs.mkdirSync("raw", { recursive: true });
  const old = JSON.parse(fs.readFileSync("data.json", "utf8"));
  const tables = {}, versions = {};
  const errors = [];
  for (const [k, path] of Object.entries(PAGES)) {
    const { v, html } = await fetchLatest(path);
    fs.writeFileSync(`raw/${k}.html`, html);
    let rows = parse(html);
    if (k.startsWith("U")) rows = noTokkyu(rows);
    if (k.startsWith("K")) rows = rows.map(r => r[1] === 2 ? [...r.slice(0, 4), "通過", r[5]] : r);
    const before = old.tables[k]?.length || 0;
    if (rows.length < 60) errors.push(`${k}: 本数が少なすぎる (${rows.length})`);
    if (before && Math.abs(rows.length - before) > before * 0.3) errors.push(`${k}: 本数が大きく変化 (${before}→${rows.length})`);
    if (/^[UK]_wd$/.test(k) && !rows.some(r => r[1] === 1)) errors.push(`${k}: 快速が1本も読み取れない`);
    if (/^[MT]_/.test(k) && !rows.some(r => r[1] === 2)) errors.push(`${k}: 特急が1本も読み取れない`);
    tables[k] = rows;
    versions[k] = v;
    console.log(k, v, rows.length, "本 / 快速", rows.filter(r => r[1] === 1).length, "/ 特急", rows.filter(r => r[1] === 2).length);
  }
  for (const d of ["wd", "hd"]) {
    tables[`T_${d}`] = pairTokyo(tables[`T_${d}`], tables[`K_${d}`]);
    if (!tables[`T_${d}`].some(r => r[1] === 2)) errors.push(`T_${d}: 海浜幕張に停まる特急が見つからない`);
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
