#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import os
import zipfile
import requests
from collections import defaultdict

# URL du fichier GTFS (offre de transport TAM)
# (l'ancien endpoint /TAM_MMM_GTFSRT/GTFS.zip renvoie 404)
GTFS_URL = "https://data.montpellier3m.fr/sites/default/files/ressources/TAM_MMM_GTFS.zip"
GTFS_ZIP = "GTFS.zip"
EXTRACT_DIR = "gtfs_data"

# Fichiers CSV de sortie pour Anki
OUTPUT_SEQUENCE = "lignes_sequence.csv"
OUTPUT_CORRESP = "stations_correspondances.csv"
OUTPUT_CLOZE = "lignes_fiches_cloze.csv"

# Lignes de bus urbain (intramuros) que l'on souhaite conserver.
# Les autres lignes de bus (suburbaines) seront ignorées.
URBAN_BUS_LINES = {
    "6", "7", "8", "10", "11",
    "13", "14", "15", "16", "17",
    "19", "52", "53",
}

def telecharger_gtfs():
    """Télécharge le fichier GTFS s'il n'existe pas déjà."""
    if not os.path.exists(GTFS_ZIP):
        print("Téléchargement des données GTFS...")
        try:
            r = requests.get(GTFS_URL, stream=True)
            r.raise_for_status()
            with open(GTFS_ZIP, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            print("Téléchargement terminé.")
        except Exception as e:
            print(f"Erreur lors du téléchargement : {e}")
            return False
    else:
        print("Fichier GTFS.zip déjà présent.")
    return True

def extraire_gtfs():
    """Extrait le fichier zip dans le dossier gtfs_data."""
    if not os.path.exists(EXTRACT_DIR):
        os.makedirs(EXTRACT_DIR)
        with zipfile.ZipFile(GTFS_ZIP, 'r') as zip_ref:
            zip_ref.extractall(EXTRACT_DIR)
        print("Fichiers extraits.")
    else:
        print("Données déjà extraites.")

def lire_fichier_csv(nom_fichier):
    """Lit un fichier CSV et retourne une liste de dictionnaires."""
    chemin = os.path.join(EXTRACT_DIR, nom_fichier)
    if not os.path.exists(chemin):
        print(f"Attention : {nom_fichier} introuvable.")
        return []
    with open(chemin, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        return list(reader)

def obtenir_terminus(trip_id, trips, stop_times, stops):
    """Pour un trip donné, retourne le premier et dernier arrêt (nom)."""
    times = [st for st in stop_times if st['trip_id'] == trip_id]
    if not times:
        return None, None
    # Trier par stop_sequence
    times.sort(key=lambda x: int(x['stop_sequence']))
    premier_id = times[0]['stop_id']
    dernier_id = times[-1]['stop_id']
    return stops.get(premier_id, '?'), stops.get(dernier_id, '?')

def generer_cartes():
    """Fonction principale : génère les fichiers CSV pour Anki."""
    print("Lecture des fichiers GTFS...")
    routes = lire_fichier_csv('routes.txt')
    trips = lire_fichier_csv('trips.txt')
    stop_times = lire_fichier_csv('stop_times.txt')
    stops_raw = lire_fichier_csv('stops.txt')

    # Dictionnaire stop_id -> stop_name
    stops = {s['stop_id']: s['stop_name'] for s in stops_raw}

    # Identifier les route_id correspondant aux lignes de bus urbain souhaitées
    # On se base sur la partie numérique du route_short_name (ex. "La Navette (13)" -> "13").
    allowed_route_ids = set()
    for r in routes:
        raw_short = r.get('route_short_name', '')
        digits = ''.join(ch for ch in raw_short if ch.isdigit())
        key = digits if digits else raw_short.lstrip('0')
        if key in URBAN_BUS_LINES:
            allowed_route_ids.add(r['route_id'])

    # Regrouper les trips par route_id et direction_id
    # en ne conservant que les lignes de bus urbain sélectionnées.
    trips_par_route = defaultdict(list)
    for t in trips:
        if t['route_id'] not in allowed_route_ids:
            continue
        trips_par_route[(t['route_id'], t['direction_id'])].append(t)

    # Regrouper les stop_times par trip_id
    stop_times_par_trip = defaultdict(list)
    for st in stop_times:
        stop_times_par_trip[st['trip_id']].append(st)

    # Pour chaque route, pour chaque direction, on va choisir un trip représentatif
    # (celui avec le plus d'arrêts) pour obtenir la séquence complète.
    sequences = []  # pour stocker les cartes de séquence
    fiches_cloze = []  # 1 fiche par ligne/sens, cartes "texte à trous" (Cloze)

    # Construire un dictionnaire route_id -> nom de ligne affiché.
    # Si le nom contient un numéro (ex. "La Navette (13)"), on affiche juste ce numéro ("13").
    route_names = {}
    for r in routes:
        if r['route_id'] not in allowed_route_ids:
            continue
        raw_short = r.get('route_short_name', '')
        digits = ''.join(ch for ch in raw_short if ch.isdigit())
        display_name = digits if digits else raw_short
        route_names[r['route_id']] = display_name

    for (route_id, dir_id), liste_trips in trips_par_route.items():
        if not liste_trips:
            continue
        # Chercher le trip avec le plus d'arrêts
        trip_principal = None
        max_stops = 0
        for t in liste_trips:
            nb_stops = len(stop_times_par_trip.get(t['trip_id'], []))
            if nb_stops > max_stops:
                max_stops = nb_stops
                trip_principal = t
        if not trip_principal:
            continue

        trip_id = trip_principal['trip_id']
        arrets_trip = stop_times_par_trip.get(trip_id, [])
        arrets_trip.sort(key=lambda x: int(x['stop_sequence']))

        # Récupérer les noms des arrêts dans l'ordre
        noms_arrets = [stops.get(a['stop_id'], '?') for a in arrets_trip]

        # Obtenir les terminus pour le titre de la direction
        premier, dernier = noms_arrets[0], noms_arrets[-1] if noms_arrets else ('?','?')
        ligne_nom = route_names.get(route_id, route_id)

        # Fiche "texte à trous" (Cloze) : une note par ligne/sens.
        # Chaque arrêt a son propre identifiant cN -> Anki génère une carte par arrêt.
        if noms_arrets:
            cloze_lignes = []
            for idx, nom in enumerate(noms_arrets, start=1):
                cloze_lignes.append(f"{idx}. {{{{c{idx}::{nom}}}}}")
            texte = (
                f"Ligne {ligne_nom} — direction {premier} → {dernier}"
                + "<br><br>"
                + "<br>".join(cloze_lignes)
            )
            extra = "Révèle l'arrêt masqué (Cloze) pour vérifier l'orthographe exacte."
            fiches_cloze.append({"Texte": texte, "Extra": extra})

        # Pour chaque arrêt sauf le dernier, créer une carte : "Après X, quel est le suivant ?"
        for i in range(len(noms_arrets) - 1):
            arret_courant = noms_arrets[i]
            arret_suivant = noms_arrets[i+1]
            # On crée une carte avec comme question et réponse
            # Pour Anki, on peut mettre en champ "Question" et "Réponse"
            sequences.append({
                "Question": f"Ligne {ligne_nom} direction {premier} → {dernier} : après « {arret_courant} », quel est le prochain arrêt ?",
                "Reponse": arret_suivant
            })

    # Générer les cartes de correspondances (stations -> lignes)
    # On va lister tous les stop_times et pour chaque arrêt, collecter les lignes uniques
    correspondances = defaultdict(set)
    # Il faut lier stop_time -> trip -> route
    # Créer un dict trip_id -> route_id, limité aux lignes autorisées
    trip_route = {
        t['trip_id']: t['route_id']
        for t in trips
        if t['route_id'] in allowed_route_ids
    }
    for st in stop_times:
        stop_id = st['stop_id']
        trip_id = st['trip_id']
        route_id = trip_route.get(trip_id)
        if route_id:
            correspondances[stop_id].add(route_id)

    cartes_correspondances = []
    for stop_id, routes_set in correspondances.items():
        stop_name = stops.get(stop_id, '?')
        lignes = [route_names.get(r, r) for r in routes_set]
        lignes_str = ", ".join(sorted(lignes))
        cartes_correspondances.append({
            "Question": f"Quelles lignes de bus desservent l'arrêt « {stop_name} » ?",
            "Reponse": lignes_str
        })

    # Écriture des fichiers CSV pour Anki (sans ligne d'en-tête pour éviter
    # la création d'une fausse carte "Question / Reponse" dans Anki).
    print(f"Écriture de {OUTPUT_SEQUENCE}...")
    with open(OUTPUT_SEQUENCE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["Question", "Reponse"], delimiter=";")
        writer.writerows(sequences)

    print(f"Écriture de {OUTPUT_CORRESP}...")
    with open(OUTPUT_CORRESP, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["Question", "Reponse"], delimiter=";")
        writer.writerows(cartes_correspondances)

    # Fichier Cloze séparé par ';' (format Anki FR courant)
    print(f"Écriture de {OUTPUT_CLOZE}...")
    with open(OUTPUT_CLOZE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["Texte", "Extra"], delimiter=";")
        writer.writerows(fiches_cloze)

    print(
        "Terminé ! "
        f"{len(sequences)} cartes de séquence, "
        f"{len(cartes_correspondances)} cartes de correspondances, "
        f"et {len(fiches_cloze)} fiches Cloze générées."
    )

if __name__ == "__main__":
    if telecharger_gtfs():
        extraire_gtfs()
        generer_cartes()
    else:
        print("Échec du téléchargement. Vérifiez votre connexion.")