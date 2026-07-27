// 駅ごとの静的ページ + sitemap + robots + llms.txt を生成する。
//   node scripts/gen_pages.mjs
//
// 1ページ1駅で、半径1km圏の14業種すべてを実データの表にする。
// ページ数を稼ぐより1ページの情報量を厚くする方針（薄いページの大量生成を避ける）。
// 集計は web/mesh.js / web/compete.js をそのまま使うので、UIと数字がずれない。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { meshCentroid, primaryMeshesInBBox, circleBBox, aggregateCircle } from "../web/mesh.js";
import { INDUSTRIES, VECTOR_WIDTH, summary, LEVEL_LABEL } from "../web/compete.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const DATA = join(WEB, "data");
const OUT = join(WEB, "eki");
const BASE = "https://compete-map.vercel.app";
const RADIUS = 1000;

const baseline = JSON.parse(readFileSync(join(DATA, "baseline.json"), "utf8"));
const stations = JSON.parse(readFileSync(
  join(process.env.HOME, "shoken_maker", "scripts", "wikidata_stations.json"), "utf8"));

// 1次メッシュのJSONは合計36MB。全部載せるとメモリを食うので少数だけ保持する。
const cache = new Map();
function load(code) {
  if (cache.has(code)) return cache.get(code);
  let cells = null;
  const fp = join(DATA, `${code}.json`);
  if (existsSync(fp)) {
    cells = JSON.parse(readFileSync(fp, "utf8")).map((row) => {
      const [la, lo] = meshCentroid(row[0]);
      return { la, lo, v: row.slice(1) };
    });
  }
  if (cache.size > 6) cache.clear();
  cache.set(code, cells);
  return cells;
}

