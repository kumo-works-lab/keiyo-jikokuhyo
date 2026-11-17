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
  S_wd: "tt0859/0859020", // 新木場 上り 平日（東京へ行く列車を全部集める。乗り換え計算用）
  S_hd: "tt0859/0859021", // 新木場 上り 土休日
};
// 乗り換え計算で時刻を調べる駅（東京方面の順）
export const NET_ST = ["稲毛海岸", "検見川浜", "海浜幕張", "幕張豊砂", "新習志野", "南船橋", "西船橋", "二俣新町", "市川塩浜", "新浦安", "舞浜", "葛西臨海公園", "新木場", "潮見", "越中島", "八丁堀", "東京"];
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

// 列車ページから、各駅の [着, 発] を並べて返す（着だけ・発だけの駅は同じ値を入れる。止まらない駅は null）
export function parseTrainFull(html, stations) {
  const txt = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|\u3000/g, " ")
    .replace(/\s+/g, " ");
  const toM = (h, m) => (+h < 4 ? +h + 24 : +h) * 60 + +m;
  const out = [];
  for (const st of stations) {
    const re = new RegExp(`(?:^| )${st} (?:[•・] ?)?(\\d{1,2}):(\\d{2}) ?(着|発)(?: (?:[•・] ?)?(\\d{1,2}):(\\d{2}) ?(着|発))?`);
    const m = txt.match(re);
    if (!m) { out.push(null, null); continue; }
    const t1 = toM(m[1], m[2]), t2 = m[4] ? toM(m[4], m[5]) : null;
    let a = null, d = null;
    if (m[3] === "着") a = t1; else d = t1;
    if (t2 != null) { if (m[6] === "着") a = t2; else d = t2; }
    out.push(a ?? d, d ?? a);
  }
  return out;
}

