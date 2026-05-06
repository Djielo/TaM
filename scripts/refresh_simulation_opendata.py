#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Télécharge les données Open Data nécessaires et régénère simulation_data.json.

- GTFS Urbain + Suburbain : fusion minimale des CSV (routes/trips/stop_times/stops)
- Tracés réseau (GeoJSON lignes) : Bus + Tram (pour un rendu carte « nickel »)

Usage :
  python scripts/refresh_simulation_opendata.py
"""

from __future__ import annotations

import csv
import os
import shutil
import tempfile
import time
from urllib.error import URLError
import urllib.request
import zipfile


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GTFS_DIR = os.path.join(REPO_ROOT, "gtfs_data")

GTFS_PUBLIC_URBA = "https://data.montpellier3m.fr/GTFS/Urbain/GTFS.zip"
GTFS_PUBLIC_SUB = "https://data.montpellier3m.fr/GTFS/Suburbain/GTFS.zip"

OPEN_DATA_RESOURCES_BASE = "https://data.montpellier3m.fr/sites/default/files/ressources"
NETWORK_GEOJSON_FILES = (
    "MMM_MMM_LigneTram.json",
    "MMM_MMM_BusLigne.json",
)

REQUIRED_MERGE_FILENAMES = ("routes.txt", "trips.txt", "stop_times.txt", "stops.txt")


def download(url: str, dest_path: str, *, timeout: int = 60, retries: int = 3) -> None:
    """Téléchargement robuste (UA + timeout + retries) pour CI."""
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "tam-sim-refresh/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                blob = resp.read()
            with open(dest_path, "wb") as handle:
                handle.write(blob)
            return
        except (URLError, OSError, TimeoutError) as exc:
            last_err = exc
            wait = min(2**attempt, 10)
            print(f"Téléchargement en échec (tentative {attempt}/{retries}) : {url} ({exc})")
            time.sleep(wait)
    raise RuntimeError(f"Échec téléchargement après {retries} tentatives : {url}") from last_err


def unzip_to_dir(zip_path: str, directory: str) -> None:
    with zipfile.ZipFile(zip_path, "r") as archive:
        archive.extractall(directory)


def _find_gtfs_txt_root(extract_root: str) -> str:
    """Trouve le dossier contenant stops.txt (racine ou sous-dossier)."""
    for dirpath, _dirnames, filenames in os.walk(extract_root):
        if "stops.txt" in filenames:
            return dirpath
    raise FileNotFoundError(f"stops.txt introuvable sous {extract_root}")


def merge_gtfs_into(directory_out: str, zip_urls: tuple[str, ...]) -> None:
    if os.path.isdir(directory_out):
        shutil.rmtree(directory_out)
    os.makedirs(directory_out, exist_ok=True)

    tmp_root = tempfile.mkdtemp(prefix="gtfs-fetch-")
    try:
        roots: list[str] = []
        for idx, url in enumerate(zip_urls):
            zpath = os.path.join(tmp_root, f"gtfs_{idx}.zip")
            print(f"Téléchargement GTFS : {url}")
            download(url, zpath)
            sub = os.path.join(tmp_root, f"extract_{idx}")
            os.makedirs(sub)
            unzip_to_dir(zpath, sub)
            roots.append(_find_gtfs_txt_root(sub))

        for name in REQUIRED_MERGE_FILENAMES:
            merged_rows: list[dict] = []
            fieldnames: list[str] = []
            seen_cols: set[str] = set()
            file_paths: list[str] = []
            for gdir in roots:
                csv_path = os.path.join(gdir, name)
                if os.path.isfile(csv_path):
                    file_paths.append(csv_path)
            if not file_paths:
                raise RuntimeError(f"Aucune source GTFS trouvée pour {name}")

            for csv_path in file_paths:
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
            normalized = [
                {k: (row.get(k) if row.get(k) is not None else "") for k in fieldnames}
                for row in merged_rows
            ]
            with open(dest, "w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(normalized)
            print(f"{name}: {len(normalized)} lignes")
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)


def fetch_network_geojson_layers() -> None:
    for fname in NETWORK_GEOJSON_FILES:
        url = f"{OPEN_DATA_RESOURCES_BASE}/{fname}"
        dest = os.path.join(REPO_ROOT, fname)
        print(f"Téléchargement géométrie réseau : {fname}")
        download(url, dest)


def main() -> int:
    os.chdir(REPO_ROOT)
    fetch_network_geojson_layers()
    merge_gtfs_into(GTFS_DIR, (GTFS_PUBLIC_URBA, GTFS_PUBLIC_SUB))
    # Génération JSON (utilise gtfs_data/ + MMM_MMM_*.json à la racine)
    import build_simulator_data as bd  # pylint: disable=import-outside-toplevel

    bd.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

