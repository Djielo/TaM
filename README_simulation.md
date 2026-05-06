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

Pour une **base quotidienne** limitée aux lignes **exploitées TaM en direct**
(trams 1 à 5, navette A, bus 6, 7, 8, 10, 11, etc. — périmètre figé dans
`build_simulator_data.py`, constante `TAM_CORE_ROUTE_CODES`) :

```bash
python build_simulator_data.py --routes-scope tam_core
```

Même périmètre complet (`all`), le JSON peut inclure `meta.tam_core_route_codes`
: l’interface **sépare** alors « Réseau TaM » et « Sous-traitance » dans le
menu des lignes. Sans cette clé métadonnées (anciens exports), comportement inchangé
(Tram / Navette / Bus seulement).

### CI GitHub Pages (MàJ automatique, sans commit bot sur `master`)

Le fichier **`simulation_data.json` n’est pas versionné sur `master`** (voir `.gitignore`).
Les workflows **génèrent** ce JSON et publient **tout le site statique** sur la branche
**`gh-pages`** (action **peaceiris**). Les **tâches planifiées** suffisent pour les données :
vous n’avez **pas** à lancer un workflow à la main au quotidien.

#### Réglage GitHub Pages (à ne pas confondre)

Dans **Settings → Pages → Build and deployment** :

1. **Premier menu « Source »** (en haut) : choisissez **Deploy from a branch**.  
   Ce n’est **pas** la même chose que les menus **Branch** / **Folder** plus bas. Si vous laissez **GitHub Actions** dans **Source**, GitHub ne sert **pas** la branche **gh-pages** : le site peut sembler à jour alors que **`simulation_data.json` manque** (popup dans le simulateur).
2. Une fois **Deploy from a branch** sélectionné, réglez **Branch** = **`gh-pages`** et **Folder** = **`/ (root)`**, puis enregistrez.

Sans cette combinaison, les workflows peuvent être verts mais le fichier JSON reste **introuvable** sur `…github.io/…/simulation_data.json`.

Fichiers sous **`.github/workflows/`** :

- **`simulation-data-daily.yml`** — chaque jour ~**01:01 UTC** : blend TaM + lignes hors TaM déjà publiées.
- **`simulation-data-monthly.yml`** — le **1er du mois ~02:01 UTC** : réseau complet.
- **`pages-sync-on-push.yml`** — **optionnel** : après un push sur `master`, met à jour **gh-pages** avec vos **HTML/JS** (les crons ci‑dessus portent les données).

Script : **`scripts/refresh_simulation_opendata.py`**. Clone local sans JSON :  
`bash scripts/fetch_simulation_data_local.sh VotreCompte/NomDuRepo`  
ou `python scripts/refresh_simulation_opendata.py --mode monthly`.

**Note technique** : avant **peaceiris**, la CI **supprime le `.gitignore` copié** dans `_site`. Sinon
**peaceiris** (`git add --all`) respecterait encore les règles et **n’ajouterait pas** `simulation_data.json` sur **gh-pages**.

2. Demarrer le serveur local TAM (statique + API locale anti-CORS):

```bash
python serve_tam.py
```

3. Ouvrir dans le navigateur:

