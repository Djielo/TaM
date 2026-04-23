#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import os
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GTFS_DIR = os.path.join(BASE_DIR, "gtfs_data")
OUTPUT_JSON = os.path.join(BASE_DIR, "simulation_data.json")


def read_csv(filename):
    path = os.path.join(GTFS_DIR, filename)
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def clean_line_name(raw_short_name):
    digits = "".join(ch for ch in raw_short_name if ch.isdigit())
    if digits:
        return digits
    return raw_short_name.strip()


def read_bus_network_geojson():
    local_geojson = os.path.join(BASE_DIR, "MMM_MMM_BusLigne.json")
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
                if "MMM_MMM_BusLigne.json" not in archive.namelist():
                    continue
                payload = archive.read("MMM_MMM_BusLigne.json").decode("utf-8-sig")
                return json.loads(payload)
        except (OSError, zipfile.BadZipFile, KeyError, json.JSONDecodeError):
            continue
    return None


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

        patterns[key] = {
            "pattern_id": "",
            "route_id": route_id,
            "route_short_name": route_by_id[route_id]["route_short_name"],
            "route_long_name": route_by_id[route_id]["route_long_name"],
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

    raw_bus_network = read_bus_network_geojson()
    bus_network_features = []
    if raw_bus_network and isinstance(raw_bus_network.get("features"), list):
        for feature in raw_bus_network["features"]:
            props = feature.get("properties") or {}
            geom = feature.get("geometry") or {}
            coords = geom.get("coordinates") or []
            if geom.get("type") != "LineString" or len(coords) < 2:
                continue

            line_number = str(props.get("num_commercial", "")).strip()
            if not line_number:
                continue

            # GeoJSON stores points as [lon, lat].
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

            bus_network_features.append(
                {
                    "num_commercial": line_number,
                    "nom_ligne": str(props.get("nom_ligne", "")).strip(),
                    "sens": str(props.get("sens", "")).strip(),
                    "reseau": str(props.get("reseau", "")).strip(),
                    "coordinates": latlon_coordinates,
                }
            )

    return {
        "meta": {
            "source": "GTFS TAM",
            "route_count": len(route_by_id),
            "pattern_count": len(numbered_patterns),
            "bus_network_feature_count": len(bus_network_features),
        },
        "patterns": numbered_patterns,
        "bus_network_features": bus_network_features,
    }


def main():
    data = build_data()
    with open(OUTPUT_JSON, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    print(f"Fichier généré: {OUTPUT_JSON}")
    print(f"Patterns: {data['meta']['pattern_count']}")


if __name__ == "__main__":
    main()
