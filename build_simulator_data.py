#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import csv
import hashlib
import json
import os
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GTFS_DIR = os.path.join(BASE_DIR, "gtfs_data")
OUTPUT_JSON = os.path.join(BASE_DIR, "simulation_data.json")

# Codes « métier simulateur » = sortie GTFS après clean_line_name (T1→"1", bus inchangé sauf extraction chiffres).
TAM_CORE_ROUTE_CODES = frozenset(
    {
        "1",
        "2",
        "3",
        "4",
        "5",  # T1..T5
        "A",
        "6",
        "7",
        "8",
        "10",
        "11",
        "13",
        "14",
        "15",
        "16",
        "17",
        "19",
        "52",
        "53",
    }
)


def compute_dataset_digest(gtfs_dir_path):
    """Empreinte stable du sous-ensemble GTFS utilisé pour le simulateur."""
    blobs = []
    for name in ("routes.txt", "trips.txt", "stop_times.txt", "stops.txt"):
        path = os.path.join(gtfs_dir_path, name)
        if os.path.isfile(path):
            blobs.append(name.encode("utf-8"))
            with open(path, "rb") as handle:
                blobs.append(handle.read())
    if not blobs:
        return ""
    joint = hashlib.sha256(b"\0".join(blobs)).hexdigest()
    return joint


