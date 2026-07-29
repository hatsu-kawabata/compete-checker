#!/usr/bin/env python3
"""IndexNowでURLを検索エンジンに直接通知する（実験01・02と同じ方式）。

api.indexnow.org に出すと参加エンジン(Bing・Yandex・Seznam・Naver)へ配信される。
新規ドメインのクロール予算の制約を受けない経路なので、被リンクゼロの立ち上がりでは
サイトマップより先に効く可能性がある。ChatGPT/CopilotはBing索引を引くため、
ここが通ることはLLMO仮説の分母づくりでもある。

実験01との差: このサイトの sitemap.xml には lastmod がなく差分台帳も持たないので、
--changed は用意していない（差分通知が要るようになったら lastmod 台帳ごと移植する）。

使い方:
  python3 scripts/indexnow.py --all
  python3 scripts/indexnow.py --all --dry-run
"""
import argparse
import json
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SITE = "https://compete-checker.vercel.app"
HOST = "compete-checker.vercel.app"
# 公開が前提の鍵(web/{KEY}.txt として配信し、それが所有権の証明になる)
# 実験01・02と同じ鍵を使う。IndexNowの鍵はホストごとに鍵ファイルの実在で検証されるので、
# 同じ文字列を複数ホストで使ってよい。
KEY = "42f540e0e565ee0164d56ad410aa23f1"
ENDPOINT = "https://api.indexnow.org/indexnow"
BATCH = 10000
NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def write_key_file() -> Path:
    p = WEB / f"{KEY}.txt"
    p.write_text(KEY + "\n")
    return p


def verify_key_live() -> None:
    """通知の前に本番の鍵ファイルを実際に引く。

    鍵が配信されていなければIndexNowは403で弾く。先に自分で確かめておくと、
    『送ったのに入らない』の原因が鍵なのか索引側なのかを取り違えずに済む。
    """
    url = f"{SITE}/{KEY}.txt"
    with urllib.request.urlopen(url, timeout=30) as r:
        body = r.read().decode().strip()
    if r.status != 200 or body != KEY:
        raise SystemExit(f"鍵ファイルが本番で確認できない: {url} status={r.status} body={body!r}")
    print(f"鍵ファイル確認: {url} = {body}")


def sitemap_urls() -> list[str]:
    root = ET.parse(WEB / "sitemap.xml").getroot()
    return [u.find(f"{NS}loc").text for u in root.findall(f"{NS}url")]


def submit(urls: list[str], dry_run: bool) -> None:
    for i in range(0, len(urls), BATCH):
        chunk = urls[i:i + BATCH]
        payload = {"host": HOST, "key": KEY, "keyLocation": f"{SITE}/{KEY}.txt",
                   "urlList": chunk}
        if dry_run:
            print(f"[dry-run] {len(chunk)} urls -> {ENDPOINT} (先頭: {chunk[0]})")
            continue
        req = urllib.request.Request(
            ENDPOINT, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                print(f"{len(chunk)} urls -> {r.status} {r.reason}")
        except urllib.error.HTTPError as e:
            print(f"{len(chunk)} urls -> {e.code} {e.reason}: {e.read().decode()[:300]}")
            raise SystemExit(1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", required=True,
                    help="sitemap.xmlの全URLを通知")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    p = write_key_file()
    urls = sitemap_urls()
    print(f"鍵ファイル: {p.relative_to(ROOT)} / 通知対象 {len(urls)} URL")
    if not urls:
        print("対象なし")
        return
    if not args.dry_run:
        verify_key_live()
    submit(urls, args.dry_run)


if __name__ == "__main__":
    main()
