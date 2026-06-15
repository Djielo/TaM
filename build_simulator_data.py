#!/usr/bin/env python3
# -*- coding: utf-8 -*-

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


def dedupe_patterns_by_branch_endpoints(patterns):
    """
    Garde une seule variante par branche GTFS (même sens, headsign, départ et arrivée).

    Deux cas dans le flux Urbain :
    - Écart de 1–2 arrêts (ex. T1) : séquences quasi identiques → garder la plus courte.
    - Écart plus large (ex. T4 boucle Peyrou 19 arr. vs raccourci Antigone 14 arr.) :
      branches réelles différentes → garder la course la plus fréquente.
    """
    buckets = {}
    for pattern in patterns:
        key = (
            pattern["route_id"],
            pattern["direction_id"],
            pattern["headsign"],
            pattern["start_stop"],
            pattern["end_stop"],
        )
        buckets.setdefault(key, []).append(pattern)

    kept = []
    for group in buckets.values():
        stop_counts = [item["stop_count"] for item in group]
        span = max(stop_counts) - min(stop_counts)
        if span <= 2:
            min_stops = min(stop_counts)
            candidates = [item for item in group if item["stop_count"] == min_stops]
            best = max(candidates, key=lambda item: item.get("trip_count", 0))
        else:
            best = max(group, key=lambda item: item.get("trip_count", 0))
        kept.append(best)
    return kept


def renumber_pattern_variants(patterns, route_by_id):
    """Réattribue Variante 1..n après fusion de doublons."""
    groups = defaultdict(list)
    for pattern in patterns:
        groups[(pattern["route_id"], pattern["direction_id"], pattern["headsign"])].append(
            pattern
        )

    renumbered = []
    for (route_id, direction_id, headsign), items in groups.items():
        line_name = route_by_id[route_id]["route_short_name"]
        is_tram = str(route_by_id[route_id].get("route_type", "")) == "0"
        if is_tram:
            items.sort(
                key=lambda item: (
                    -item.get("trip_count", 0),
                    -item["stop_count"],
                    item["start_stop"],
                )
            )
        else:
            items.sort(
                key=lambda item: (
                    item["stop_count"],
                    item["start_stop"],
                    -item.get("trip_count", 0),
                )
            )
        for idx, pattern in enumerate(items, start=1):
            pattern["pattern_id"] = (
                f"{line_name}-{direction_id}-{headsign or 'sans_terminus'}-V{idx}"
            )
            pattern["variant_name"] = f"Variante {idx}"
            renumbered.append(pattern)
    return renumbered


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


# --- T4 : corrections métier sur le GTFS brut (courses partielles, quai Gare, raccourcis) ---
T4_LEGACY_GARE_STOP_IDS = frozenset({"1192", "1235"})
T4_GARE_REPUBLIQUE_BY_DIRECTION = {"0": "1706", "1": "1730"}
T4_ANTIGONE_SHORTCUT_STOP_IDS = frozenset({"1090", "1091", "1104", "1105"})
T4_LOOP_HEADSIGNS = frozenset({"Garcia Lorca A", "Garcia Lorca B"})
T4_GARE_HEADSIGNS = frozenset({"Gare Saint-Roch A", "Gare Saint-Roch B"})
T4_TERMINUS_GARCIA = "Garcia Lorca"


def normalize_t4_stop_row(stop_row, direction_id, stops_by_id):
    """
    Sur la T4, l'arrêt desservi à la Gare est le quai République (1706/1730).
    Les stop_id 1192/1235 pointent un autre quai GTFS (hors tracé officiel 3M).
    """
    sid = str(stop_row.get("stop_id", ""))
    if sid not in T4_LEGACY_GARE_STOP_IDS:
        return stop_row
    repl = T4_GARE_REPUBLIQUE_BY_DIRECTION.get(str(direction_id or "").strip())
    if not repl or repl not in stops_by_id:
        return stop_row
    canonical = stops_by_id[repl]
    out = dict(stop_row)
    out["stop_id"] = repl
    out["stop_name"] = canonical["stop_name"]
    out["lat"] = canonical["lat"]
    out["lon"] = canonical["lon"]
    return out


def refresh_pattern_geometry_fields(pattern, stops_list):
    pattern["stops"] = stops_list
    pattern["stop_count"] = len(stops_list)
    pattern["coordinates"] = [[s["lat"], s["lon"]] for s in stops_list]
    pattern["start_stop"] = stops_list[0]["stop_name"]
    pattern["end_stop"] = stops_list[-1]["stop_name"]
    pattern["pattern_signature"] = compute_pattern_signature(
        pattern["route_id"],
        pattern["direction_id"],
        pattern["headsign"],
        stops_list,
    )


def is_official_t4_pattern(pattern):
    """Parcours T4 exploités : boucles Garcia↔Garcia ou Garcia→Gare République."""
    headsign = (pattern.get("headsign") or "").strip()
    start = (pattern.get("start_stop") or "").strip()
    end = (pattern.get("end_stop") or "").strip()
    stop_ids = {str(s["stop_id"]) for s in pattern.get("stops") or []}

    if stop_ids & T4_ANTIGONE_SHORTCUT_STOP_IDS:
        return False

    if headsign in T4_LOOP_HEADSIGNS:
        return start == T4_TERMINUS_GARCIA and end == T4_TERMINUS_GARCIA

    if headsign in T4_GARE_HEADSIGNS:
        return start == T4_TERMINUS_GARCIA and "République" in end

    return False


