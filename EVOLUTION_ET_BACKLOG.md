# TaM / simulateur SAE — évolution & backlog (mémo de projet)

Document vivant : figer **ce qui est acté**, **ce qu’on a décidé** et **ce qu’il reste à faire**, pour ne pas oublier d’ici quelques semaines / mois.

**Qu’est-ce que le « backlog » ici ?**  
C’est la **liste de ce qu’il reste à faire** (sections **4** et suivantes). La **priorité déviations** est désormais fixée en **section 0** (conversation projet, mai 2026) : **mode manuel** ; les chantiers « planifié / temps réel » décrits historiquement en **§1** et **4A** sont **gelés** tant que §0 n’est pas révisé.

- **Cible principale** : conduite / formation, usage **mobile** (paysage), données **TAM** (GTFS, Open Data, temps réel selon options).
- **Démo technique** : l’appli telle qu’on la teste = page web + idéalement `python serve_tam.py` (CORS, API locale perturbations). Voir [README_simulation.md](README_simulation.md) — y compris la section **« Deploiement de serve_tam sur un serveur (ex. VM Oracle Cloud) »** (bind `0.0.0.0`, OCI, `iptables`, systemd, IP publique, SSH).
- **Liens** : ressources Open Data / portail API : [LIENS_OPENDATA_TAM.md](LIENS_OPENDATA_TAM.md).

---

## 0. Décision conversation — axe « déviations » (mai 2026)

**Trois points prévus dans la conversation projet** (indépendamment des anciennes cases du mémo) :

1. **Tracé de déviation manuelle** sur la carte (remplacement de segment entre deux extrémités du tracé mission) — **réalisé / stabilisé** dans le simulateur (parcours conducteur).
2. **Arrêts non desservis** — saisie au clic sur les pastilles en mode dédié — **réalisé / stabilisé**.
3. **Arrêts provisoires / « arrêts reportés » conducteur** — **même intention** qu’un arrêt reporté côté métier, mais **saisi manuellement** dans le simulateur (pas de lecture sur le serveur / Infos trafic TAM en V1). **Réalisé en V1** : pastilles orange, fusion dans l’ordre du parcours avec les arrêts mission pour **stats**, **tronçon vert**, **annonces** et **précédent / suivant**. Une **réutilisation des données TAM** pour préremplir ce type d’info reste un sujet **distinct** (réouverture avec besoin métier explicite).

**Stratégie retenue** : ne pas continuer à investir sur une chaîne **automatique Infos trafic → mission** à court terme. En pratique, **tout ce qui compte pour la déviation « opérationnelle » passe par le mode manuel** (tracé + exceptions sur les arrêts). Les flux **planifié** et **temps réel** (anciens boutons du simulateur) sont **retirés du code front** tant qu’aucune réactivation n’est arbitrée ; le **cadrage archive** §1 reste disponible pour une éventuelle reprise technique.

**Périmètre UI (`simulateur_sae.html`)** :

| Élément | Statut |
|---------|--------|
| **« Vérifier si déviation planifiée prévue »** | **Retiré** du `simulateur_sae.html` (mai 2026) — code frontal supprimé ; la piste archives reste en **§1**. |
| **« Vérifier si déviation temps réel prévue »** | Idem (**GTFS‑RT / protobuf** retirés de la page). |
| **« Saisir une déviation en Mode manuel »** | **Bouton UI retiré** — le flux métier demeure : **tracé validé**, **arrêts non desservis** et **réactivation** réservée dans le code sous `activateStoredManualDeviationMode()` (console / extension future si besoin). |
| **« Saisir arrêts provisoires »** / **« Retirer dernier arrêt provisoire »** | **Actifs** (priorité §0) — V1 dans le simulateur ; **exclusif** avec le mode saisie arrêt non desservi au même instant. |

---

## 1. Politique de données — **ARCHIVE DE CADRAGE** (voir **§0** pour la priorité active)