function circleAt(lat, lon, r) {
  const [a, b, c, d] = circleBBox(lat, lon, r);
  const cells = [];
  for (const code of primaryMeshesInBBox(a, b, c, d)) {
    const m = load(code);
    if (m) cells.push(...m);
  }
  return aggregateCircle(cells, lat, lon, r, VECTOR_WIDTH).sum;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => Math.round(n).toLocaleString("ja-JP");
const slug = (s) => encodeURIComponent(s);

function page(name, en, lat, lon, rows, all) {
  const url = `${BASE}/eki/${slug(name)}/`;
  const food = rows.find((r) => r.id === "food");
  const lead =
    `${name}駅から半径1kmの圏内には、飲食店が${fmt(food.est)}事業所あります。` +
    `常住人口${fmt(all.pop)}人・そこで働く人${fmt(all.daytimePop - all.pop)}人に対し、` +
    `飲食店1店あたり${fmt(food.day.perStore)}人。全国平均は${fmt(baseline.day.food)}人なので、` +
    `${LEVEL_LABEL[food.day.level] ?? "比較できません"}。`;

  const trs = rows.map((r) => {
    const idx = r.day.index != null ? `${(r.day.index * 100).toFixed(0)}%` : "—";
    const per = r.day.perStore != null ? fmt(r.day.perStore) : "—";
    const size = r.avgSize != null ? r.avgSize.toFixed(1) : "—";
    return `<tr><th scope="row">${esc(r.label)}</th><td>${fmt(r.est)}</td><td>${per}</td>` +
      `<td>${fmt(baseline.day[r.id])}</td><td>${idx}</td><td>${size}</td>` +
      `<td>${LEVEL_LABEL[r.day.level] ?? "—"}</td></tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${url}">
<title>${esc(name)}駅の競合密度（半径1km）— 業種別の事業所数と1店あたり人口</title>
<meta name="description" content="${esc(name)}駅から半径1km圏の業種別事業所数・1店あたり人口・全国平均との比。飲食店${fmt(food.est)}事業所、1店あたり${fmt(food.day.perStore)}人（全国平均${fmt(baseline.day.food)}人）。2021年経済センサス／2020年国勢調査の500mメッシュから算出。">
<link rel="stylesheet" href="../../style.css">
</head>
<body class="doc">
<header class="topbar"><h1><a href="../../">競合密度マップ</a></h1></header>
<main class="prose">
<h1>${esc(name)}駅の競合密度（半径1km）</h1>
<p>${esc(lead)}</p>

<table class="data">
<caption>${esc(name)}駅 半径1km圏の業種別内訳</caption>
<thead><tr>
<th scope="col">業種</th><th scope="col">事業所数</th><th scope="col">1店あたり人口</th>
<th scope="col">全国平均</th><th scope="col">全国比</th><th scope="col">平均店舗規模</th><th scope="col">判定</th>
</tr></thead>
<tbody>
${trs}
</tbody>
</table>

<p class="note">
「1店あたり人口」の分母は<strong>常住人口＋圏内で働く人（全産業の従業者数）</strong>です。
繁華街やオフィス街は住んでいる人が少なく働く人が多いため、夜間人口だけで割ると実態とかけ離れます。
ただしこれは代理指標であって昼間人口そのものではなく、同じ区画に住みかつ働く人を二重に数え、
買い物客・観光客は含みません。全国比が100%未満なら全国平均より店が多い＝競合は多めです。
</p>

<p><a class="cta" href="../../?lat=${lat.toFixed(5)}&lng=${lon.toFixed(5)}&r=1000&ind=food">${esc(name)}駅を地図で見る・半径や業種を変える →</a></p>

<h2>この圏内の規模</h2>
<ul>
<li>常住人口 ${fmt(all.pop)} 人（2020年10月1日）</li>
<li>圏内で働く人 ${fmt(all.daytimePop - all.pop)} 人（2021年6月1日・全産業の従業者数）</li>
<li>全産業の事業所 ${fmt(all.est)} 事業所</li>
</ul>

<footer class="src">
出典: 総務省・経済産業省「令和3年経済センサス‐活動調査」および総務省統計局「令和2年国勢調査」の
500mメッシュ統計（e-Stat 統計GIS、世界測地系JGD2011）を加工して作成。
事業所は店舗と一致しません（本社・事務所・無店舗事業所を含みます）。
<a href="../../">競合密度マップ トップ</a>
</footer>
</main>
</body>
</html>
`;
}

// ---- 生成 ----
mkdirSync(OUT, { recursive: true });

// 1次メッシュ順に並べてキャッシュのヒット率を上げる
const list = [];
for (const [name, arr] of Object.entries(stations)) {
  const [en, lat, lon] = arr[0];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  list.push({ name, en, lat, lon });
}
list.sort((a, b) => (`${Math.floor(a.lat * 1.5)}${Math.floor(a.lon) - 100}`)
  .localeCompare(`${Math.floor(b.lat * 1.5)}${Math.floor(b.lon) - 100}`));

const made = [];
let skipped = 0;
for (const st of list) {
  const sum = circleAt(st.lat, st.lon, RADIUS);
  const all = summary(sum, "all", { night: baseline.night.all, day: baseline.day.all });
  // 事業所が少なすぎる圏はページにしても情報がないので出さない（薄いページを作らない）
  if (all.est < 100) { skipped++; continue; }
  const rows = INDUSTRIES.filter((i) => i.id !== "all").map((i) => ({
    id: i.id, label: i.label,
    ...summary(sum, i.id, { night: baseline.night[i.id], day: baseline.day[i.id] }),
  }));
  const dir = join(OUT, st.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page(st.name, st.en, st.lat, st.lon, rows, all));
  made.push(st);
}

// 一覧
const items = made.map((s) => `<li><a href="${slug(s.name)}/">${esc(s.name)}駅</a></li>`).join("\n");
writeFileSync(join(OUT, "index.html"), `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="${BASE}/eki/">
<title>駅別の競合密度一覧 — 競合密度マップ</title>
<meta name="description" content="全国${made.length}駅について、半径1km圏の業種別事業所数と1店あたり人口を掲載しています。">
<link rel="stylesheet" href="../style.css"></head>
<body class="doc"><header class="topbar"><h1><a href="../">競合密度マップ</a></h1></header>
<main class="prose"><h1>駅別の競合密度（半径1km）</h1>
<p>全国${made.length}駅について、半径1km圏の業種別事業所数・1店あたり人口・全国平均との比を掲載しています。</p>
<ul class="cols">
${items}
</ul></main></body></html>
`);

// sitemap / robots / llms.txt
const urls = [`${BASE}/`, `${BASE}/eki/`, ...made.map((s) => `${BASE}/eki/${slug(s.name)}/`)];
writeFileSync(join(WEB, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `<url><loc>${u}</loc></url>`).join("\n") + `\n</urlset>\n`);
writeFileSync(join(WEB, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(join(WEB, "llms.txt"), `# 競合密度マップ

> 日本国内の任意の地点について、半径Rの円内にある業種別の事業所数と「1店あたり人口」を、
> 全国平均との比で返す無料ツール。出店検討の競合スクリーニング用。

## 指標の定義

- 1店あたり人口 = 分母人口 ÷ 圏内の当該業種の事業所数
- 分母人口（昼間ベース）= 常住人口 + 圏内で働く人（全産業の従業者数）
  - 常住人口だけを分母にすると繁華街・オフィス街で値が壊れるため。
    例: 新宿駅1km圏は常住人口24,300人に対し飲食店2,367事業所＝「10人に1店」
  - これは代理指標であり昼間人口そのものではない。同じ区画に住みかつ働く人を二重に数え、
    買い物客・観光客を含まない
- 全国比 = その地点の1店あたり人口 ÷ 全国平均の1店あたり人口
  - 100%未満 = 全国平均より店が多い（競合は多め）／125%超 = 手薄
- 平均店舗規模 = 圏内の当該業種の従業者数 ÷ 事業所数

## 全国平均の1店あたり人口（昼間ベース）

${INDUSTRIES.filter((i) => i.id !== "all").map((i) => `- ${i.label}: ${fmt(baseline.day[i.id])}人（全国${fmt(baseline.est[i.id])}事業所）`).join("\n")}

## データ

- 事業所・従業者: 令和3年(2021)経済センサス‐活動調査 産業中分類別 500mメッシュ（e-Stat、JGD2011、調査日2021-06-01）
- 人口・世帯: 令和2年(2020)国勢調査 500mメッシュ（e-Stat、JGD2011、調査日2020-10-01）
- 全国合計は公表確定値と一致（事業所5,288,889／公表5,288,891、従業者62,427,891／公表62,427,908、常住人口126,146,090／公表126,146,099）

## 注意

- 事業所は店舗と一致しない（本社・事務所・無店舗事業所を含む）
- 直近の開店・閉店は反映されない（調査は5年周期）

## ページ

- ${BASE}/ — 地図で任意地点を指定するツール本体
- ${BASE}/eki/ — 駅別の一覧（${made.length}駅）
`);

console.log(`生成: ${made.length}駅 / スキップ(事業所100未満): ${skipped} / 合計${list.length}駅`);
console.log(`sitemap: ${urls.length} URL`);
