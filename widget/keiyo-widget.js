// 京葉線 発車時刻ウィジェット（Scriptable用）
// ウィジェットの「Parameter」に次のどれかを入れると区間を選べます（空なら makuhari）
//   makuhari … 稲毛海岸 → 海浜幕張
//   tokyo    … 稲毛海岸 → 東京（途中で乗り換えた方が早ければ、乗換回数と駅を表示）
//   back     … 海浜幕張 → 稲毛海岸
//   back-tokyo … 東京 → 稲毛海岸
//   ltd-up   … 特急 海浜幕張 → 東京
//   ltd-down … 特急 東京 → 海浜幕張
//   auto     … 平日の朝〜昼は makuhari、15時以降は back
const URL_BASE = "https://kumo-works-lab.github.io/keiyo-jikokuhyo/";

const NAMES = { 習: "新習志野", 西: "西船橋", 府: "府中本町", 所: "東所沢", 安: "安房鴨川", 勝: "勝浦", 館: "館山", 一: "上総一ノ宮", 君: "君津", 成: "成東", 誉: "誉田", "一・成": "上総一ノ宮・成東", 幕: "海浜幕張" };
const HOL = ["2026-11-23", "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"];
const NOT_TOKYO = ["習", "西", "府", "所"];
const ROUTES = {
  tokyo: { label: "稲毛海岸 → 東京", src: "U", def: "東京", excl: NOT_TOKYO, arr: 1, xfer: true },
  makuhari: { label: "稲毛海岸 → 海浜幕張", src: "U", def: "東京", excl: [], arr: 0 },
  back: { label: "海浜幕張 → 稲毛海岸", src: "K", def: "蘇我", excl: [], arr: 0, noPass: true },
  "back-tokyo": { label: "東京 → 稲毛海岸", src: "T", def: "蘇我", excl: ["府", "西", "所", "習", "幕"], arr: 1, needArr: true },
  "ltd-up": { label: "特急 海浜幕張 → 東京", src: "M", def: "東京", excl: NOT_TOKYO, arr: 0, ltd: true },
  "ltd-down": { label: "特急 東京 → 海浜幕張", src: "T", def: "蘇我", excl: [], arr: 0, ltd: true },
};

