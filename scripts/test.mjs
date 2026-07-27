// node --test scripts/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { meshCentroid, primaryMeshesInBBox, circleBBox, aggregateCircle, meshCode1km } from "../web/mesh.js";
import {
  INDUSTRIES, VECTOR_WIDTH, POP, HH, estIndex, empIndex,
  readCircle, metrics, level, density, summary, daytimeProxy, CROWDED, SPARSE,
} from "../web/compete.js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const meta = JSON.parse(readFileSync(join(WEB, "data", "meta.json"), "utf8"));
let baseline = null;
try {
  baseline = JSON.parse(readFileSync(join(WEB, "data", "baseline.json"), "utf8"));
} catch { /* 全国データ未取得のうちは baseline なしでよい */ }

function cellsAround(lat, lon, r) {
  const [latMin, latMax, lonMin, lonMax] = circleBBox(lat, lon, r);
  const cells = [];
  for (const code of primaryMeshesInBBox(latMin, latMax, lonMin, lonMax)) {
    let rows;
    try {
      rows = JSON.parse(readFileSync(join(WEB, "data", `${code}.json`), "utf8"));
    } catch {
      continue;
    }
    for (const row of rows) {
      const [la, lo] = meshCentroid(row[0]);
      cells.push({ la, lo, v: row.slice(1) });
    }
  }
  return cells;
}

function circle(lat, lon, r) {
  return aggregateCircle(cellsAround(lat, lon, r), lat, lon, r, VECTOR_WIDTH).sum;
}

const SHINJUKU = { lat: 35.68953, lon: 139.69986 };

// --- データの同一性: 既存ツールの公開値を壊していないこと ---

test("新宿駅1km圏の世帯数が商圏メーカー/ポスティング計算機の公開値(17,579世帯)と一致する", () => {
  const sum = circle(SHINJUKU.lat, SHINJUKU.lon, 1000);
  assert.equal(Math.round(sum[HH]), 17579);
  assert.ok(Math.abs(Math.round(sum[POP]) - 24300) < 100, `pop=${Math.round(sum[POP])}`);
});

test("業種の順序が build_data.py の正本(meta.json)と一致する", () => {
  assert.equal(meta.industries.length, INDUSTRIES.length);
  meta.industries.forEach((m, i) => {
    assert.equal(m.id, INDUSTRIES[i].id, `index ${i}`);
    assert.equal(m.label, INDUSTRIES[i].label, `index ${i}`);
  });
  assert.equal(meta.datum, "JGD2011");
});

test("値ベクトルの幅が業種数と整合する", () => {
  assert.equal(VECTOR_WIDTH, 2 + INDUSTRIES.length * 2);
  const rows = JSON.parse(readFileSync(join(WEB, "data", "5339.json"), "utf8"));
  for (const row of rows.slice(0, 200)) assert.equal(row.length, 1 + VECTOR_WIDTH);
});

// 全国合計が政府の公表確定値と一致すること。取り込み漏れ・二重計上の一撃検出になる。
// 差はメッシュ境界の秘匿・合算処理に由来し、いずれも百万分の一未満。
test("全国合計が公表確定値と一致する（全国データ取得済みのときのみ）", { skip: !baseline || baseline.partial }, () => {
  assert.equal(baseline.scope, "全国");
  assert.equal(baseline.meshFiles, 150);
  // 令和2年国勢調査 確定値 126,146,099人
  assert.ok(Math.abs(baseline.pop - 126_146_099) <= 10, `常住人口=${baseline.pop}`);
  // 令和3年経済センサス-活動調査 確報 5,288,891事業所 / 62,427,908人
  assert.ok(Math.abs(baseline.est.all - 5_288_891) <= 10, `事業所数=${baseline.est.all}`);
  assert.ok(Math.abs(baseline.empAll - 62_427_908) <= 30, `従業者数=${baseline.empAll}`);
});

test("全国基準の1店あたり人口は業種の性格どおりの序列になる", { skip: !baseline || baseline.partial }, () => {
  const d = baseline.day;
  // 数が多い業種ほど1店あたり人口は小さい
  assert.ok(d.food < d.hotel, `飲食店${d.food} < 宿泊業${d.hotel}`);
  assert.ok(d.food < d.amusement, `飲食店${d.food} < 娯楽業${d.amusement}`);
  assert.ok(d.beauty < d.school, `理美容${d.beauty} < 学習塾${d.school}`);
  // 昼間ベースの分母は常住人口より大きいので、基準値も必ず夜間より大きい
  for (const id of Object.keys(d)) assert.ok(d[id] > baseline.night[id], id);
});

