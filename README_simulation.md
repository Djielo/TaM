# Simulateur SAE (formation)

Ce prototype sert a s'entrainer hors terrain avec les donnees GTFS TAM.

## Fonctions

- Selection en 3 etapes: `ligne` -> `terminus/sens` -> `variante`
- Carte avec trace complet de la mission
- Progression visuelle type SAE (partie deja faite en gris)
- Simulation 100% locale (pas besoin de geolocalisation reelle)
- Commandes: pause/reprise, vitesse, arret precedent/suivant

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

## Usage recommande

- Utiliser sur telephone ou tablette en mode paysage.
- Commencer par des lignes simples, puis tester les variantes.
- Ajuster la vitesse pour memoriser les enchainements d'arrets.

## Notes

- Les variantes sont construites depuis `trips.txt` + `stop_times.txt`.
- Le GTFS fourni ici n'inclut pas `shapes.txt` (trace officiel absent).
- Le simulateur tente donc un trace routier (OSRM) pour suivre la voirie.
- Si OSRM est indisponible, il revient automatiquement en mode direct arret->arret.
- Si vous mettez a jour `gtfs_data`, regenez `simulation_data.json`.
