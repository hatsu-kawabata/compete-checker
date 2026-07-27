#!/usr/bin/env python3
"""人口(国勢調査2020) と 事業所(経済センサス2021) を1次メッシュ単位でマージして静的JSONを作る。

出力: web/data/{1次メッシュ}.json = [[meshcode, pop, hh, e0, w0, e1, w1, ...], ...]
      web/data/manifest.json      = 存在する1次メッシュコードの一覧
      web/data/meta.json          = 業種定義(compete.js と順序を一致させる正本)

両ソースとも**世界測地系 JGD2011**で揃えること（揃っていないと同じメッシュコードが
わずかに違う領域を指す）:
  人口   T001141 = 令和2年国勢調査 人口及び世帯 (JGD2011, 500m)  ← shoken_maker が取得済み
  事業所 T001163 = 令和3年経済センサス-活動調査 産業(中分類)別事業所数及び従業者数 (JGD2011, 500m)

使い方:
  STATS_ID=T001163 python3 ~/shoken_maker/scripts/fetch_mesh.py --sweep  # 事業所zipを raw/ へ
  python3 scripts/build_data.py
"""
import json
import os
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "web" / "data"
POP_DIR = Path(os.environ.get("POP_DIR", Path.home() / "shoken_maker" / "web" / "data"))

STATS_ID = "T001163"

# 業種プリセット。(id, 表示名, 事業所数の列コード)
# 順序が web/compete.js の INDUSTRIES と一致していることを scripts/test.mjs が固定する。
INDUSTRIES = [
    ("all",        "全産業",                 "T001163001"),
    ("food",       "飲食店",                 "T001163082"),
    ("takeout",    "持ち帰り・配達飲食",      "T001163083"),
    ("hotel",      "宿泊業",                 "T001163081"),
    ("grocery",    "飲食料品小売",           "T001163065"),
    ("apparel",    "衣服・身の回り品小売",    "T001163064"),
    ("machinery",  "機械器具小売",           "T001163066"),
    ("retail",     "その他の小売",           "T001163067"),
    ("beauty",     "洗濯・理容・美容・浴場",  "T001163085"),
    ("amusement",  "娯楽業",                 "T001163087"),
    ("school",     "学習塾・その他の教育",    "T001163090"),
    ("medical",    "医療業",                 "T001163092"),
    ("welfare",    "社会福祉・介護",         "T001163094"),
    ("realestate", "不動産賃貸業・管理業",    "T001163073"),
]

# 人口JSONの列位置(shoken_maker の web/data 形式)
POP_I, HH_I = 1, 4


def read_est(code: str):
    """事業所zip → {meshcode: [e0, w0, e1, w1, ...]}。従業者数は総数のみ(男女は捨てる)。"""
    zp = RAW / f"{STATS_ID}_{code}.zip"
    if not zp.exists():
        return {}
    with zipfile.ZipFile(zp) as z:
        text = z.open(z.namelist()[0]).read().decode("cp932", "replace")
    lines = text.splitlines()
    codes = lines[0].split(",")
    labels = [s.strip() for s in lines[1].split(",")]
    pos = {c: i for i, c in enumerate(codes)}

    # 従業者数(総数)列 = 同じラベルの2回目の出現。1回目が事業所数。
    est_i, emp_i = [], []
    for _, _, col in INDUSTRIES:
        i = pos[col]
        occ = [j for j, l in enumerate(labels) if j > 0 and l == labels[i]]
        if len(occ) < 2:
            raise SystemExit(f"{col}: 従業者数列が見つからない (occ={occ})")
        est_i.append(occ[0])
        emp_i.append(occ[1])

    out = {}
    for line in lines[2:]:
        if not line.strip():
            continue
        p = line.split(",")
        vals = []
        for a, b in zip(est_i, emp_i):
            for i in (a, b):
                v = p[i] if i < len(p) else "0"
                vals.append(int(v) if v.lstrip("-").isdigit() else 0)
        if any(vals):
            out[p[0]] = vals
    return out


def read_pop(code: str):
    """人口JSON → {meshcode: (pop, hh)}"""
    fp = POP_DIR / f"{code}.json"
    if not fp.exists():
        return {}
    rows = json.loads(fp.read_text())
    out = {}
    for r in rows:
        pop = r[POP_I] if isinstance(r[POP_I], int) else 0
        hh = r[HH_I] if isinstance(r[HH_I], int) else 0
        out[r[0]] = (pop, hh)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    codes = sorted({m.group(1) for f in RAW.iterdir()
                    if (m := re.fullmatch(rf"{STATS_ID}_(\d{{4}})\.zip", f.name))})
    if not codes:
        raise SystemExit(f"raw/ に {STATS_ID}_*.zip がありません")

    nz = len(INDUSTRIES) * 2
    manifest, total_cells, total_bytes = [], 0, 0
    for code in codes:
        est = read_est(code)
        pop = read_pop(code)
        keys = sorted(set(est) | set(pop))
        rows = []
        for k in keys:
            p, h = pop.get(k, (0, 0))
            v = est.get(k)
            if not v and not p and not h:
                continue
            rows.append([k, p, h] + (v if v else [0] * nz))
        if not rows:
            continue
        body = json.dumps(rows, separators=(",", ":"))
        (OUT / f"{code}.json").write_text(body)
        manifest.append(code)
        total_cells += len(rows)
        total_bytes += len(body)
        print(f"{code}: {len(rows):>6,} メッシュ  {len(body)/1024/1024:5.2f} MB")

    # 形式は商圏メーカー/ポスティング計算機と揃える（app.js が manifest.meshes を見る）
    (OUT / "manifest.json").write_text(json.dumps({"meshes": manifest}, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps({
        "statsId": STATS_ID,
        "datum": "JGD2011",
        "popSurvey": "令和2年国勢調査 500mメッシュ (T001141, JGD2011)",
        "estSurvey": "令和3年経済センサス-活動調査 産業(中分類)別事業所数及び従業者数 (T001163, JGD2011)",
        "industries": [{"id": i, "label": l, "col": c} for i, l, c in INDUSTRIES],
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"\n計 {len(manifest)} ファイル / {total_cells:,} メッシュ / {total_bytes/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