test("計測用の1kmメッシュコードは、その点を含む500mメッシュの上位8桁と一致する", () => {
  // 実データのコードで往復させる: コード→中心座標→1kmコード が先頭8桁に戻ること
  const rows = JSON.parse(readFileSync(join(WEB, "data", "5339.json"), "utf8"));
  let checked = 0;
  for (const row of rows.slice(0, 500)) {
    const code = row[0];
    const [la, lo] = meshCentroid(code);
    assert.equal(meshCode1km(la, lo), code.slice(0, 8), `code=${code}`);
    checked++;
  }
  assert.ok(checked >= 500);
  // 送る値に生の座標が含まれないこと(丸めの粒度は1km=8桁)
  assert.equal(meshCode1km(35.68953, 139.69986).length, 8);
});

test("メッシュ中心の復元: 9桁コード→緯度経度がセル幅の範囲に収まる", () => {
  const [la, lo] = meshCentroid("533945764");
  assert.ok(la > 35.6 && la < 35.8, `lat=${la}`);
  assert.ok(lo > 139.6 && lo < 139.8, `lon=${lo}`);
});

// --- 事業所側 ---

test("新宿駅1km圏の飲食店は千件規模で、全産業より少なく、宿泊業より多い", () => {
  const sum = circle(SHINJUKU.lat, SHINJUKU.lon, 1000);
  const food = readCircle(sum, "food");
  const all = readCircle(sum, "all");
  const hotel = readCircle(sum, "hotel");
  assert.ok(food.est > 1000 && food.est < 6000, `飲食店=${food.est}`);
  assert.ok(food.est < all.est, `${food.est} < ${all.est}`);
  assert.ok(hotel.est < food.est, `${hotel.est} < ${food.est}`);
  assert.ok(food.emp > food.est, "従業者数は事業所数より多い");
});

test("業種別の事業所数は全産業の内訳に収まる", () => {
  const sum = circle(SHINJUKU.lat, SHINJUKU.lon, 1000);
  const all = readCircle(sum, "all").est;
  let parts = 0;
  for (const { id } of INDUSTRIES) if (id !== "all") parts += readCircle(sum, id).est;
  assert.ok(parts <= all, `内訳計 ${parts} <= 全産業 ${all}`);
});

test("半径を広げると事業所数も人口も単調に増える", () => {
  const cells = cellsAround(SHINJUKU.lat, SHINJUKU.lon, 3000);
  let prevPop = -1, prevEst = -1;
  for (const r of [300, 500, 1000, 2000, 3000]) {
    const { sum } = aggregateCircle(cells, SHINJUKU.lat, SHINJUKU.lon, r, VECTOR_WIDTH);
    const { pop, est } = readCircle(sum, "food");
    assert.ok(pop > prevPop, `r=${r} pop=${pop}`);
    assert.ok(est > prevEst, `r=${r} est=${est}`);
    prevPop = pop; prevEst = est;
  }
});

test("データ範囲外(海上)は0で落ちない", () => {
  const lat = 30.0, lon = 150.0;
  const cells = cellsAround(lat, lon, 1000);
  const agg = aggregateCircle(cells, lat, lon, 1000, VECTOR_WIDTH);
  assert.equal(agg.cellCount, 0);
  assert.equal(agg.sum.length, VECTOR_WIDTH);
  assert.equal(readCircle(agg.sum, "food").est, 0);
});

// --- 指標 ---

test("1店あたり人口 = 人口 / 事業所数", () => {
  const m = metrics({ pop: 10000, est: 20, emp: 100, baselinePerStore: 500 });
  assert.equal(m.perStore, 500);
  assert.equal(m.index, 1);
  assert.equal(m.avgSize, 5);
  assert.equal(m.level, "average");
});

test("事業所0では1店あたり人口も需給インデックスもnull（無限に手薄とは言わない）", () => {
  const m = metrics({ pop: 10000, est: 0, emp: 0, baselinePerStore: 500 });
  assert.equal(m.perStore, null);
  assert.equal(m.index, null);
  assert.equal(m.avgSize, null);
  assert.equal(m.level, null);
});