- [http://localhost:8000/simulateur_sae.html](http://localhost:8000/simulateur_sae.html)

Dans l’onglet **Déviation** du simulateur, les sous-onglets **Planifiée** et **Temporaire** sont des parcours distincts (session temporaire, Rétablir, enregistrements locaux) — voir **[EVOLUTION_ET_BACKLOG.md](EVOLUTION_ET_BACKLOG.md)** §2.1 pour le comportement acté et les noms des helpers dans le code.

Le JavaScript est découpé en trois fichiers sous **`simulateur_sae/`** (`simulateur_sae_1_state_mission.js`, `_2_deviations.js`, `_3_ui_simulation.js`), chargés dans cet ordre par la page — **aucune étape de build** ; le déploiement statique (GitHub Pages, etc.) reste identique à condition de **pousser le dossier** avec le HTML.

Optionnel (secours hors ligne pour le mode planifie):

```bash
python update_tam_perturbations.py
```

## Deploiement de `serve_tam` sur un serveur (ex. VM Oracle Cloud)

Memo pour un **seul** but : exposer `GET /api/tam/perturbations` (HTML TAM parse en JSON) sur Internet pour une appli mobile / PWA, sans CORS cote TAM.

### Comportement reseau important

- Par defaut le script **ecoute sur 127.0.0.1** : inutilisable depuis l'exterieur. En cloud, lancer avec :
  - `SERVE_TAM_BIND=0.0.0.0 python3 serve_tam.py`  
  ou le code actuel lit la variable d'environnement (voir en-tete de `serve_tam.py`).

### Oracle Cloud Infrastructure (OCI) — a minima

1. **Subnets** : instance dans un **subnet public** + **IP publique** sur la VNIC.
2. **Security list** (subnet public) : regle d'**ingress** **TCP 8000** (ou le port choisi) depuis `0.0.0.0/0` (puis, en prod, restreindre si besoin). Pas de **Network security group** sur la VNIC dans notre cas simple : inutile si vide.

### Ubuntu sur la VM (pare-feu) — point souvent bloquant

Les images classiques n'ouvrent en **entree** que **SSH (22)** ; une regle **REJECT** en fin de chaine `INPUT` bloque le reste. Il faut une regle **ACCEPT** sur le **port du serveur** (ex. 8000) **avant** ce `REJECT`. Vérifier avec `sudo iptables -L INPUT -n -v`.

**Persister les regles** apres un reboot : paquet `iptables-persistent` + `sudo netfilter-persistent save` + `systemctl enable netfilter-persistent`.

### Demarrer `serve_tam` au boot (systemd)

Fichier d'exemple fourni : `systemd/serve-tam.service` (adapte `User=` et chemins). Installation typique : copie sous `/etc/systemd/system/`, puis `systemctl daemon-reload`, `enable`, `start`.

### Accès SSH (depuis Windows)

```text
ssh -i "C:\chemin\vers\cle_privee.key" ubuntu@ADRESSE_IP_PUBLIQUE
```

**Copie du script** (ordinateur -> serveur) :

```text
scp -i "C:\chemin\vers\cle_privee.key" D:\...\serve_tam.py ubuntu@ADRESSE_IP_PUBLIQUE:~/
```

### Adresse IP publique : faut-il la changer souvent ?

- **Reboot** du systeme d'exploitation : l'**IP publique ephemere est en principe la meme**.
- **Stop** de l'instance puis **Start** (ou reconfiguration) : l'ephemere **peut** changer. Pour une adresse **fixe** : reserver une **IP publique reservee** (Reserved public IP) dans OCI et l'attacher. Pour l'appli, privilegier a terme un **nom DNS** pointant vers cette IP plutot que l'IP en dur partout.

### Test rapide (machine locale)

```text
curl "http://IP_PUBLIQUE:8000/api/tam/perturbations"
```

(HTTP, pas HTTPS, tant qu'aucun certificat n'est en face.)

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
- Si vous mettez a jour `gtfs_data`, regenez `simulation_data.json`.

## Deviations enregistrees (stockage local navigateur)

L’onglet **Modes** permet un scenario **manuel** : trace sur la carte (une ou plusieurs portions validees), arrets non desservis, arrets provisoires. Les fiches peuvent etre **enregistrees localement** (liste deroulante sous la mission), puis **rechargees**, **dupliquees vers une autre variante**, ou **mises a jour**.

Comportement utile a connaitre (mai 2026) :

- Plusieurs validations successives conservent une **chaine de portions** ; on peut **supprimer une portion precise** sans tout effacer.
- La liste **« Portion a supprimer »** est synchronisee avec la carte (surbrillance ; clic sur un trace jaune pour identifier la portion).
- Si une **entree est selectionnee** dans « Deviations enregistrees » et que la **variante chargee** correspond au `pattern_id` de cette entree, une suppression de portion ou un effacement du trace valide **met a jour automatiquement** le payload de la fiche (plus besoin de recliquer « Mettre a jour l’entree selectionnee » dans ce cas). Sinon, utiliser explicitement **Mettre a jour l’entree selectionnee** ou **Enregistrer (nouvelle entree)**.

Detail produit et backlog : [EVOLUTION_ET_BACKLOG.md](EVOLUTION_ET_BACKLOG.md).
