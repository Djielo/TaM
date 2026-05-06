from __future__ import annotations

import csv
import io
import os
import time
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock

from flask import Flask, jsonify, make_response, request
from google.transit import gtfs_realtime_pb2


GTFS_URBAIN_ZIP_URL = "https://data.montpellier3m.fr/GTFS/Urbain/GTFS.zip"
GTFS_SUBURBAIN_ZIP_URL = "https://data.montpellier3m.fr/GTFS/Suburbain/GTFS.zip"
TRIP_UPDATE_URBAIN_URL = "https://data.montpellier3m.fr/GTFS/Urbain/TripUpdate.pb"
TRIP_UPDATE_SUBURBAIN_URL = "https://data.montpellier3m.fr/GTFS/Suburbain/TripUpdate.pb"

HTTP_TIMEOUT_SECONDS = 20
TRIP_UPDATE_CACHE_SECONDS = int(os.environ.get("TAM_TRIP_UPDATE_CACHE_SECONDS", "15"))
GTFS_ROUTE_CACHE_SECONDS = int(os.environ.get("TAM_GTFS_ROUTE_CACHE_SECONDS", str(6 * 3600)))
DEFAULT_LIMIT = 4
MAX_LIMIT = 8

DEFAULT_ALLOWED_ORIGINS = (
    "https://djielo.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


def _allowed_origins() -> set[str]:
    raw = os.environ.get("TAM_API_ALLOWED_ORIGINS", "")
    if not raw.strip():
        return set(DEFAULT_ALLOWED_ORIGINS)
    return {x.strip() for x in raw.split(",") if x.strip()}


ALLOWED_ORIGINS = _allowed_origins()


def clean_line_name(raw_short_name: str) -> str:
    digits = "".join(ch for ch in str(raw_short_name or "") if ch.isdigit())
    if digits:
        return digits
    return str(raw_short_name or "").strip()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def download_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "tam-realtime-api/1.0"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS) as resp:
        return resp.read()


@dataclass(frozen=True)
class FeedSource:
    name: str
    gtfs_zip_url: str
    trip_update_url: str


FEED_SOURCES = (
    FeedSource("urbain", GTFS_URBAIN_ZIP_URL, TRIP_UPDATE_URBAIN_URL),
    FeedSource("suburbain", GTFS_SUBURBAIN_ZIP_URL, TRIP_UPDATE_SUBURBAIN_URL),
)


class TimedCache:
    def __init__(self, ttl_seconds: int):
        self.ttl_seconds = ttl_seconds
        self.lock = Lock()
        self.value = None
        self.expires_at = 0.0

    def get(self, loader):
        now = time.time()
        with self.lock:
            if self.value is not None and now < self.expires_at:
                return self.value, True
            self.value = loader()
            self.expires_at = now + self.ttl_seconds
            return self.value, False


route_cache = TimedCache(GTFS_ROUTE_CACHE_SECONDS)
trip_update_caches = {
    source.name: TimedCache(TRIP_UPDATE_CACHE_SECONDS) for source in FEED_SOURCES
}


def load_route_index() -> dict:
    by_short_name: dict[str, set[str]] = {}
    by_route_id: dict[str, str] = {}
    loaded_sources: list[str] = []

    for source in FEED_SOURCES:
        blob = download_bytes(source.gtfs_zip_url)
        with zipfile.ZipFile(io.BytesIO(blob), "r") as archive:
            with archive.open("routes.txt", "r") as handle:
                text = io.TextIOWrapper(handle, encoding="utf-8-sig", newline="")
                reader = csv.DictReader(text)
                for row in reader:
                    route_id = str(row.get("route_id") or "").strip()
                    short = clean_line_name(row.get("route_short_name") or "")
                    if not route_id or not short:
                        continue
                    by_route_id[route_id] = short
                    by_short_name.setdefault(short, set()).add(route_id)
        loaded_sources.append(source.name)

    return {
        "by_short_name": by_short_name,
        "by_route_id": by_route_id,
        "sources": loaded_sources,
        "loaded_at": utc_now_iso(),
    }


def load_trip_updates(source: FeedSource) -> gtfs_realtime_pb2.FeedMessage:
    blob = download_bytes(source.trip_update_url)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(blob)
    return feed


