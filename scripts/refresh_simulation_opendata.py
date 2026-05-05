#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Télécharge les GTFS 3M (Urbain + Suburbain), fusionne les CSV essentiels,
régénère simulation_data.json. Voir LIENS_OPENDATA_TAM.md pour les URLs.

Modes :
  monthly  — périmètre complet GTFS (--routes-scope all)
  daily    — TaM récent (--routes-scope tam_core) puis fusion avec les lignes non-TaM
             déjà présentes dans simulation_data.json (pour ne pas perdre sous-traitance
             entre deux passe mensuelles).

Usage (à la racine du dépôt) :
  python scripts/refresh_simulation_opendata.py --mode monthly
  python scripts/refresh_simulation_opendata.py --mode daily
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone

# Racine dépôt = parent du dossier scripts/
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GTFS_PUBLIC_URBA = "https://data.montpellier3m.fr/GTFS/Urbain/GTFS.zip"
GTFS_PUBLIC_SUB = "https://data.montpellier3m.fr/GTFS/Suburbain/GTFS.zip"

REQUIRED_MERGE_FILENAMES = ("routes.txt", "trips.txt", "stop_times.txt", "stops.txt")


def repo_import_build():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    import build_simulator_data as bd  # pylint: disable=import-outside-toplevel

    return bd


def download(url: str, dest_path: str) -> None:
    urllib.request.urlretrieve(url, dest_path)  # noqa: S310 stdlib téléchargements HTTP


def unzip_to_dir(zip_path: str, directory: str) -> None:
    with zipfile.ZipFile(zip_path, "r") as archive:
        archive.extractall(directory)


def _find_gtfs_txt_roots(extract_roots: list[str]) -> list[str]:
    """Chaque jeu décompressé doit contenir stops.txt quelque part (racine ou sous-dossier)."""
    out = []
    for root in extract_roots:
        for dirpath, _dirnames, filenames in os.walk(root):
            if "stops.txt" in filenames:
                out.append(dirpath)
                break
        else:
            raise FileNotFoundError(f"stops.txt introuvable sous {root}")
    return out