// どの表の列車について、どの駅の時刻を調べるか
const ARR = {
  U: { st: ["海浜幕張", "東京"], all: true },
  K: { st: ["稲毛海岸"], all: true },
  M: { st: ["東京"], all: false },
  // 東京発の下り: 特急の海浜幕張着に加えて、稲毛海岸への帰り用に全列車の稲毛海岸着も調べる
  // 武蔵野線直通（府・西・所）と、稲毛海岸の手前で終わる列車（習・幕）は稲毛海岸に来ないので調べない
  T: { st: ["海浜幕張", "稲毛海岸"], all: true, skip: ["府", "西", "所", "習", "幕"] },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 稲毛海岸発（U）と新木場上り（S）の列車について全駅の時刻を集め、乗り換え計算用の net を作る
async function buildNet(tables, versions, links) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync("net-cache.json", "utf8")); } catch {}
  const net = {}, keep = {};
  let fails = 0;
  for (const d of ["wd", "hd"]) {
    const idx = new Map(), list = [];
    const want = [];
    for (const k of [`U_${d}`, `S_${d}`]) {
      tables[k].forEach((r, i) => {
        const link = links[k][i];
        if (!link || r[1] === 2) return;
        const url = `${versions[k]}/${link}`;
        if (!idx.has(url)) { idx.set(url, list.length); list.push(url); want.push(r[1]); }
        if (k[0] === "U") r[7] = idx.get(url);
      });
    }
    const todo = list.filter(u => !(u in cache));
    console.log(`net ${d}: ${list.length}本中 ${todo.length}本を新しく取得`);
    const queue = [...todo];
    async function worker() {
      while (queue.length) {
        const url = queue.shift();
        const r = await fetch(`${BASE}/${url}.html`, { headers: { "User-Agent": "Mozilla/5.0 (personal timetable app; 1 fetch/day)" } }).catch(() => null);
        const html = r && r.ok ? await r.text() : null;
        const v = html ? parseTrainFull(html, NET_ST) : null;
        if (v && v.some(x => x != null)) cache[url] = v; else fails++;
        await sleep(150);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    net[d] = list.map((u, i) => { if (cache[u]) keep[u] = cache[u]; return [want[i], cache[u] || null]; });
  }
  fs.writeFileSync("net-cache.json", JSON.stringify(keep));
  return { net, fails };
}

async function fillArrivals(tables, versions) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync("arrivals.json", "utf8")); } catch {}
  const next = {};
  const jobs = [];
  for (const [k, rows] of Object.entries(tables)) {
    const cfg = ARR[k[0]];
    if (!cfg) { for (const r of rows) r[6] = null; continue; }
    for (const r of rows) {
      const link = r[6];
      r[6] = null;
      if (!link || (!cfg.all && r[1] !== 2)) continue;
      if (cfg.skip && r[1] !== 2 && cfg.skip.includes(r[2])) continue;
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
      if (v && v.some(x => x != null)) cache[key] = v;
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

// 祝日の一覧（土休日ダイヤの日の判定に使う）。内閣府の祝日をまとめた holidays-jp のデータを毎日取り込む。
// 取れなかった日・おかしな中身の日は、前回の値をそのまま使う（アプリには組み込みの一覧も残してある）
export async function fetchHolidays(old, now = Date.now()) {
  try {
    const r = await fetch("https://holidays-jp.github.io/api/v1/date.json", { headers: { "User-Agent": "Mozilla/5.0 (personal timetable app; 1 fetch/day)" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const year = new Date(now + 9 * 3600e3).getUTCFullYear();
    const dates = Object.keys(j).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && +d.slice(0, 4) >= year - 1).sort();
    const thisYear = dates.filter(d => +d.slice(0, 4) === year).length;
    if (thisYear < 14) throw new Error(`今年の祝日が少なすぎる (${thisYear}件)`); // 毎年16〜18日ある
    return dates;
  } catch (e) {
    console.log("警告: 祝日を取得できませんでした。前回の値を使います:", e.message);
    return old.holidays || null;
  }
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
    if (/^S_wd$/.test(k) && !rows.some(r => r[1] === 1)) errors.push(`${k}: 快速が1本も読み取れない`);
    tables[k] = rows;
    versions[k] = v;
    console.log(k, v, rows.length, "本 / 快速", rows.filter(r => r[1] === 1).length, "/ 特急", rows.filter(r => r[1] === 2).length);
  }
  // 列車ページへのリンクは fillArrivals が消すので先に控える
  const links = Object.fromEntries(Object.entries(tables).map(([k, rows]) => [k, rows.map(r => r[6])]));
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
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  // 乗り換え計算用。読めなくてもアプリは乗り換えなしの表示に戻るだけなので、失敗しても止めない
  let net = null;
  try {
    const r = await buildNet(tables, versions, links);
    console.log("net の取得失敗:", r.fails);
    const ok = r.net.wd.filter(x => x[1] && x[1][NET_ST.length * 2 - 1] != null).length;
    if (ok >= r.net.wd.length * 0.7) net = { st: NET_ST, ...r.net };
    else console.log(`警告: 東京の時刻が読めた列車が少ないので net は更新しない (${ok}/${r.net.wd.length})`);
  } catch (e) { console.log("警告: net を作れませんでした", e); }
  if (!net) for (const k in tables) if (k[0] === "U") for (const r of tables[k]) r.length = Math.min(r.length, 7);
  delete tables.S_wd; delete tables.S_hd;
  fs.writeFileSync("arrivals.json", JSON.stringify(cache));
  // 最後に確認に成功した日（時刻表が変わらない日も書く。アプリが「更新が止まっていないか」を見るのに使う）
  fs.writeFileSync("checked.json", JSON.stringify({ checked: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10) }));
  const holidays = await fetchHolidays(old);
  const sameTables = JSON.stringify(tables) === JSON.stringify(old.tables) && JSON.stringify(net) === JSON.stringify(old.net || null);
  const sameHolidays = JSON.stringify(holidays) === JSON.stringify(old.holidays || null);
  if (sameTables && sameHolidays) {
    console.log("変更なし");
    return;
  }
  if (sameTables) {
    // 時刻表は同じで、祝日の一覧だけ変わった日（更新日は変えない）
    fs.writeFileSync("data.json", JSON.stringify({ ...old, holidays }));
    console.log("祝日の一覧だけ更新しました");
    return;
  }
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const diff = Object.keys(tables).filter(k => k[0] !== "S").map(k => `${k}: ${old.tables[k]?.length ?? 0}→${tables[k].length}本 (版${versions[k]})`).join("\n");
  fs.writeFileSync("data.json", JSON.stringify({ updated: today, note: "", versions, tables, net, holidays }));
  fs.writeFileSync("CHANGES.txt", diff + "\n");
  console.log("更新しました\n" + diff);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