def get_route_ids(route_query: str | None, route_index: dict) -> set[str]:
    if not route_query:
        return set()
    raw = str(route_query).strip()
    cleaned = clean_line_name(raw)
    by_short_name = route_index["by_short_name"]
    by_route_id = route_index["by_route_id"]
    route_ids = set(by_short_name.get(cleaned, set()))
    if raw in by_route_id:
        route_ids.add(raw)
    if cleaned in by_route_id:
        route_ids.add(cleaned)
    return route_ids


def stop_time_epoch(stop_time_update) -> int | None:
    if stop_time_update.HasField("arrival") and stop_time_update.arrival.time:
        return int(stop_time_update.arrival.time)
    if stop_time_update.HasField("departure") and stop_time_update.departure.time:
        return int(stop_time_update.departure.time)
    return None


def collect_arrivals(stop_id: str, route: str | None, limit: int) -> dict:
    route_index, route_cache_hit = route_cache.get(load_route_index)
    route_ids = get_route_ids(route, route_index)
    now = int(time.time())
    arrivals = []
    cache_hits = {}

    for source in FEED_SOURCES:
        feed, hit = trip_update_caches[source.name].get(lambda s=source: load_trip_updates(s))
        cache_hits[source.name] = hit
        for entity in feed.entity:
            if not entity.HasField("trip_update"):
                continue
            trip_update = entity.trip_update
            trip = trip_update.trip
            trip_route_id = str(trip.route_id or "").strip()
            if route and trip_route_id not in route_ids:
                continue
            for stu in trip_update.stop_time_update:
                if str(stu.stop_id or "").strip() != stop_id:
                    continue
                epoch = stop_time_epoch(stu)
                if not epoch:
                    continue
                seconds = epoch - now
                if seconds < -30:
                    continue
                arrivals.append(
                    {
                        "route_id": trip_route_id,
                        "route_short_name": route_index["by_route_id"].get(trip_route_id, ""),
                        "trip_id": str(trip.trip_id or ""),
                        "direction_id": str(trip.direction_id or ""),
                        "source": source.name,
                        "epoch": epoch,
                        "seconds": seconds,
                        "minutes": max(0, round(seconds / 60)),
                    }
                )

    arrivals.sort(key=lambda x: (x["epoch"], x["route_short_name"], x["trip_id"]))
    deduped = []
    seen = set()
    for item in arrivals:
        # Certains arrêts de pôle exposent deux trip_ids au même timestamp
        # (ex. deux sens/terminus sur la même ligne). Pour l’affichage voyageur,
        # un même passage ligne + heure ne doit apparaître qu’une seule fois.
        key = (item["route_id"], item["epoch"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
        if len(deduped) >= limit:
            break

    return {
        "ok": True,
        "generated_at": utc_now_iso(),
        "stop_id": stop_id,
        "route": route or "",
        "route_ids": sorted(route_ids),
        "limit": limit,
        "cache": {
            "routes": route_cache_hit,
            "trip_updates": cache_hits,
        },
        "arrivals": deduped,
    }


app = Flask(__name__)


@app.after_request
def add_cors_headers(resp):
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
        resp.headers["Access-Control-Max-Age"] = "600"
    return resp


@app.route("/arrivals", methods=["OPTIONS"])
def arrivals_options():
    return make_response("", 204)


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "tam-api", "generated_at": utc_now_iso()})


@app.get("/arrivals")
def arrivals():
    stop_id = str(request.args.get("stop_id") or "").strip()
    route = str(request.args.get("route") or "").strip() or None
    if not stop_id:
        return jsonify({"ok": False, "error": "missing_stop_id"}), 400
    try:
        limit = int(request.args.get("limit") or DEFAULT_LIMIT)
    except ValueError:
        limit = DEFAULT_LIMIT
    limit = max(1, min(MAX_LIMIT, limit))
    try:
        return jsonify(collect_arrivals(stop_id, route, limit))
    except Exception as exc:  # noqa: BLE001 - API boundary, returns clean JSON
        return jsonify({"ok": False, "error": "arrivals_failed", "detail": str(exc)}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)
