# Simulateur SAE (formation)

Ce prototype sert a s'entrainer hors terrain avec les donnees GTFS TAM.

## Fonctions

- Selection en 3 etapes: `ligne` -> `terminus/sens` -> `variante`
- Carte avec trace complet de la mission
- Progression visuelle type SAE (partie deja faite en gris)
- Guidage visuel temporaire par troncon actif `arret courant -> arret suivant` (vert)
- Simulation 100% locale (pas besoin de geolocalisation reelle)
- Commandes: pause/reprise, vitesse, arret precedent/suivant

## Sources de trace

Le simulateur choisit la geometrie dans cet ordre:

1. Reseau Open Data 3M (prioritaire)
   - Tram (`route_type=0`): `MMM_MMM_LigneTram.json`
   - Bus: `MMM_MMM_BusLigne.json`
2. Routage routier OSRM (secours)
3. Trace direct arret->arret GTFS (dernier secours)

Ce mecanisme permet d'avoir un trace tram realiste sur les lignes 1 a 5 quand
la donnee tram est disponible localement.

## Lancer le prototype

1. Generer les donnees de simulation:

```bash
python build_simulator_data.py
```

2. Demarrer un serveur web local dans le dossier du projet:

```bash
python -m http.server 8000
```

3. Ouvrir dans le navigateur:

- [http://localhost:8000/simulateur_sae.html](http://localhost:8000/simulateur_sae.html)

## Donnees Open Data locales

- Les archives Open Data volumineuses (notamment ZIP tram) sont utilisees en local mais ne sont pas versionnees dans Git (`.gitignore`).
- Les liens utiles (reseau, GTFS, GTFS-RT temps reel) sont centralises dans:
  - `LIENS_OPENDATA_TAM.md`

## Verification des donnees reseau (Bus + Tram)

Section de suivi technique pour controler rapidement la coherence des donnees chargees.

- Periode GTFS locale actuellement detectee: `2026-01-05` -> `2026-03-08`.
- Les geometries reseau (bus/tram) proviennent des jeux Open Data locaux si presents.
- Les lignes tram (`route_type=0`) utilisent en priorite la geometrie `LigneTram`.
- En absence de geometrie reseau, fallback automatique: OSRM, puis trace arret->arret.
- Si une ligne parait incoherente, verifier en premier:
  - la date/validite GTFS locale,
  - la presence des archives Open Data reseau,
  - puis regenerer `simulation_data.json`.

## Usage recommande

- Utiliser sur telephone ou tablette en mode paysage.
- Commencer par des lignes simples, puis tester les variantes.
- Ajuster la vitesse pour memoriser les enchainements d'arrets.

## Notes techniques

- Les variantes sont construites depuis `trips.txt` + `stop_times.txt`.
- Le GTFS local peut ne pas inclure `shapes.txt`; le trace officiel est alors reconstruit via Open Data reseau (bus/tram) puis OSRM si necessaire.
- Le guidage stop-to-stop est implemente dans `guidage_troncons_arrets.js`.
- Le module `intersections_multipassage.js` est conserve pour tests, mais il n'est plus la strategie de guidage principale.
- Si vous mettez a jour `gtfs_data`, regenez `simulation_data.json`.