def merge_gtfs_into(directory_out: str, zip_urls: tuple[str, ...]) -> None:
    if os.path.isdir(directory_out):
        shutil.rmtree(directory_out)
    os.makedirs(directory_out, exist_ok=True)

    tmp_root = tempfile.mkdtemp(prefix="gtfs-fetch-")
    try:
        extract_dirs = []
        for idx, url in enumerate(zip_urls):
            zpath = os.path.join(tmp_root, f"f{idx}.zip")
            print(f"Téléchargement {url}")
            download(url, zpath)
            sub = os.path.join(tmp_root, f"extract_{idx}")
            os.makedirs(sub)
            unzip_to_dir(zpath, sub)
            extract_dirs.append(sub)

        csv_roots = _find_gtfs_txt_roots(extract_dirs)

        for name in REQUIRED_MERGE_FILENAMES:
            merged_rows: list[dict] = []
            fieldnames: list[str] = []
            seen_cols: set[str] = set()
            sources_used: list[str] = []
            file_paths = []
            for gdir in csv_roots:
                csv_path = os.path.join(gdir, name)
                if os.path.isfile(csv_path):
                    file_paths.append(csv_path)

            for csv_path in file_paths:
                sources_used.append(csv_path)
                with open(csv_path, "r", encoding="utf-8-sig", newline="") as handle:
                    reader = csv.DictReader(handle)
                    if not reader.fieldnames:
                        continue
                    for fn in reader.fieldnames:
                        if fn not in seen_cols:
                            seen_cols.add(fn)
                            fieldnames.append(fn)
                    for row in reader:
                        merged_rows.append(row)

            dest = os.path.join(directory_out, name)
            if not fieldnames:
                raise RuntimeError(f"Aucune source GTFS exploitable pour {name}")
            normalized = [{k: (row.get(k) if row.get(k) is not None else "") for k in fieldnames} for row in merged_rows]
            with open(dest, "w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(normalized)
            print(f"{name}: {len(normalized)} lignes depuis {len(sources_used)} flux")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def sort_patterns(patterns: list[dict]) -> None:
    patterns.sort(
        key=lambda p: (
            str(p["route_short_name"]),
            p["headsign"],
            p["direction_id"],
            p["variant_name"],
            p["stop_count"],
        )
    )


def network_line_code_normalized(feat: dict, bd) -> str:
    raw = feat.get("line_code") or ""
    return bd.clean_line_name(str(raw))


def merge_network_segments(
    prev_list: list,
    tam_list: list,
    bd,
) -> list:
    tam_set = set(bd.TAM_CORE_ROUTE_CODES)
    kept_prev = []
    for f in prev_list:
        if network_line_code_normalized(f, bd) not in tam_set:
            kept_prev.append(f)
    return kept_prev + list(tam_list)


def blend_daily_with_previous(tam_payload: dict, previous_path: str, bd) -> dict:
    with open(previous_path, "r", encoding="utf-8") as handle:
        previous = json.load(handle)

    prev_patterns = previous.get("patterns") or []
    tam_set = bd.TAM_CORE_ROUTE_CODES

    delegated = [p for p in prev_patterns if str(p.get("route_short_name", "")).strip() not in tam_set]
    blended_patterns = list(tam_payload.get("patterns") or []) + delegated
    sort_patterns(blended_patterns)

    prev_bus = previous.get("bus_network_features") or []
    prev_tram = previous.get("tram_network_features") or []
    tam_bus = tam_payload.get("bus_network_features") or []
    tam_tram = tam_payload.get("tram_network_features") or []

    blended_bus = merge_network_segments(prev_bus, tam_bus, bd)
    blended_tram = merge_network_segments(prev_tram, tam_tram, bd)

    prev_meta_at = (previous.get("meta") or {}).get("generated_at", "")

    uniq_routes = len({str(p.get("route_short_name", "")).strip() for p in blended_patterns if p.get("route_short_name")})

    meta_out = dict(tam_payload.get("meta") or {})
    meta_out.update(
        {
            "routes_scope": "blend_tam_daily_rest_monthly_source",
            "generated_at": datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z"),
            "pattern_count": len(blended_patterns),
            "route_count": uniq_routes,
            "bus_network_feature_count": len(blended_bus),
            "tram_network_feature_count": len(blended_tram),
            "delegated_patterns_snapshot_generated_at": prev_meta_at or None,
        }
    )

    return {
        "meta": meta_out,
        "patterns": blended_patterns,
        "bus_network_features": blended_bus,
        "tram_network_features": blended_tram,
    }


def write_json(payload: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def main() -> int:
    os.chdir(REPO_ROOT)
    bd = repo_import_build()
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("monthly", "daily"), required=True)
    args = parser.parse_args()

    gtfs_dest = bd.GTFS_DIR
    merge_gtfs_into(gtfs_dest, (GTFS_PUBLIC_URBA, GTFS_PUBLIC_SUB))

    outfile = bd.OUTPUT_JSON

    if args.mode == "monthly":
        payload = bd.build_data(routes_scope="all")
        write_json(payload, outfile)
        print(f"Monthly OK → {outfile} patterns={payload['meta']['pattern_count']}")
        return 0

    tam_payload = bd.build_data(routes_scope="tam_core")
    if os.path.isfile(outfile):
        blended = blend_daily_with_previous(tam_payload, outfile, bd)
        write_json(blended, outfile)
        print(
            f"Daily blend OK → {outfile} patterns={blended['meta']['pattern_count']} "
            "(TaM depuis Open Data, autres lignes = copie dernier jeu complet)."
        )
    else:
        write_json(tam_payload, outfile)
        print(
            f"Avertissement : pas de {outfile} existant → écrit tam_core uniquement. "
            "Lancer une passe monthly (--mode monthly) dès que possible.",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