> **Mai 2026** : ce tableau reste une **référence historique** (cadrage antérieur). Il **ne pilote plus** le backlog produit : la priorité est **§0** (mode manuel uniquement). Les lignes planifié / temps réel / journal du jour **ne sont pas à implémenter** tant que la stratégie §0 tient.

Ci‑dessous, ce qui avait été consigné pour mémoire : **où** = stockage **local** (téléphone / navigateur) pour un **journal** ; le **format** (JSON, CSV, texte) est un détail d’implémentation.

| Règle | Décision |
|--------|----------|
| **Hors-ligne** | **Non** — pas de cible "app totalement autonome sans réseau" pour ces flux. |
| **Déviations planifiées (à l’avance)** | **Une fois par jour** : à la **première ouverture** de l’appli **dans la journée**, un **seul** contrôle auto va chercher l’**info en ligne** et met à jour le **fichier local** (le **journal** : nouvelles déviations prévues, périodes, etc.). **Pas** quinze mille contrôles par jour. |
| **Bouton « vérifier déviation planifiée »** | Quand le conducteur clique, on s’appuie sur le **fichier déjà rempli** pour **ce jour** (oui / non / quelle logique) — c’est-à-dire le résultat du **check matinal** ; le clic ne sert **pas** à relancer 15k allers-retours réseau. *(L’**implémentation** actuelle du simulateur peut encore appeler le réseau à chaque clic : **à aligner** sur ce comportement.)* |
| **Temps réel** | **C’est le conducteur** qui clique le bouton ; là on va **en direct** sur **les sources en ligne** (pas le même scénario que le journal “une fois le matin”). |
| **Sources** | Les **sources en ligne** déjà identifiées dans le projet (Infos trafic, API / flux selon [LIENS_OPENDATA_TAM.md](LIENS_OPENDATA_TAM.md), champs côté `serve_tam` si besoin CORS, etc.) — le détail technique reste dans le code et la doc d’exploitation, pas ici. |

### 1.1 Contenu du **journal** (déviations planifiées) — cadrage produit

- **Par ligne** : une ligne peut porter **plusieurs** fiches (2, 3…).
- Chaque fiche a une **période** ; au **matin** on resynchronise et on **retire** ce qui a disparu du site — si **plus** de fiche utile, retour **tracé de base** sur la mission.

**Inventaire constaté sur le HTML TAM (Infos trafic)** — page réelle récupérée le **2026-04-24**, URL côté projet : `https://www.tam-voyages.com/perturbation/?ptano=1106&rub_code=17` (équivalent `rub_code=17`).

| Élément dans la page | Forme / remarque |
|----------------------|------------------|
| **Identifiant de fiche** | Bloc `div#pert{ID}.bloc` (ex. `pert2510`) + paramètre `id=` dans les liens d’impression (ex. `id=2510`). |
| **Période** | Dans `div.date` : **deux** lignes texte, ex. `Du 23 mars 2026` puis `au 28 août 2026` (libellé **français**, pas d’attribut `datetime` ni ISO). |
| **Titre** | `h2` dans le bloc, ex. `L36 - Arrêt non desservi`. |
| **Lignes** | `ul.text.lines` : liens avec `lign_id=` (identifiant **interne** TAM, distinct du numéro affiché). |
| **Arrêts** | `ul.text.stops` : liens `alno=` = code **arrêt** côté site + texte (nom, direction, terminus). |
| **Détails** | `div.text` : paragraphes HTML, **noms de rues** et communes, parfois **reprise** des dates (« Du lundi … au … 2026 inclus. »), renvois d’arrêt. |
| **Média** | Images dans la fiche (`/ftp/FR_perturbation/...`) : plans, extraits, schéma — c’est de l’**illustration**, pas des coordonnées. |
| **Latitude / longitude** | **Aucun** `lat` / `lon` **dans** le corps des fiches perturbation sur ce crawl. Les seuls `lat` / `lng` visibles = liens de **menu** vers `tam.cartographie.pro` (hors fiche) ou hors zone perturbations. **Pas** de polygone WKT ni couche GeoJSON intégrée à la fiche. |

