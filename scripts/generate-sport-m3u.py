from __future__ import annotations
import base64
import json
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import os

EVENTS_API = "https://api.cdnlivetv.tv/api/v1/events/sports/?user=cdnlivetv&plan=free"
if os.environ.get("GITHUB_ACTIONS") == "true":
    OUTPUT_FILE = Path(__file__).resolve().parent.parent / "SPORTS.m3u"
else:
    OUTPUT_FILE = Path(__file__).resolve().parent.parent / "data" / ".SPORTS.m3u"
OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
MAX_WORKERS = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
    ),
    "Referer": "https://cdnlivetv.tv/",
}

STREAM_REFERER = "https://cdnlivetv.tv/"
STREAM_UA      = HEADERS["User-Agent"]


def http_get(url: str, timeout: int = 15) -> Optional[str]:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def fetch_all_channels() -> list[dict]:
    body = http_get(EVENTS_API)
    if not body:
        return []
    try:
        data = json.loads(body).get("cdn-live-tv", {})
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parse: {e}", file=sys.stderr)
        return []

    channels = {}
    for _category, events in data.items():
        if not isinstance(events, list):
            continue
        for event in events:
            for ch in event.get("channels", []):
                name = ch.get("channel_name", "").strip()
                if not name:
                    continue
                key = name.lower()
                if key not in channels:
                    channels[key] = {
                        "name":  name,
                        "url":   ch.get("url", ""),
                    }
    return sorted(list(channels.values()), key=lambda x: x["name"])


def _b64decode(s: str) -> str:
    s = s.replace("-", "+").replace("_", "/")
    while len(s) % 4:
        s += "="
    try:
        return base64.b64decode(s).decode("utf-8", errors="replace")
    except Exception:
        return ""


def extract_m3u8(html: str) -> Optional[str]:
    decoded: set[str] = set()
    for b64_val in re.findall(r"var\s+\w+\s*=\s*'([A-Za-z0-9+/=_-]+)'", html):
        v = _b64decode(b64_val)
        if v:
            decoded.add(v)

    channel_id = next((v for v in decoded if re.fullmatch(r"[0-9a-f]{24}", v)), None)
    token_qs   = next((v for v in decoded if v.startswith("?token=")), None)

    if channel_id and token_qs:
        return f"https://cdnlivetv.tv/secure/api/v1/{channel_id}/playlist.m3u8{token_qs}"

    m = re.search(r"https://[^\s\"']+playlist\.m3u8[^\s\"']*", html)
    return m.group() if m else None


def resolve_channel(ch: dict) -> tuple[dict, Optional[str]]:
    html = http_get(ch["url"])
    m3u8_url = extract_m3u8(html) if html else None
    return ch, m3u8_url


def main() -> None:
    print("[*] Fetching active channels...")
    channels = fetch_all_channels()
    if not channels:
        print("[ERROR] No channels found.", file=sys.stderr)
        sys.exit(1)

    total = len(channels)
    print(f"[*] Found {total} unique channel(s). Resolving stream URLs in parallel (workers={MAX_WORKERS})...")

    resolved_channels = []
    success_count = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(resolve_channel, ch): ch for ch in channels}
        for idx, future in enumerate(as_completed(futures), 1):
            try:
                ch, m3u8_url = future.result()
                status = "OK" if m3u8_url else "FAILED"
                print(f"[{idx}/{total}] Resolving: {ch['name']} ... {status}")
                if m3u8_url:
                    resolved_channels.append((ch, m3u8_url))
                    success_count += 1
            except Exception as e:
                ch = futures[future]
                print(f"[{idx}/{total}] Resolving: {ch['name']} ... ERROR: {e}")

    resolved_channels.sort(key=lambda x: x[0]["name"])

    playlist_lines = ["#EXTM3U\n"]
    for ch, m3u8_url in resolved_channels:
        playlist_lines.append(
            f'#EXTINF:-1 tvg-name="{ch["name"]}" group-title="Sports",{ch["name"]}'
        )
        playlist_lines.append(f"#EXTVLCOPT:http-user-agent={STREAM_UA}")
        playlist_lines.append(f"#EXTVLCOPT:http-referrer={STREAM_REFERER}")
        playlist_lines.append(f"{m3u8_url}\n")

    OUTPUT_FILE.write_text("\n".join(playlist_lines) + "\n", encoding="utf-8")
    print(f"[*] Done. Generated playlist with {success_count}/{total} channels → {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
