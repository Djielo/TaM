# Liens Open Data TAM / Montpellier 3M

Memo dedoublonne des liens utiles pour le projet simulateur.

## Portail API et developpeurs (hors datasets « catalogue »)

- Portail API (acces REST, documentation)  
  https://portail-api.montpellier3m.fr/
- Page « Portail API » sur le site Open Data (annonce / contexte)  
  https://data.montpellier3m.fr/portail-api
- Espace developpeurs (DKAN, acces API aux jeux de donnees)  
  https://data.montpellier3m.fr/developpeurs
- GitLab Open Data 3M (sources / outillage interne, reference)  
  https://gitlab.montpellier3m.fr/opendata3m

Ces URL completent les **fiches dataset** ci-dessous (GTFS, GTFS-RT, reseau vectoriel).

## Géométries lignes (JSON GeoJSON — utilisées par `refresh_simulation_opendata.py`)

Téléchargement direct (tracés pour `build_simulator_data.py` / carte simulateur) :

- Tram (`MMM_MMM_LigneTram.json`)  
  https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MMM_LigneTram.json
- Bus / lignes suburbaines (`MMM_MMM_BusLigne.json`)  
  https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MMM_BusLigne.json

*(Le jeu « Bustram » JSON sur le portail ne couvre qu’un sous-ensemble BHNS ; le bus général reste sur `BusLigne`.)*

## Datasets reseau et arrets

- Reseau bustram  
  https://data.montpellier3m.fr/dataset/reseau-bustram-de-montpellier-mediterranee-metropole
- Reseau de tramway  
  https://data.montpellier3m.fr/dataset/r%C3%A9seau-de-tramway-de-montpellier-m%C3%A9diterran%C3%A9e-m%C3%A9tropole
- Arrets de tramway  
  https://data.montpellier3m.fr/dataset/arrets-de-tramway-de-montpellier-mediterranee-metropole
- Reseau de bus  
  https://data.montpellier3m.fr/dataset/r%C3%A9seau-de-bus-lignes-suburbaines-de-montpellier-m%C3%A9diterran%C3%A9e-m%C3%A9tropole
- Arrets de bus  
  https://data.montpellier3m.fr/dataset/arrets-de-bus-de-montpellier-mediterranee-metropole

## Offre GTFS (theorique)

- Offre de transport TAM en GTFS  
  https://data.montpellier3m.fr/dataset/offre-de-transport-tam-en-gtfs

## Temps reel (GTFS-RT)

- Page dataset GTFS-RT TAM  
  https://data.montpellier3m.fr/dataset/offre-de-transport-tam-en-temps-reel
- Flux Urbain GTFS  
  https://data.montpellier3m.fr/GTFS/Urbain/GTFS.zip
- Flux Urbain TripUpdate  
  https://data.montpellier3m.fr/GTFS/Urbain/TripUpdate.pb
- Flux Urbain Alert  
  https://data.montpellier3m.fr/GTFS/Urbain/Alert.pb
- Flux Urbain VehiclePosition  
  https://data.montpellier3m.fr/GTFS/Urbain/VehiclePosition.pb
- Flux Suburbain GTFS  
  https://data.montpellier3m.fr/GTFS/Suburbain/GTFS.zip
- Flux Suburbain TripUpdate  
  https://data.montpellier3m.fr/GTFS/Suburbain/TripUpdate.pb
- Flux Suburbain Alert  
  https://data.montpellier3m.fr/GTFS/Suburbain/Alert.pb
- Flux Suburbain VehiclePosition  
  https://data.montpellier3m.fr/GTFS/Suburbain/VehiclePosition.pb

## Autres (optionnel / contexte)

- PCRS vecteur Montpellier 3M  
  https://data.montpellier3m.fr/dataset/pcrs-vecteur-de-montpellier-mediterranee-metropole

---

*Revue documentaire 2026-05-02 : aucun lien modifié. Rappel — le simulateur web actuel ne consomme pas les flux GTFS-RT depuis la page (priorité mode manuel, voir [EVOLUTION_ET_BACKLOG.md](EVOLUTION_ET_BACKLOG.md) §0).*