def compute_pattern_signature(route_id, direction_id, headsign, stops_list):
    """Identifiant de contenu : route, sens métier GTFS et chaîne d'arrêts."""
    stop_ids = "|".join(str(s["stop_id"]) for s in stops_list)
    raw = "|".join(
        [
            str(route_id),
            str(direction_id or ""),
            str(headsign or ""),
            stop_ids,
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def read_csv(filename):
    path = os.path.join(GTFS_DIR, filename)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def clean_line_name(raw_short_name):
    digits = "".join(ch for ch in raw_short_name if ch.isdigit())
    if digits:
        return digits
    return raw_short_name.strip()


def read_network_geojson(resource_name):
    local_geojson = os.path.join(BASE_DIR, resource_name)
    if os.path.exists(local_geojson):
        with open(local_geojson, "r", encoding="utf-8") as handle:
            return json.load(handle)

    for filename in os.listdir(BASE_DIR):
        if not filename.lower().endswith(".zip"):
            continue
        if filename == "GTFS.zip":
            continue
        archive_path = os.path.join(BASE_DIR, filename)
        try:
            with zipfile.ZipFile(archive_path, "r") as archive:
                if resource_name not in archive.namelist():
                    continue
                payload = archive.read(resource_name).decode("utf-8-sig")
                return json.loads(payload)
        except (OSError, zipfile.BadZipFile, KeyError, json.JSONDecodeError):
            continue
    return None


def parse_network_features(raw_geojson, line_key_candidates):
    features = []
    if not raw_geojson or not isinstance(raw_geojson.get("features"), list):
        return features

    for feature in raw_geojson["features"]:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") != "LineString" or len(coords) < 2:
            continue

        line_code = ""
        for key in line_key_candidates:
            val = props.get(key)
            if val is None:
                continue
            line_code = str(val).strip()
            if line_code:
                break
        if not line_code:
            continue

        latlon_coordinates = []
        for point in coords:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            lon, lat = point[0], point[1]
            try:
                latlon_coordinates.append([float(lat), float(lon)])
            except (TypeError, ValueError):
                continue

        if len(latlon_coordinates) < 2:
            continue

        features.append(
            {
                "line_code": line_code,
                "nom_ligne": str(props.get("nom_ligne", "")).strip(),
                "sens": str(props.get("sens", "")).strip(),
                "reseau": str(props.get("reseau", "")).strip(),
                "coordinates": latlon_coordinates,
            }
        )
    return features


def filter_route_by_scope(route_by_id, routes_scope):
    if routes_scope == "all":
        return dict(route_by_id)
    keep = {}
    for rid, r in route_by_id.items():
        if r["route_short_name"] in TAM_CORE_ROUTE_CODES:
            keep[rid] = r
    return keep


def filter_network_features(features, routes_scope):
    if routes_scope == "all":
        return features
    out = []
    for feat in features:
        code = clean_line_name(feat.get("line_code") or "")
        if code in TAM_CORE_ROUTE_CODES:
            out.append(feat)
    return out


def build_data(routes_scope="all"):
    routes = read_csv("routes.txt")
    trips = read_csv("trips.txt")
    stop_times = read_csv("stop_times.txt")
    stops = read_csv("stops.txt")

    route_by_id = {}
    for route in routes:
        route_by_id[route["route_id"]] = {
            "route_id": route["route_id"],
            "route_short_name": clean_line_name(route.get("route_short_name", "")),
            "route_long_name": (route.get("route_long_name") or "").strip(),
            "route_type": route.get("route_type", ""),
            "route_color": route.get("route_color", "005CA9"),
        }

    route_by_id = filter_route_by_scope(route_by_id, routes_scope)

    # Only physical stops (location_type=0) are needed for mapping.
    stops_by_id = {}
    for stop in stops:
        if (stop.get("location_type") or "0") != "0":
            continue
        stop_id = stop["stop_id"]
        try:
            lat = float(stop["stop_lat"])
            lon = float(stop["stop_lon"])
        except (TypeError, ValueError):
            continue
        stops_by_id[stop_id] = {
            "stop_id": stop_id,
            "stop_name": (stop.get("stop_name") or "").strip(),
            "lat": lat,
            "lon": lon,
        }

    stop_times_by_trip = defaultdict(list)
    for row in stop_times:
        trip_id = row["trip_id"]
        stop_id = row["stop_id"]
        if stop_id not in stops_by_id:
            continue
        try:
            seq = int(row["stop_sequence"])
        except (TypeError, ValueError):
            continue
        stop_times_by_trip[trip_id].append(
            {
                "stop_id": stop_id,
                "stop_sequence": seq,
                "arrival_time": row.get("arrival_time", ""),
                "departure_time": row.get("departure_time", ""),
            }
        )

    for trip_id in stop_times_by_trip:
        stop_times_by_trip[trip_id].sort(key=lambda x: x["stop_sequence"])

    # Build unique patterns by route + direction + headsign + stop sequence.
    patterns = {}
    pattern_groups = defaultdict(list)
    for trip in trips:
        trip_id = trip["trip_id"]
        route_id = trip["route_id"]
        if route_id not in route_by_id:
            continue

        ordered = stop_times_by_trip.get(trip_id, [])
        if len(ordered) < 2:
            continue

        stop_sequence = tuple(item["stop_id"] for item in ordered)
        headsign = (trip.get("trip_headsign") or "").strip()
        direction_id = (trip.get("direction_id") or "").strip()

        key = (route_id, direction_id, headsign, stop_sequence)
        pattern_groups[(route_id, direction_id, headsign)].append(key)

        if key in patterns:
            patterns[key]["trip_count"] += 1
            continue

        first_stop = stops_by_id[ordered[0]["stop_id"]]
        last_stop = stops_by_id[ordered[-1]["stop_id"]]
        coordinates = [[stops_by_id[item["stop_id"]]["lat"], stops_by_id[item["stop_id"]]["lon"]] for item in ordered]
        stops_list = [
            {
                "stop_id": item["stop_id"],
                "stop_name": stops_by_id[item["stop_id"]]["stop_name"],
                "lat": stops_by_id[item["stop_id"]]["lat"],
                "lon": stops_by_id[item["stop_id"]]["lon"],
                "arrival_time": item["arrival_time"],
                "departure_time": item["departure_time"],
            }
            for item in ordered
        ]

        sig = compute_pattern_signature(route_id, direction_id, headsign, stops_list)

        patterns[key] = {
            "pattern_id": "",
            "pattern_signature": sig,
            "route_id": route_id,
            "route_short_name": route_by_id[route_id]["route_short_name"],
            "route_long_name": route_by_id[route_id]["route_long_name"],
            "route_type": route_by_id[route_id]["route_type"],
            "route_color": route_by_id[route_id]["route_color"],
            "direction_id": direction_id,
            "headsign": headsign,
            "start_stop": first_stop["stop_name"],
            "end_stop": last_stop["stop_name"],
            "stop_count": len(ordered),
            "trip_count": 1,
            "coordinates": coordinates,
            "stops": stops_list,
        }

    # Number variants per (line + direction + headsign).
    numbered_patterns = []
    for group_key, keys in pattern_groups.items():
        unique_keys = sorted(set(keys), key=lambda k: (len(k[3]), k[3][0], k[3][-1]))
        route_id, direction_id, headsign = group_key
        line_name = route_by_id[route_id]["route_short_name"]

        for idx, pattern_key in enumerate(unique_keys, start=1):
            pattern = patterns[pattern_key]
            pattern["pattern_id"] = f"{line_name}-{direction_id}-{headsign or 'sans_terminus'}-V{idx}"
            pattern["variant_name"] = f"Variante {idx}"
            numbered_patterns.append(pattern)

    numbered_patterns.sort(
        key=lambda p: (
            str(p["route_short_name"]),
            p["headsign"],
            p["direction_id"],
            p["variant_name"],
            p["stop_count"],
        )
    )

    raw_bus_network = read_network_geojson("MMM_MMM_BusLigne.json")
    raw_tram_network = read_network_geojson("MMM_MMM_LigneTram.json")
    bus_network_features = parse_network_features(raw_bus_network, ["num_commercial", "num_exploitation"])
    tram_network_features = parse_network_features(raw_tram_network, ["num_exploitation", "num_commercial"])
    bus_network_features = filter_network_features(bus_network_features, routes_scope)
    tram_network_features = filter_network_features(tram_network_features, routes_scope)

    dataset_digest = compute_dataset_digest(GTFS_DIR)

    return {
        "meta": {
            "source": "GTFS TAM",
            "generator": "build_simulator_data.py:v2_fingerprints",
            "generated_at": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "dataset_digest": dataset_digest,
            "routes_scope": routes_scope,
            "tam_core_route_codes": sorted(TAM_CORE_ROUTE_CODES, key=lambda c: (len(c), c)),
            "route_count": len(route_by_id),
            "pattern_count": len(numbered_patterns),
            "bus_network_feature_count": len(bus_network_features),
            "tram_network_feature_count": len(tram_network_features),
        },
        "patterns": numbered_patterns,
        "bus_network_features": bus_network_features,
        "tram_network_features": tram_network_features,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Génère simulation_data.json à partir de gtfs_data/ et réseaux 3M."
    )
    parser.add_argument(
        "--routes-scope",
        choices=("all", "tam_core"),
        default="all",
        help=(
            "all = tout le GTFS présent localement ; "
            "tam_core = uniquement le périmètre lignes exploitées TaM "
            "(T1 à T5, navette A, bus 6,7,8,10,…) — JSON plus léger pour MàJ ciblée."
        ),
    )
    args = parser.parse_args()
    data = build_data(routes_scope=args.routes_scope)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    print(f"Fichier généré: {OUTPUT_JSON}")
    print(f"Périmètre: {data['meta']['routes_scope']}")
    print(f"Patterns: {data['meta']['pattern_count']}")


if __name__ == "__main__":
    main()
