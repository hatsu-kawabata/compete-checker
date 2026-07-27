#!/usr/bin/env python3
"""web/data/*.json から全国の基準値（1店あたり人口）を前計算して web/data/baseline.json を書く。

需給インデックス = その場所の1店あたり人口 / 基準値。1未満なら全国より店が多い＝過密。

基準値は2本作る:
  night : Σ常住人口 / Σ事業所数
  day   : Σ(常住人口 + 全産業従業者数) / Σ事業所数   ← UIの主指標

都道府県別の基準値はメッシュコード→都道府県の対応表が要るのでv0では作らない
（全国だけで「全国平均の何倍か」は言える）。

使い方: python3 scripts/build_baseline.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "data"

# web/compete.js / build_data.py と同じ並び。meta.json から読むので二重定義しない。
META = json.loads((DATA / "meta.json").read_text())
IDS = [i["id"] for i in META["industries"]]
ALL_K = IDS.index("all")


def main() -> None:
    files = sorted(f for f in DATA.glob("*.json") if f.stem.isdigit())
    if not files:
        raise SystemExit("web/data/ に 1次メッシュのJSONがありません。build_data.py を先に実行してください")

    pop_sum = 0
    emp_all_sum = 0
    est_sum = [0] * len(IDS)
    cells = 0

    for f in files:
        for row in json.loads(f.read_text()):
            # row = [meshcode, pop, hh, e0, w0, e1, w1, ...]
            cells += 1
            pop_sum += row[1]
            emp_all_sum += row[3 + ALL_K * 2 + 1]
            for k in range(len(IDS)):
                est_sum[k] += row[3 + k * 2]

    day_pop = pop_sum + emp_all_sum
    night = {IDS[k]: (pop_sum / est_sum[k]) for k in range(len(IDS)) if est_sum[k] > 0}
    day = {IDS[k]: (day_pop / est_sum[k]) for k in range(len(IDS)) if est_sum[k] > 0}

    # 取得済みの区画だけで計算した値を「全国平均」と名乗らせない。
    # 全国は1次メッシュ約150区画。それに満たないうちは範囲を明示する。
    FULL = 140
    scope = "全国" if len(files) >= FULL else f"取得済み{len(files)}区画"
    if len(files) < FULL:
        print(f"⚠ 1次メッシュが {len(files)}/{FULL}区画 しかありません。"
              f"基準値は全国値ではなく『{scope}』として書き出します。\n")

    out = {
        "scope": scope,
        "partial": len(files) < FULL,
        "meshFiles": len(files),
        "cells": cells,
        "pop": pop_sum,
        "empAll": emp_all_sum,
        "est": {IDS[k]: est_sum[k] for k in range(len(IDS))},
        "night": {k: round(v, 1) for k, v in night.items()},
        "day": {k: round(v, 1) for k, v in day.items()},
    }
    (DATA / "baseline.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))

    print(f"1次メッシュ {len(files)} ファイル / {cells:,} セル")
    print(f"常住人口 {pop_sum:,} / 全産業従業者 {emp_all_sum:,} / 昼間ベースの分母 {day_pop:,}\n")
    print(f"{'業種':<24}{'事業所数':>12}{'1店/夜間':>12}{'1店/昼間':>12}")
    for k, i in enumerate(IDS):
        if est_sum[k] == 0:
            continue
        label = META["industries"][k]["label"]
        print(f"{label:<24}{est_sum[k]:>12,}{night[i]:>12,.0f}{day[i]:>12,.0f}")


if __name__ == "__main__":
    main()