test("基準値が無ければインデックスはnullだが1店あたり人口は出る", () => {
  const m = metrics({ pop: 10000, est: 20, emp: 0 });
  assert.equal(m.perStore, 500);
  assert.equal(m.index, null);
  assert.equal(m.level, null);
});

test("1店あたり人口が全国より少ないほど過密と判定する", () => {
  assert.equal(level(0.5), "crowded");
  assert.equal(level(CROWDED - 0.01), "crowded");
  assert.equal(level(1.0), "average");
  assert.equal(level(SPARSE + 0.01), "sparse");
  assert.equal(level(null), null);
});

test("密度は円の面積で割る", () => {
  const d = density(Math.PI, 1000); // 1km^2 あたり π 事業所 → π/π = 1
  assert.ok(Math.abs(d - 1) < 1e-9, `${d}`);
  assert.equal(density(5, 0), null);
});

test("新宿駅1km圏の飲食店は全国基準に対して過密側に出る", () => {
  const sum = circle(SHINJUKU.lat, SHINJUKU.lon, 1000);
  const { pop, est, emp } = readCircle(sum, "food");
  // 全国基準は未取得のため、暫定に東京圏(5339)の1店あたり人口を基準にしても過密に出ることを確認する
  const m = metrics({ pop, est, emp, baselinePerStore: 800 });
  assert.ok(m.perStore < 100, `新宿の1店あたり人口=${m.perStore}`);
  assert.equal(m.level, "crowded");
});

// --- 昼間人口の代理指標 ---

test("昼間代理 = 常住人口 + 全産業従業者数 で、オフィス街では夜間人口を大きく上回る", () => {
  const sum = circle(SHINJUKU.lat, SHINJUKU.lon, 1000);
  const all = readCircle(sum, "all");
  assert.equal(daytimeProxy(sum), all.pop + all.emp);
  assert.ok(daytimeProxy(sum) > all.pop * 10, "新宿は昼間代理が夜間人口の10倍超");
});

test("夜間人口で割ると新宿は無意味な値になり、昼間代理で割ると比較可能になる", () => {
  const sinjuku = summary(circle(SHINJUKU.lat, SHINJUKU.lon, 1000), "food");
  const musashi = summary(circle(35.5766, 139.6595, 1000), "food"); // 武蔵小杉(住宅地)
  // 夜間人口ベースでは、繁華街の新宿が住宅地より1桁「過密」に出てしまう
  assert.ok(sinjuku.night.perStore < 20, `新宿(夜間)=${sinjuku.night.perStore}`);
  assert.ok(musashi.night.perStore > 100, `武蔵小杉(夜間)=${musashi.night.perStore}`);
  // 昼間代理ベースでは同じ桁に収まり、なお新宿の方が過密という順序は保たれる
  assert.ok(sinjuku.day.perStore > 100, `新宿(昼間)=${sinjuku.day.perStore}`);
  assert.ok(sinjuku.day.perStore < musashi.day.perStore, "新宿の方が過密");
  assert.ok(musashi.day.perStore / sinjuku.day.perStore < 3, "同じ桁に収まる");
});

test("summaryは基準値を与えれば夜間・昼間それぞれのレベルを返す", () => {
  const s = summary(circle(SHINJUKU.lat, SHINJUKU.lon, 1000), "food",
    { night: 800, day: 800 });
  assert.equal(s.night.level, "crowded");
  assert.equal(s.day.level, "crowded");
  assert.equal(s.est, readCircle(circle(SHINJUKU.lat, SHINJUKU.lon, 1000), "food").est);
});

test("summaryはUIが読む値をすべてトップレベルに持つ（平均店舗規模は分母に依らない）", () => {
  const s = summary(circle(SHINJUKU.lat, SHINJUKU.lon, 1000), "food");
  for (const k of ["pop", "hh", "est", "emp", "daytimePop", "avgSize"]) {
    assert.notEqual(s[k], undefined, `summary.${k} が undefined`);
  }
  assert.equal(s.avgSize, s.emp / s.est);
  assert.equal(s.avgSize, s.night.avgSize);
  assert.equal(s.avgSize, s.day.avgSize);
  assert.ok(s.avgSize > 5 && s.avgSize < 30, `新宿の飲食店平均規模=${s.avgSize}`);
});