**Ce que le script Python actuel** (`TamInfosTraficParser` dans `serve_tam.py` / miroir dans `update_tam_perturbations.py`) **extrait aujourd’hui** : uniquement le **titre** (`h2`) et le texte **qui suit** dans le cellule, concaténé. Il ne lit **pas** la `div.date` structurée, ni les `lign_id` / `alno` en attributs, ni l’`id` de fiche. Les **drapeaux** (déviation, travaux, non desservi) sont des **déductions** sur le texte. Donc le **même** HTML contient des dates explicites et des codes d’arrêt, mais **le code actuel n’y accède pas** : aligner l’extraction (ou l’ordre d’enrichissement du JSON) sur ce qui est **déjà** dans le HTML, pas sur une API lat/lon inexistante ici.

---

## 2. Ce qui est en place aujourd’hui (rappel)

- Parcours mission : ligne → terminus / sens → variante ; carte, progression (gris / reste en bleu), tronçon **vert** stop-to-stop (`guidage_troncons_arrets.js`).
- **Interface** : menu burger, onglets Mission / Modes / Audio, récap carte, **bandeau** sous le titre (ligne + direction, couleurs, appui long pour faire défiler le texte, relâchement = retour compact).
- **Couleurs** de ligne (sélecteur, menus mission, pastilles) ; **contraste** texte (listes T3 / bus à fond clair, etc.) ; polyligne carte **restante** en **bleu TAM** (retrait de la coloration par ligne = lisibilité sur fond OSM).
- **Modes d’exploitation** (onglet Modes) : **V1 centrée déviation manuelle** ; les boutons planifié / temps réel ont été **retirés** du simulateur (mai 2026). Restent tracé manuel carte, validation, arrêts non desservis, **arrêts provisoires**, retours **base** et **rétablissement du mode du début de mission**.
- **Perturbations** : piste `serve_tam` + `update_tam_perturbations.py` / `tam_perturbations.json` (éviter CORS sur chargement “Infos trafic”).

---

## 3. Autres décisions (hors politique déjà figée en §1)

| Sujet | Décision |
|--------|----------|
| **Déviations planifiées + temps réel + journal** | **Gelés** — voir **§0** ; ne plus traiter comme chantier prioritaire. L’ancien texte en **§1** reste archive. |
| Page web / **PWA** / “vraie appli” | Même cœur **HTML/JS** ; l’enveloppe (PWA, cache) est une **couche** — pas un second simulateur. |
| Code mort | On ne garde pas ce qui n’est pas branché. |
| Tracé sur la **carte** (poly « reste à parcourir ») | **Définitif** : **bleu TAM** seulement — on **ne** remet **pas** la couleur d’itinéraire sur la polyligne. Les couleurs de ligne restent sur l’**interface** (menus, bandeau), pas sur le tracé carte. |
| Mise à jour lourde **GTFS** / `simulation_data.json` (tout le réseau) | **Hors** du même rythme que le **check matinal** des déviations planifiées — c’est un **autre** chantier (régénération, alerte période expirée, etc., voir **4A-bis** / **4E**). |

---

## 4. Backlog = ce qu’il reste à **coder** (cases à cocher)

### 4A. ~~Mise en œuvre de la politique §1~~ — **[ABANDON PROVISOIRE — §0]**

> Ne **pas** implémenter ni faire évoluer ces points tant que la décision **§0** n’est pas révoquée (pas de hook matinal, pas de bouton planifié « fichier du jour », pas de journal conducteur piloté par Infos trafic). Réactivation uniquement avec **données concrètes** + décision explicite.

- ~~**Hook « première ouverture de la journée »**~~ — gelé.
- ~~**Bouton** « vérifier déviation planifiée » (logique fichier du jour)~~ — hors simulateur frontal (bouton et code JS associés **retirés** en mai 2026 ; **serve_tam** / parsers peuvent encore servir d’outil offline).
- ~~**Structure** du journal / extraction HTML enrichie~~ — gelé (référence technique éventuelle : **§1.1**).
- ~~(Option) **Dernière** heure de sync~~ — gelé.