def apply_t4_official_corrections(patterns, stops_by_id):
    """
    Normalise le quai Gare, écarte les courses partielles (ex. Observatoire→Garcia Lorca,
    Nouveau Saint-Roch→Garcia Lorca) et les raccourcis Antigone, fusionne les doublons.
    """
    kept_other = [p for p in patterns if str(p.get("route_short_name", "")) != "4"]
    t4_by_sequence = {}
    for pattern in patterns:
        if str(pattern.get("route_short_name", "")) != "4":
            continue
        direction_id = str(pattern.get("direction_id") or "").strip()
        normalized = [
            normalize_t4_stop_row(row, direction_id, stops_by_id)
            for row in pattern.get("stops") or []
        ]
        if len(normalized) < 2:
            continue
        refresh_pattern_geometry_fields(pattern, normalized)
        if not is_official_t4_pattern(pattern):
            continue
        seq_key = (
            pattern["route_id"],
            pattern["direction_id"],
            pattern["headsign"],
            tuple(str(s["stop_id"]) for s in normalized),
        )
        if seq_key in t4_by_sequence:
            t4_by_sequence[seq_key]["trip_count"] += pattern.get("trip_count", 0)
        else:
            t4_by_sequence[seq_key] = pattern
    return kept_other + list(t4_by_sequence.values())


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


TRAM_NETWORK_MAX_START_CROSS_M = 120.0
# Courses GTFS rattachées à une ligne tram mais dont le départ n’est pas sur la voie 3M.
TRAM_BLOCKED_BRANCH_STARTS = frozenset(
    {
        ("1", "observatoire"),
    }
)


def _point_to_segment_dist_deg(px, py, ax, ay, bx, by):
    dx = bx - ax
    dy = by - ay
    if abs(dx) < 1e-12 and abs(dy) < 1e-12:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    qx = ax + t * dx
    qy = ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def min_cross_track_meters_to_polylines(lat, lon, polylines):
    if not polylines:
        return 0.0
    best_deg = float("inf")
    for coords in polylines:
        if not coords or len(coords) < 2:
            continue
        for i in range(len(coords) - 1):
            a = coords[i]
            b = coords[i + 1]
            d = _point_to_segment_dist_deg(lat, lon, a[0], a[1], b[0], b[1])
            if d < best_deg:
                best_deg = d
    if best_deg == float("inf"):
        return float("inf")
    return best_deg * 111000.0


def fold_stop_label(text):
    import unicodedata

    s = unicodedata.normalize("NFD", str(text or ""))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.lower().strip()


def tram_features_by_line(tram_network_features):
    grouped = defaultdict(list)
    for feature in tram_network_features or []:
        code = str(feature.get("line_code") or "").strip()
        coords = feature.get("coordinates") or []
        if code and len(coords) >= 2:
            grouped[code].append(coords)
    return grouped


def pattern_start_cross_track_m(pattern, tram_by_line):
    line = str(pattern.get("route_short_name") or "").strip()
    stops = pattern.get("stops") or []
    if not line or not stops:
        return 0.0
    first = stops[0]
    try:
        lat = float(first.get("lat"))
        lon = float(first.get("lon"))
    except (TypeError, ValueError):
        return float("inf")
    return min_cross_track_meters_to_polylines(lat, lon, tram_by_line.get(line, []))


def is_tram_pattern_kept(pattern, route_by_id, tram_by_line):
    route = route_by_id.get(pattern.get("route_id"), {})
    if str(route.get("route_type", "")) != "0":
        return True
    line = str(pattern.get("route_short_name") or "").strip()
    start_key = fold_stop_label(pattern.get("start_stop"))
    if (line, start_key) in TRAM_BLOCKED_BRANCH_STARTS:
        return False
    cross_m = pattern_start_cross_track_m(pattern, tram_by_line)
    return cross_m <= TRAM_NETWORK_MAX_START_CROSS_M


def apply_tram_network_alignment_filter(patterns, route_by_id, tram_network_features):
    """Écarte les courses tram dont le départ GTFS est hors voie Open Data (ex. T1 Observatoire)."""
    tram_by_line = tram_features_by_line(tram_network_features)
    kept = []
    for pattern in patterns:
        if is_tram_pattern_kept(pattern, route_by_id, tram_by_line):
            kept.append(pattern)
    return kept


def build_data():
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

    numbered_patterns = apply_t4_official_corrections(numbered_patterns, stops_by_id)
    numbered_patterns = dedupe_patterns_by_branch_endpoints(numbered_patterns)

    raw_bus_network = read_network_geojson("MMM_MMM_BusLigne.json")
    raw_tram_network = read_network_geojson("MMM_MMM_LigneTram.json")
    bus_network_features = parse_network_features(raw_bus_network, ["num_commercial", "num_exploitation"])
    tram_network_features = parse_network_features(raw_tram_network, ["num_exploitation", "num_commercial"])

    numbered_patterns = apply_tram_network_alignment_filter(
        numbered_patterns, route_by_id, tram_network_features
    )
    numbered_patterns = renumber_pattern_variants(numbered_patterns, route_by_id)

    numbered_patterns.sort(
        key=lambda p: (
            str(p["route_short_name"]),
            p["headsign"],
            p["direction_id"],
            p["variant_name"],
            p["stop_count"],
        )
    )

    dataset_digest = compute_dataset_digest(GTFS_DIR)

    return {
        "meta": {
            "source": "GTFS TAM",
            "generator": "build_simulator_data.py:v2_fingerprints",
            "generated_at": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "dataset_digest": dataset_digest,
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
    data = build_data()
    with open(OUTPUT_JSON, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    print(f"Fichier généré: {OUTPUT_JSON}")
    print(f"Patterns: {data['meta']['pattern_count']}")


if __name__ == "__main__":
    main()
