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
    .replace(/<a[^>]+href="(?:\.\.\/)+(train\/[\w/]+)\.html"/g, " @$1 <a")
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
  let hour = null, type = null, last = null, link = null;
  for (const t of toks) {
    let m;
    if ((m = t.match(/^(\d{1,2})時$/))) { hour = +m[1]; type = null; continue; }
    if (hour === null) continue;
    if (t.startsWith("@")) { link = t.slice(1); continue; }
    if ((m = t.match(/^(\d{2})([◆●]*)$/))) {
      const h = hour < 4 ? hour + 24 : hour;
      last = { m: h * 60 + +m[1], type, dest: null, caution: m[2].includes("◆"), link };
      out.push(last);
      type = null; link = null;
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
      return [x.m, kind, x.dest, name, null, x.caution ? 1 : 0, x.link];
    })
    .sort((a, b) => a[0] - b[0])
    // 運転日の違う同じ時刻の列車が2本載ることがあるので1本にまとめる
    .filter((r, i, a) => i === 0 || JSON.stringify(r.slice(0, 6)) !== JSON.stringify(a[i - 1].slice(0, 6)));
}

// 稲毛海岸は特急が通過するので除く
const noTokkyu = rows => rows.filter(r => r[1] !== 2);

// 列車ごとのページ（停車駅一覧）から、指定した駅の時刻を読む。着があれば着、なければ発。
export function parseTrain(html, stations) {
  const txt = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|\u3000/g, " ")
    .replace(/\s+/g, " ");
  return stations.map(st => {
    const re = new RegExp(`(?:^| )${st} (?:[•・] ?)?(\\d{1,2}):(\\d{2}) ?(着|発)(?: (?:[•・] ?)?(\\d{1,2}):(\\d{2}) ?(着|発))?`);
    const m = txt.match(re);
    if (!m) return null;
    const useSecond = m[3] !== "着" && m[6] === "着";
    const h = +(useSecond ? m[4] : m[1]), mi = +(useSecond ? m[5] : m[2]);
    return (h < 4 ? h + 24 : h) * 60 + mi;
  });
}

// どの表の列車について、どの駅の時刻を調べるか
const ARR = {
  U: { st: ["海浜幕張", "東京"], all: true },
  K: { st: ["稲毛海岸"], all: true },
  M: { st: ["東京"], all: true }, // 海浜幕張で乗り換えたときの東京着を出すため全列車
  T: { st: ["海浜幕張"], all: false },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fillArrivals(tables, versions) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync("arrivals.json", "utf8")); } catch {}
  const next = {};
  const jobs = [];
  for (const [k, rows] of Object.entries(tables)) {
    const cfg = ARR[k[0]];
    for (const r of rows) {
      const link = r[6];
      r[6] = null;
      if (!link || (!cfg.all && r[1] !== 2)) continue;
      const url = `${versions[k]}/${link}`;
      const key = `${url}|${cfg.st.join(",")}`;
      jobs.push({ r, url, key, st: cfg.st });
    }
  }
  const todo = [...new Set(jobs.filter(j => !(j.key in cache)).map(j => j.key))];
  console.log(`列車ページ: ${jobs.length}本中 ${todo.length}本を新しく取得`);
  let fails = 0, firstFail = null;
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const key = queue.shift();
      const [url, st] = key.split("|");
      const r = await fetch(`${BASE}/${url}.html`, { headers: { "User-Agent": "Mozilla/5.0 (personal timetable app; 1 fetch/day)" } }).catch(() => null);
      const html = r && r.ok ? await r.text() : null;
      const v = html ? parseTrain(html, st.split(",")) : null;
      // 東京まで行かない列車などは null のまま覚えておく（毎日取り直さない）
      if (v && (v.some(x => x != null) || /海浜幕張/.test(html))) cache[key] = v;
      else { fails++; if (!firstFail) firstFail = { url, text: html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1500) }; }
      await sleep(150);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (firstFail) console.log("読めなかった例:", firstFail.url, "\n", firstFail.text);
  for (const j of jobs) {
    const v = cache[j.key];
    if (!v) continue;
    next[j.key] = v;
    j.r[6] = v.map(x => (x == null ? null : x < j.r[0] ? x + 1440 : x));
  }
  return { cache: next, fails };
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
    if (k.startsWith("K")) rows = rows.map(r => r[1] === 2 ? [...r.slice(0, 4), "通過", r[5], r[6]] : r);
    const before = old.tables[k]?.length || 0;
    if (rows.length < 60) errors.push(`${k}: 本数が少なすぎる (${rows.length})`);
    if (before && Math.abs(rows.length - before) > before * 0.3) errors.push(`${k}: 本数が大きく変化 (${before}→${rows.length})`);
    if (/^[UK]_wd$/.test(k) && !rows.some(r => r[1] === 1)) errors.push(`${k}: 快速が1本も読み取れない`);
    if (/^[MT]_/.test(k) && !rows.some(r => r[1] === 2)) errors.push(`${k}: 特急が1本も読み取れない`);
    tables[k] = rows;
    versions[k] = v;
    console.log(k, v, rows.length, "本 / 快速", rows.filter(r => r[1] === 1).length, "/ 特急", rows.filter(r => r[1] === 2).length);
  }
  const { cache, fails } = await fillArrivals(tables, versions);
  console.log("列車ページの取得失敗:", fails);
  for (const d of ["wd", "hd"]) {
    // 東京発の特急は海浜幕張に停まるものだけ残し、海浜幕張の時刻を補足に入れる
    tables[`T_${d}`] = tables[`T_${d}`]
      .filter(r => r[1] !== 2 || (r[6] && r[6][0] != null))
      .map(r => (r[1] === 2 ? [r[0], r[1], r[2], r[3], r[6][0], r[5], r[6]] : r));
    if (!tables[`T_${d}`].some(r => r[1] === 2)) errors.push(`T_${d}: 海浜幕張に停まる特急が見つからない`);
    const u = tables[`U_${d}`], uTokyo = u.filter(r => r[6] && r[6][1] != null).length;
    if (uTokyo < u.length * 0.7) errors.push(`U_${d}: 東京の着時刻が読めた列車が少ない (${uTokyo}/${u.length})`);
    const kk = tables[`K_${d}`].filter(r => r[1] !== 2), kOk = kk.filter(r => r[6] && r[6][0] != null).length;
    if (kOk < kk.length * 0.9) errors.push(`K_${d}: 稲毛海岸の着時刻が読めた列車が少ない (${kOk}/${kk.length})`);
    // 乗り換え表示用。読めなくてもアプリは乗り換えなしの表示に戻るだけなので警告にとどめる
    const mm = tables[`M_${d}`].filter(r => r[1] !== 2 && !["習", "西", "府", "所"].includes(r[2]));
    const mOk = mm.filter(r => r[6] && r[6][0] != null).length;
    if (mOk < mm.length * 0.7) console.log(`警告 M_${d}: 東京の着時刻が読めた列車が少ない (${mOk}/${mm.length})`);
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  fs.writeFileSync("arrivals.json", JSON.stringify(cache));
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