#### 4A-bis. Données « lourdes » (autre piste, pas le même rythme que le matin)

- [ ] Téléchargement **incrémental** si les sources le permettent.
- [ ] Côté UI : rappel si **période GTFS** / `simulation_data.json` manifestement **périmé**.
- [ ] (Option) mémo dernière **génération** / **build** `simulation_data.json`.

### 4B. Conduite réelle (Montpellier) vs simulation (formation)

- [ ] Bascule claire **simulation** ↔ **mode réel** (position **GPS** réelle, pas seulement trace simulée).
- [ ] **Bouton** dédié + gestion des **permissions** géoloc ; intégration avec mission / tracé / déviations (définition produit : quand l’osrm, quand le GPS, etc.).

### 4C. Déviations — **mode manuel** (priorité §0)

- [x] **Déviation manuelle** : tracé sur carte + application du segment — **en place** ; finesse UX / edge cases au fil de l’eau.
- [x] **Arrêts non desservis** — **en place** (toggle pastilles + guidage).
- [x] **Arrêts provisoires** — **en place** (V1 : saisie carte + nom, snap sur tracé, guidage / voix / stats ; reset au changement de mission).
- [ ] (Option) **Préremplissage** conducteur depuis **données TAM / Infos trafic** pour les « arrêts reportés » (sans doublonner la V1 manuelle déjà là) — seulement si besoin métier explicite.
- [ ] Cohérence purement **manuel** (tracé ↔ arrêts ↔ provisoires ↔ annonces) sans réintroduire de dépendance planifié / TR.

### 4D. Emballage produit (quand le fond métier est stable)

- [ ] **PWA** (manifest, service worker, cache des assets + données si pertinent) pour usage **téléphone** et **moins** de dépendance au réseau sur les ressources statiques.
- [ ] (Option) Packager en app store — **élastique** : souvent le même binaire web dans un conteneur (Capacitor, etc.).

### 4E. Qualité & durabilité (à caler en continu)

- [ ] Tests ou **smoke** sur génération `simulation_data.json` / intégrité.
- [ ] Messages d’**erreur** clairs (pas de `simulation_data.json`, API HS, etc.).
- [ ] (Option) Indicateur de **chargement** sur mobile pour gros JSON.

---

## 5. Idées / options volontairement en attente (pas engagées)

- Thème clair / sombre, i18n, analytics : seulement si un jour le besoin est **explicite**.  
  *(La couleur du tracé sur la carte = sujet **clos**, voir le tableau de la **section 3**.)*

---

## 6. Aide-mémoire : quel fichier sert à quoi ?

Tableau de **repérage** pour retrouver le code (ce n’est **pas** un tableau d’**avancement** de projet, ni un suivi d’heures — juste un annuaire court).

| Fichier | Rôle |
|---------|------|
| `simulateur_sae.html` | UI, carte, **déviation manuelle** (tracé, arrêts non desservis, **arrêts provisoires**) ; flux planifié / temps réel **absents** du JS (mai 2026) |
| `serve_tam.py` | Fichiers statiques + API locale (ex. perturbations) |
| `build_simulator_data.py` | Génère `simulation_data.json` (GTFS + réseau 3M en ZIP/JSON) |
| `update_tam_perturbations.py` | Télécharge / alimente les perturbations (secours) |
| `guidage_troncons_arrets.js` | Tronçon vert guide |
| `LIENS_OPENDATA_TAM.md` | Datasets, GTFS-RT, portail API / développeurs |

---

*Dernière révision de **ce** fichier markdown : 2026-05-01 (terminologie arrêt reporté = provisoire manuel ; retrait planifié / TR simulateur). Mettre à jour cette date quand on modifie le mémo.*