const pad = n => String(n).padStart(2, "0");
const fmt = m => Math.floor(m / 60) % 24 + ":" + pad(m % 60);
function jstParts(date) {
  const t = new Date(date.getTime() + 9 * 3600e3);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function addDay(y, m, d, n) { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function dayType(y, m, d) {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 || w === 6 || HOL.includes(`${y}-${pad(m)}-${pad(d)}`) ? "hd" : "wd";
}
// 運行日(JST)の0時からm分後の Date
const toDate = (sd, m) => new Date(Date.UTC(sd.y, sd.mo - 1, sd.d) - 9 * 3600e3 + m * 60e3);

// ---- 乗り換え検索（アプリ本体と同じ考え方）----
const XFER_MIN = 1, MAX_XFER = 2;
const PLAN = {};
function planner(data, type) {
  if (type in PLAN) return PLAN[type];
  const net = data.net && data.net[type];
  if (!net) return (PLAN[type] = null);
  const N = data.net.st.length, TOK = N - 1;
  const stops = net.map(([k, v]) => {
    if (!v || k === 2) return [];
    const o = [];
    for (let s = 0; s < N; s++) if (v[2 * s] != null) o.push(s);
    return o.sort((x, y) => v[2 * x] - v[2 * y]);
  });
  const A = (j, s) => net[j][1][2 * s], D = (j, s) => net[j][1][2 * s + 1];
  return (PLAN[type] = i => {
    if (!net[i] || !net[i][1] || net[i][1][1] == null) return null;
    const best = new Array(N).fill(Infinity);
    let cur = new Array(N).fill(null), res = null;
    for (const s of stops[i]) { if (s === 0) continue; best[s] = A(i, s); cur[s] = { t: A(i, s), legs: [{ j: i, from: 0 }] }; }
    if (cur[TOK]) res = cur[TOK];
    for (let k = 1; k <= MAX_XFER; k++) {
      const nx = new Array(N).fill(null);
      let any = false;
      for (let j = 0; j < net.length; j++) {
        let on = null;
        for (const s of stops[j]) {
          if (on) { const a = A(j, s); if (a < best[s]) { best[s] = a; nx[s] = { t: a, legs: [...on.legs, { j, from: on.s }] }; any = true; } }
          const L = cur[s];
          if (L && L.legs[L.legs.length - 1].j !== j && D(j, s) >= L.t + XFER_MIN) on = { s, legs: L.legs };
        }
      }
      if (nx[TOK]) res = nx[TOK];
      if (!any) break;
      cur = nx;
    }
    return res ? { at: res.t, n: res.legs.length - 1, at_st: res.legs.slice(1).map(l => data.net.st[l.from]) } : null;
  });
}

function trains(data, rt, type) {
  const P = rt.xfer ? planner(data, type) : null;
  let out = (data.tables[rt.src + "_" + type] || [])
    .map(r => {
      const b = P && r[7] != null ? P(r[7]) : null;
      return { m: r[0], kind: +r[1] || 0, d: r[2], name: r[3], x: r[4], arr: b ? b.at : r[6] ? r[6][rt.arr] : null, xn: b ? b.n : null, xs: b ? b.at_st : [], ok: !P || !!b };
    })
    .filter(t => {
      if (!t.ok) return false;
      if (!P && t.d && rt.excl.includes(t.d)) return false;
      if (rt.ltd) return t.kind === 2;
      if (rt.noPass && t.x === "通過") return false;
      return t.kind !== 2;
    });
  // 行き先の駅に停まらない列車は出さない。到着時刻が全く取れていない日は絞らない
  if (rt.needArr) {
    const have = out.filter(t => t.arr != null).length;
    if (have >= out.length * 0.5) out = out.filter(t => t.arr != null);
  }
  return out;
}

// 次の列車を最大n本（日付またぎも含む）
function upcoming(data, rt, now, n) {
  const p = jstParts(now);
  let sd = { y: p.y, mo: p.mo, d: p.d }, nowM = p.h * 60 + p.mi;
  if (p.h < 4) { sd = addDay(p.y, p.mo, p.d, -1); nowM += 1440; }
  const out = [];
  for (let i = 0; i < 2 && out.length < n; i++) {
    const day = i ? addDay(sd.y, sd.mo, sd.d, 1) : sd;
    for (const t of trains(data, rt, dayType(day.y, day.mo, day.d))) {
      if (i === 0 && t.m < nowM) continue;
      out.push({ ...t, date: toDate(day, t.m), arrDate: t.arr != null ? toDate(day, t.arr) : null, tomorrow: i === 1 });
      if (out.length >= n) break;
    }
  }
  return out;
}

function pickRoute(param, now) {
  const key = (param || "makuhari").trim();
  if (key === "auto") {
    const p = jstParts(now);
    return ROUTES[dayType(p.y, p.mo, p.d) === "wd" && p.h >= 4 && p.h < 15 ? "makuhari" : "back"];
  }
  return ROUTES[key] || ROUTES.makuhari;
}

// ---------- ここから Scriptable の画面 ----------
async function loadData() {
  const fm = FileManager.local();
  const path = fm.joinPath(fm.documentsDirectory(), "keiyo-data.json");
  try {
    const d = await new Request(URL_BASE + "data.json?" + Date.now()).loadJSON();
    if (d && d.tables) { fm.writeString(path, JSON.stringify(d)); return d; }
  } catch (e) {}
  return fm.fileExists(path) ? JSON.parse(fm.readString(path)) : null;
}

const C = {
  bg1: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  bg2: Color.dynamic(new Color("#f2f2f7"), new Color("#000000")),
  text: Color.dynamic(new Color("#000000"), new Color("#ffffff")),
  sub: Color.dynamic(new Color("#3c3c43", 0.6), new Color("#ebebf5", 0.6)),
  line: Color.dynamic(new Color("#c9242f"), new Color("#ff4d5a")),
  rapid: Color.dynamic(new Color("#ff7a00"), new Color("#ff9f0a")),
  ltd: Color.dynamic(new Color("#8e44d8"), new Color("#bf7cff")),
};
const kindLabel = t => (t.kind === 2 ? "特急" : t.kind === 1 ? "快速" : "各停");
const kindColor = t => (t.kind === 2 ? C.ltd : t.kind === 1 ? C.rapid : C.sub);
const xferLabel = t => (t.xn == null ? "" : t.xn ? `・乗換${t.xn}回（${t.xs.join("・")}）` : "・乗換なし");
const xferShort = t => (t.xn ? ` 乗換${t.xs.join("・")}` : "");

function txt(st, s, font, color, opts = {}) {
  const t = st.addText(s);
  t.font = font; t.textColor = color; t.lineLimit = 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function build(family, rt, list, data) {
  const w = new ListWidget();
  w.url = URL_BASE;
  const first = list[0];

  // ロック画面（1行）
  if (family === "accessoryInline") {
    w.addText(first ? `${fmt(first.m)} ${kindLabel(first)}${first.arr != null ? " → " + fmt(first.arr) + "着" : ""}${xferShort(first)}` : "本日の運転は終了");
    return w;
  }
  // ロック画面（長方形）
  if (family === "accessoryRectangular") {
    txt(w, rt.label, Font.semiboldSystemFont(11), Color.white(), { scale: 0.7 });
    if (!first) { txt(w, "本日の運転は終了", Font.boldSystemFont(15), Color.white()); return w; }
    const r = w.addStack(); r.centerAlignContent();
    txt(r, fmt(first.m), Font.boldRoundedSystemFont(22), Color.white());
    r.addSpacer(6);
    const d = r.addDate(first.date); d.applyRelativeStyle(); d.font = Font.semiboldSystemFont(13); d.lineLimit = 1;
    const second = list[1];
    txt(w, `${kindLabel(first)}${first.arr != null ? " " + fmt(first.arr) + "着" : ""}${xferShort(first)}${second ? "　次 " + fmt(second.m) : ""}`, Font.systemFont(12), Color.white(), { scale: 0.7 });
    return w;
  }

  const g = new LinearGradient();
  g.colors = [C.bg1, C.bg2]; g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(14, 16, 14, 16);

  const head = w.addStack(); head.centerAlignContent();
  const bar = head.addStack(); bar.size = new Size(4, 14); bar.cornerRadius = 2; bar.backgroundColor = C.line;
  head.addSpacer(6);
  txt(head, rt.label, Font.semiboldSystemFont(12), C.sub, { scale: 0.7 });
  w.addSpacer(6);

  if (!data) { txt(w, "データを読み込めません", Font.semiboldSystemFont(14), C.sub); return w; }
  if (!first) { txt(w, rt.ltd ? "本日の特急は終了" : "本日の運転は終了", Font.boldSystemFont(16), C.text); return w; }

  const main = w.addStack(); main.bottomAlignContent();
  txt(main, fmt(first.m), Font.boldRoundedSystemFont(family === "systemSmall" ? 34 : 40), C.text, { scale: 0.6 });
  main.addSpacer(8);
  const cd = main.addStack(); cd.layoutVertically();
  const tag = cd.addStack(); tag.setPadding(1, 6, 1, 6); tag.cornerRadius = 6; tag.backgroundColor = kindColor(first);
  txt(tag, kindLabel(first), Font.boldSystemFont(10), Color.white());
  cd.addSpacer(2);
  const d = cd.addDate(first.date); d.applyTimerStyle(); d.font = Font.boldMonospacedSystemFont(14); d.textColor = C.line; d.lineLimit = 1;
  if (first.tomorrow) txt(cd, "明日", Font.systemFont(10), C.sub);

  if (first.arr != null) {
    w.addSpacer(2);
    txt(w, `→ ${fmt(first.arr)} 着（${first.arr - first.m}分）${xferLabel(first)}`, Font.semiboldSystemFont(13), C.text, { scale: 0.7 });
  }
  w.addSpacer();

  const more = list.slice(1, family === "systemSmall" ? 2 : family === "systemLarge" ? 8 : 3);
  for (const t of more) {
    const r = w.addStack(); r.centerAlignContent();
    txt(r, fmt(t.m), Font.semiboldMonospacedSystemFont(14), C.text);
    r.addSpacer(6);
    txt(r, kindLabel(t), Font.boldSystemFont(11), kindColor(t));
    if (t.arr != null) { r.addSpacer(6); txt(r, `→ ${fmt(t.arr)}着${xferShort(t)}`, Font.systemFont(12), C.sub, { scale: 0.7 }); }
    if (family !== "systemSmall" && t.d) { r.addSpacer(6); txt(r, (NAMES[t.d] || t.d) + "行", Font.systemFont(11), C.sub, { scale: 0.7 }); }
    r.addSpacer();
  }
  return w;
}

async function run() {
  const now = new Date();
  const rt = pickRoute(args.widgetParameter, now);
  const data = await loadData();
  const list = data ? upcoming(data, rt, now, 8) : [];
  const family = config.widgetFamily || "systemMedium";
  const w = build(family, rt, list, data);
  // 次の列車が出たら更新（iOSの都合で数分遅れることがあります）
  const next = list[0] ? new Date(list[0].date.getTime() + 30e3) : new Date(now.getTime() + 30 * 60e3);
  w.refreshAfterDate = new Date(Math.min(next.getTime(), now.getTime() + 30 * 60e3));
  if (config.runsInWidget) Script.setWidget(w);
  else await w.presentMedium();
  Script.complete();
}

await run();
