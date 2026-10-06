"""SITREP collector.

Pulls news feeds and open data, tags every item by region and theme,
and writes JSON files that the dashboard reads.

Run:  python collect.py
Each part fails independently, so one broken source never stops the rest.
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests

# Everything lives in one folder: settings, data files and the web page sit side by side
ROOT = Path(__file__).resolve().parent
CONFIG = ROOT
OUT = ROOT

NOW = datetime.now(timezone.utc)
KEEP_DAYS = 14          # how long news items stay on the dashboard
MAX_ITEMS = 1500        # cap on stored news items
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 SITREP/1.0",
    "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    "Accept-Language": "en-GB,en;q=0.8",
}
TIMEOUT = 25

# Short names that only count when written in capitals (so "us" the word is not the United States)
ACRONYMS = {
    "us", "uk", "eu", "uae", "idf", "drc", "pla", "rsf", "imf", "wto", "irgc", "dprk",
    "npt", "iaea", "ais", "wti", "lng", "opec", "ofac", "ofsi", "iom", "unhcr", "icbm",
    "nato", "brics", "pdvsa", "m23", "g7", "g20", "5g", "p&i",
}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(name: str, data) -> None:
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# ---------------------------------------------------------------- tagging
def build_matcher(terms: list[str]):
    """One regex per group of terms. Acronyms match in capitals only."""
    plain = [t for t in terms if t.lower() not in ACRONYMS]
    caps = [t for t in terms if t.lower() in ACRONYMS]
    parts = []
    if plain:
        parts.append(re.compile(r"(?<![\w-])(" + "|".join(re.escape(t) for t in sorted(plain, key=len, reverse=True)) + r")(?![\w-])", re.I))
    if caps:
        parts.append(re.compile(r"(?<![\w-])(" + "|".join(re.escape(t.upper()) for t in caps) + r")(?![\w-])"))
    return parts


def count_hits(matchers, text: str) -> int:
    return sum(len(m.findall(text)) for m in matchers)


class Tagger:
    def __init__(self):
        themes = load_json(CONFIG / "themes.json", {})
        regions = load_json(CONFIG / "regions.json", {})
        self.themes = {k: build_matcher(v["keywords"]) for k, v in themes.items()}
        self.regions = {}
        self.countries = {}
        for rkey, r in regions.items():
            all_terms = []
            for country, aliases in r["places"].items():
                self.countries[country] = (rkey, build_matcher(aliases))
                all_terms += aliases
            self.regions[rkey] = build_matcher(all_terms)

    def tag(self, title: str, summary: str, feed: dict) -> dict:
        # Title counts double: it is the clearest signal of what the story is about
        text = f"{title} {title} {summary}"
        themes = [k for k, m in self.themes.items() if count_hits(m, text) >= (1 if count_hits(m, title) else 2)]
        if feed.get("theme_hint") and feed["theme_hint"] not in themes:
            themes.append(feed["theme_hint"])

        region_scores = {k: count_hits(m, text) for k, m in self.regions.items()}
        regions = [k for k, s in region_scores.items() if s > 0]
        if not regions and feed.get("region_hint"):
            regions = [feed["region_hint"]]
        if not regions:
            regions = ["global"]
        countries = [c for c, (_, m) in self.countries.items() if count_hits(m, title + " " + summary)]
        return {"themes": themes, "regions": regions, "countries": countries[:6]}


# ---------------------------------------------------------------- news feeds
def clean(text: str, limit: int = 400) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text[:limit].rsplit(" ", 1)[0] + "…" if len(text) > limit else text


def entry_time(e) -> datetime:
    for key in ("published_parsed", "updated_parsed"):
        t = e.get(key)
        if t:
            return datetime.fromtimestamp(time.mktime(t), tz=timezone.utc)
    return NOW


def collect_news(tagger: Tagger) -> tuple[list, list]:
    sources = load_json(CONFIG / "sources.json", {}).get("feeds", [])
    previous = load_json(OUT / "news.json", {})
    # Sample stories are only for previewing; never mix them with real news
    existing = {} if previous.get("sample") else {i["id"]: i for i in previous.get("items", [])}
    status = []
    cutoff = NOW - timedelta(days=KEEP_DAYS)
    seen_titles = {re.sub(r"\W+", "", i["title"].lower())[:80] for i in existing.values()}

    for feed in sources:
        new = 0
        try:
            parsed, note = None, ""
            for url in [feed["url"]] + ([feed["fallback"]] if feed.get("fallback") else []):
                try:
                    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
                    resp.raise_for_status()
                    parsed = feedparser.parse(resp.content)
                    if not parsed.entries:
                        raise ValueError("feed returned no articles")
                    note = "" if url == feed["url"] else "via backup feed"
                    break
                except Exception as exc:  # noqa: BLE001 - try the backup before giving up
                    parsed, last_error = None, exc
            if parsed is None:
                raise last_error
            for e in parsed.entries[:60]:
                title = clean(e.get("title", ""), 220)
                if "news.google.com" in (e.get("link") or ""):
                    title = re.sub(r"\s+-\s+[^-]{2,60}$", "", title)  # Google News adds " - Publisher"
                link = e.get("link", "")
                if not title or not link:
                    continue
                published = entry_time(e)
                if published < cutoff:
                    continue
                uid = hashlib.sha1(link.encode()).hexdigest()[:16]
                key = re.sub(r"\W+", "", title.lower())[:80]
                if uid in existing or key in seen_titles:
                    continue
                summary = clean(e.get("summary", "") or e.get("description", ""))
                existing[uid] = {
                    "id": uid,
                    "title": title,
                    "summary": summary,
                    "url": link,
                    "source": feed["name"],
                    "group": feed["group"],
                    "published": published.isoformat(),
                    **tagger.tag(title, summary, feed),
                }
                seen_titles.add(key)
                new += 1
            status.append({"name": feed["name"], "group": feed["group"], "ok": True, "new": new, "note": note})
            log(f"  ok   {feed['name']}: {new} new")
        except Exception as exc:  # noqa: BLE001 - one bad feed must not stop the run
            status.append({"name": feed["name"], "group": feed["group"], "ok": False, "new": 0, "note": str(exc)[:160]})
            log(f"  FAIL {feed['name']}: {exc}")

    items = [i for i in existing.values() if i["published"] >= cutoff.isoformat()]
    items.sort(key=lambda i: i["published"], reverse=True)
    return items[:MAX_ITEMS], status


# ---------------------------------------------------------------- sanctions + vessels
def collect_sanctions() -> dict | None:
    """Recent designations and the sanctioned-vessel list from OpenSanctions."""
    url = load_json(CONFIG / "sources.json", {})["data_sources"]["opensanctions"]["url"]
    recent_cutoff = (NOW - timedelta(days=30)).date().isoformat()
    vessels, recent = [], []
    with requests.get(url, headers=HEADERS, timeout=120, stream=True) as resp:
        resp.raise_for_status()
        lines = (line.decode("utf-8", "replace") for line in resp.iter_lines())
        for row in csv.DictReader(lines):
            schema = row.get("schema", "")
            first_seen = (row.get("first_seen") or "")[:10]
            entry = {
                "name": row.get("name", ""),
                "type": schema,
                "countries": row.get("countries", ""),
                "programs": clean(row.get("sanctions", ""), 160),
                "datasets": row.get("dataset", ""),
                "first_seen": first_seen,
                "id": row.get("id", ""),
            }
            if schema == "Vessel":
                ident = row.get("identifiers", "")
                imo = re.search(r"IMO\s?(\d{7})", ident) or re.search(r"\b(\d{7})\b", ident)
                entry["imo"] = imo.group(1) if imo else ""
                vessels.append(entry)
            if first_seen >= recent_cutoff and schema in {"Person", "Company", "Organization", "LegalEntity", "Vessel"}:
                recent.append(entry)
    vessels.sort(key=lambda v: v["first_seen"], reverse=True)
    recent.sort(key=lambda v: v["first_seen"], reverse=True)
    return {"updated": NOW.isoformat(), "recent": recent[:500], "recent_total": len(recent),
            "vessels": vessels[:2000], "vessel_total": len(vessels)}


# ---------------------------------------------------------------- energy prices
def collect_energy() -> dict | None:
    key = os.environ.get("EIA_API_KEY")
    if not key:
        raise RuntimeError("EIA_API_KEY not set (add it as a GitHub Secret)")
    series = load_json(CONFIG / "sources.json", {})["data_sources"]["eia"]["series"]
    out = {"updated": NOW.isoformat(), "series": {}}
    for label, sid in series.items():
        r = requests.get(f"https://api.eia.gov/v2/seriesid/{sid}", params={"api_key": key}, headers=HEADERS, timeout=TIMEOUT)
        r.raise_for_status()
        rows = r.json().get("response", {}).get("data", [])
        points = sorted(((d["period"], float(d["value"])) for d in rows if d.get("value") not in (None, "")), key=lambda p: p[0])
        out["series"][label] = [{"date": p, "value": v} for p, v in points[-180:]]
    return out


# ---------------------------------------------------------------- main
def run_part(name: str, fn, status: list):
    try:
        data = fn()
        save_json(f"{name}.json", data)
        status.append({"name": name, "ok": True, "note": ""})
        log(f"{name}: saved")
    except Exception as exc:  # noqa: BLE001
        status.append({"name": name, "ok": False, "note": str(exc)[:200]})
        log(f"{name}: skipped - {exc}")


def save_meta() -> None:
    """Region and theme names for the dashboard (copied from the config files)."""
    themes = load_json(CONFIG / "themes.json", {})
    regions = load_json(CONFIG / "regions.json", {})
    save_json("meta.json", {
        "themes": {k: {"label": v["label"]} for k, v in themes.items()},
        "regions": {k: {"label": v["label"]} for k, v in regions.items()},
        "countries": {c: k for k, v in regions.items() for c in v["places"]},
        "feed_count": len(load_json(CONFIG / "sources.json", {}).get("feeds", [])),
    })


def main(parts: list[str]) -> None:
    save_meta()
    status = {"updated": NOW.isoformat(), "feeds": [], "data": []}
    if "news" in parts:
        log("Collecting news feeds…")
        items, feed_status = collect_news(Tagger())
        save_json("news.json", {"updated": NOW.isoformat(), "items": items})
        status["feeds"] = feed_status
        log(f"news: {len(items)} items stored")
    for name, fn in (("sanctions", collect_sanctions), ("energy", collect_energy)):
        if name in parts:
            run_part(name, fn, status["data"])
    old = load_json(OUT / "status.json", {})
    if "news" not in parts:
        status["feeds"] = old.get("feeds", [])
    kept = {d["name"]: d for d in old.get("data", []) if d["name"] in ("sanctions", "energy")}
    kept.update({d["name"]: d for d in status["data"]})
    status["data"] = list(kept.values())
    save_json("status.json", status)


if __name__ == "__main__":
    main(sys.argv[1:] or ["news", "sanctions", "energy"])
