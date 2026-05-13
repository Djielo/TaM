/* simulateur SAE — fichier 1/3 : état mission, lignes / variantes, ops et carte jusqu’à `ensureOpsTargetPattern`.
 * Ordre des `<script src>` dans `simulateur_sae.html` obligatoire (1 → 2 → 3). */

let data = null;
let filteredByLine = [];
let filteredByHeadsign = [];
let lineOptions = [];
let lineOptionLookup = [];
let currentPattern = null;
let activeCoordinates = [];
let traceSource = "Aucune";
/** Distance cumulée (m) vers chaque sommet d'activesCoordinates, longueur = n. */
let pathCumMeters = [];
let pathTotalMeters = 0;
/** Position courante sur le tracé (mètres depuis le départ). */
let distanceAlongPathMeters = 0;
/** Distance le long du tracé pour chaque arrêt (GTFS) après "snap" sur la polyligne. */
let stopMetersAlong = [];
/** Dernière distance (m) pour détecter les franchissements d'annonce. */
let lastVoiceDistance = 0;
/** Cles deja annoncees : d{i} = passage arret i, m{i} = mi-parcours segment i->i+1. */
let voixAnnounced = new Set();
let running = false;
let previewOnlyMode = false;
let speed = 1;
/** rAF : vitesse en m/s réelle, pas "un pas par sommet" (croisements). */
let lastRafTime = 0;
/** Mètres par seconde (à x1) : la simulation ne dépend plus de la densité des sommets. */
const BASE_METERS_PER_SECOND = 9;
const LS_KEY_VOICE = "tam_sim_voice";
const LS_KEY_MODE = "tam_sim_vocal_mode";
const LS_KEY_ENABLED = "tam_sim_vocal_on";
const LS_KEY_HEADING = "tam_sim_heading_up";
const LS_KEY_OPS_LOG = "tam_sim_ops_log";
const LS_KEY_RECAP = "tam_sim_recap_on";
const LS_KEY_DRIVE_MODE = "tam_sim_drive_mode";
const LS_KEY_DEVIATIONS = "tam_sim_saved_deviations_v1";
/** Titre des boîtes de dialogue HTML du simulateur (remplace l’origine « localhost » du navigateur). */
const TAM_APP_DIALOG_TITLE = "Simulateur SAE TAM";
/** Préfixe dans le champ de saisie ; le nom stocké et annoncé est le suffixe (ou tout le texte si le préfixe est retiré). */
const PROVISIONAL_STOP_NAME_PREFIX = "Arrêt provisoire : ";
/** Digest du dernier jeu `simulation_data.json` charge (pour garde-fou). */
let datasetDigestLoaded = "";
/** Liste des autres variantes meme sens (duplication UI). */
let duplicateVariantChoices = [];

const OPS_MODE = {
  BASE: "BASE",
  MANUEL: "MANUEL_ACTIF",
};

function coerceOpsMode(mode) {
  return mode === OPS_MODE.MANUEL ? OPS_MODE.MANUEL : OPS_MODE.BASE;
}

/*
 * ─── Déviation : Planifiée / Temporaire / stockage local ───────────────
 * Planifiée   : fiche « durable » ; dates / duplication sous Enregistrée-Dupliquée.
 * Temporaire  : session (1er geste utile sous sous-onglet Temporaire). Le bouton
 *               « Rétablir le mode exploitation… » n’existe que sous Temporaire.
 * Rétablir    : restaure snapshotBeforeTemporary (état au chargement d’une fiche ou
 *               à l’ouverture de session), pas la ligne brute sans déviation.
 * deferPlannedSave… : après enreg. temp ou Rétablir, « Enregistrer déviation planifiée »
 *               reste grisé jusqu’à validation explicite du tracé (bouton Valider côté Planifiée).
 * Doc projet  : EVOLUTION_ET_BACKLOG.md (section simulateur / déviations).
 */
let opsState = {
  mode: OPS_MODE.BASE,
  manualActive: false,
  nonServedEditActive: false,
  initialMode: OPS_MODE.BASE,
  returnMode: OPS_MODE.BASE,
  /** true dès l’ouverture d’une session temporaire (premier geste utile) jusqu’à enregistrement en local, rétablissement ou mode base. */
  temporaryDeviationActive: false,
  targetPatternId: "",
  baseCoordinates: null,
  modeCoordinates: {
    MANUEL_ACTIF: null,
  },
  manualProfile: null,
  manualStopOverrides: {},
  /** { id, stop_name, lat, lon } — projetés sur le tracé actif pour guidage / annonces */
  provisionalStops: [],
  provisionalEditActive: false,
};
/** État explo à restaurer par « Rétablir… » (capturé au moment de l’activation). */
let snapshotBeforeTemporary = null;
/** État carte / surcharge avant un tracé « Planifiée » (hors session Temporaire), pour fermer sans effet résiduel au « Quitter ». */
let plannedDeviationEditSnapshot = null;
/** Fiches créées via « Enregistrer la déviation temporaire » pendant la session courante (purger au rétablissement / mode base). */
let deviationIdsSavedDuringTemporarySession = [];
/**
 * Après « Enregistrer la déviation temporaire » ou après « Rétablir… » : le bouton
 * Planifiée ne repasse disponible qu’après validation du tracé via le bouton Planifiée.
 */
let deferPlannedSaveUntilEditedAfterTempRecorded = false;
/**
 * Empreinte JSON du dernier état considéré comme « déjà enregistré / chargé » pour le bouton planifiée.
 * null = pas encore fixé après reset mission (bouton désactivé).
 */
let plannedDeviationSaveBaselineJson = null;
let revertingMissionSelectors = false;
/** HUD carte : commandes pause / arrêts / cap après démarrage ou chargement fiche (masqué à l’aperçu mission). */
let mapMissionHudSessionActive = false;
let restoringTemporarySnapshot = false;
let skippedStopIdSet = new Set();
let activeStopMetersForGuide = [];
/** Arrêts desservis + provisoires, distances normalisées — annonces, stats, tronçon vert */
let servedGuideSnapshot = [];
/** En saisie arrêt non desservi : dernière pastille cliquée (une seule infobulle ouverte à la fois). */
let nonServedEditFocusStopId = null;
/** Chrome mobile : tap pastille déclenche souvent aussi un click carte ; on ignore ce clear pendant quelques ms. */
let nonServedEditSuppressMapClearUntil = 0;

const lineSelect = document.getElementById("lineSelect");
const lineSelectDual = document.getElementById("lineSelectDual");
const lineSelectTrigger = document.getElementById("lineSelectTrigger");
const lineSelectTriggerLabel = document.getElementById(
  "lineSelectTriggerLabel",
);
const lineSelectListbox = document.getElementById("lineSelectListbox");
let lineListboxOpen = false;
const controlPanelEl = document.getElementById("controlPanel");
const mapRecapEl = document.getElementById("mapRecap");
const recapToggleBtn = document.getElementById("recapToggleBtn");
const burgerMenuBtn = document.getElementById("burgerMenuBtn");
const closeMenuBtn = document.getElementById("closeMenuBtn");
const missionTabBtn = document.getElementById("missionTabBtn");
const opsTabBtn = document.getElementById("opsTabBtn");
const voiceTabBtn = document.getElementById("voiceTabBtn");
const helpTabBtn = document.getElementById("helpTabBtn");
/** Dernier onglet du menu pour rouvrir au même endroit (Ligne / Déviation / Audio / Aide). */
let controlPanelRememberTab = "mission";
/** Sous-onglet dans « Déviation » : dev | devtemp | rec */
let controlPanelRememberOpsSubtab = "dev";
const OPS_SUBTAB_IDS = ["dev", "devtemp", "rec"];
function normalizeOpsSubtab(sub) {
  const s = String(sub || "").trim();
  return OPS_SUBTAB_IDS.includes(s) ? s : "dev";
}
function isTempDeviationSubtabActive() {
  return normalizeOpsSubtab(controlPanelRememberOpsSubtab) === "devtemp";
}
/** Sous-onglet Temporaire : démarre la session si besoin avant d’éditer tracé ou arrêts. */
function ensureTemporaryDeviationSessionIfOnSubtab() {
  if (!isTempDeviationSubtabActive()) return true;
  if (opsState.temporaryDeviationActive) return true;
  activateTemporaryDeviationMode();
  return !!opsState.temporaryDeviationActive;
}
function applyOpsPanelsVisibility() {
  if (!controlPanelEl) return;
  const sub = normalizeOpsSubtab(controlPanelRememberOpsSubtab);
  controlPanelRememberOpsSubtab = sub;
  controlPanelEl
    .querySelectorAll(".panel-ops[data-ops-sub]")
    .forEach((el) => {
      const raw = el.getAttribute("data-ops-sub") || "";
      const tokens = raw.trim().split(/\s+/).filter(Boolean);
      el.classList.toggle("show", tokens.includes(sub));
    });
  controlPanelEl
    .querySelectorAll(".panel-ops-subtabs [data-ops-subtab]")
    .forEach((btn) => {
      const id = btn.getAttribute("data-ops-subtab");
      btn.classList.toggle("active", id === sub);
    });
  refreshManualDrawUi();
  refreshTemporaryDeviationUi();
}
function setOpsSubtab(sub) {
  controlPanelRememberOpsSubtab = normalizeOpsSubtab(sub);
  if (controlPanelRememberTab === "ops") applyOpsPanelsVisibility();
}
const headsignSelect = document.getElementById("headsignSelect");
const variantSelect = document.getElementById("variantSelect");
const speedSelect = document.getElementById("speedSelect");
const voiceEnabledEl = document.getElementById("voiceEnabled");
const voiceModeEl = document.getElementById("voiceMode");
const voiceSelectEl = document.getElementById("voiceSelect");
const voiceTestBtn = document.getElementById("voiceTest");
const voiceNoteEl = document.getElementById("voiceNote");
const headingUpEl = document.getElementById("headingUp");
const driveModeSelect = document.getElementById("driveModeSelect");
const gpsStatusEl = document.getElementById("gpsStatus");

const missionName = document.getElementById("missionName");
const missionContextBar = document.getElementById("missionContextBar");
const missionContextScroll = document.getElementById(
  "missionContextScroll",
);
const missionContextKind = document.getElementById("missionContextKind");
const missionContextPill = document.getElementById("missionContextPill");
const missionContextDest = document.getElementById("missionContextDest");
const MISSION_PAN_LONG_MS = 700;
let missionContextPanTimer = null;

function clearMissionContextPanTimer() {
  if (missionContextPanTimer) {
    clearTimeout(missionContextPanTimer);
    missionContextPanTimer = null;
  }
}

function setupMissionContextPan() {
  const el = missionContextScroll;
  if (!el) {
    return;
  }
  function armPanMode() {
    if (missionContextBar && missionContextBar.hidden) {
      return;
    }
    el.classList.add("mission-context-scroll--pan");
    try {
      el.focus({ preventScroll: true });
    } catch (e) {
      el.focus();
    }
  }
  let touchArmStartX = 0;
  let touchArmStartY = 0;
  el.addEventListener(
    "touchstart",
    (e) => {
      if (el.classList.contains("mission-context-scroll--pan")) {
        return;
      }
      if (e.touches.length !== 1) {
        return;
      }
      const t0 = e.touches[0];
      touchArmStartX = t0.clientX;
      touchArmStartY = t0.clientY;
      clearMissionContextPanTimer();
      missionContextPanTimer = setTimeout(
        armPanMode,
        MISSION_PAN_LONG_MS,
      );
    },
    { passive: true },
  );
  const cancelPanArm = () => clearMissionContextPanTimer();
  function onTouchOrPanEnd() {
    if (el.classList.contains("mission-context-scroll--pan")) {
      el.classList.remove("mission-context-scroll--pan");
      el.scrollLeft = 0;
    }
    clearMissionContextPanTimer();
  }
  el.addEventListener(
    "touchmove",
    (e) => {
      if (el.classList.contains("mission-context-scroll--pan")) {
        return;
      }
      if (e.touches.length !== 1) {
        cancelPanArm();
        return;
      }
      const t0 = e.touches[0];
      const dx = Math.abs(t0.clientX - touchArmStartX);
      const dy = Math.abs(t0.clientY - touchArmStartY);
      if (dx > 14 || dy > 14) {
        cancelPanArm();
      }
    },
    { passive: true },
  );
  el.addEventListener("touchend", onTouchOrPanEnd, { passive: true });
  el.addEventListener("touchcancel", onTouchOrPanEnd, { passive: true });
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) {
      return;
    }
    if (el.classList.contains("mission-context-scroll--pan")) {
      return;
    }
    clearMissionContextPanTimer();
    missionContextPanTimer = setTimeout(armPanMode, MISSION_PAN_LONG_MS);
  });
  el.addEventListener("mouseup", (e) => {
    if (e.button !== 0) {
      return;
    }
    onTouchOrPanEnd();
  });
  el.addEventListener("mouseleave", () => {
    clearMissionContextPanTimer();
  });
  el.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      el.classList.contains("mission-context-scroll--pan")
    ) {
      el.classList.remove("mission-context-scroll--pan");
      el.scrollLeft = 0;
    }
  });
}
setupMissionContextPan();
const modeActiveEl = document.getElementById("modeActive");
const modeStatusEl = document.getElementById("modeStatus");
const currentStopEl = document.getElementById("currentStop");
const nextStopEl = document.getElementById("nextStop");
const progressPctEl = document.getElementById("progressPct");
const segmentGuideInfoEl = document.getElementById("segmentGuideInfo");
const nonServedBtn = document.getElementById("nonServedBtn");
const provisionalStopBtn = document.getElementById("provisionalStopBtn");
const provisionalUndoBtn = document.getElementById("provisionalUndoBtn");
const manualDrawStartBtn = document.getElementById("manualDrawStartBtn");
const manualDrawUndoBtn = document.getElementById("manualDrawUndoBtn");
const manualDrawSaveBtn = document.getElementById("manualDrawSaveBtn");
const tempManualDrawStartBtn = document.getElementById(
  "tempManualDrawStartBtn",
);
const tempManualDrawUndoBtn = document.getElementById(
  "tempManualDrawUndoBtn",
);
const tempManualDrawSaveBtn = document.getElementById(
  "tempManualDrawSaveBtn",
);
const manualTraceClearBtn = document.getElementById(
  "manualTraceClearBtn",
);
const manualTraceSegmentSelectEl = document.getElementById(
  "manualTraceSegmentSelect",
);
const manualTraceRemoveSegmentBtn = document.getElementById(
  "manualTraceRemoveSegmentBtn",
);
const temporarySaveDeviationBtn = document.getElementById(
  "temporarySaveDeviationBtn",
);
const returnInitialBtn = document.getElementById("returnInitialBtn");
const returnBaseBtn = document.getElementById("returnBaseBtn");
const savedDeviationStaleNoteEl = document.getElementById(
  "savedDeviationStaleNote",
);
const savedDeviationSelectEl = document.getElementById(
  "savedDeviationSelect",
);
const savedDeviationValidFromEl = document.getElementById(
  "savedDeviationValidFrom",
);
const savedDeviationValidToEl = document.getElementById(
  "savedDeviationValidTo",
);
const saveDeviationBtn = document.getElementById("saveDeviationBtn");
const updateDeviationBtn = document.getElementById("updateDeviationBtn");
const loadDeviationBtn = document.getElementById("loadDeviationBtn");
const deleteDeviationBtn = document.getElementById("deleteDeviationBtn");
const duplicateFromDeviationSelectEl = document.getElementById(
  "duplicateFromDeviationSelect",
);
const duplicateTargetVariantSelectEl = document.getElementById(
  "duplicateTargetVariantSelect",
);
const duplicateDeviationBtn = document.getElementById(
  "duplicateDeviationBtn",
);
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");

const DRIVE_MODE = {
  SIMULATION: "simulation",
  REAL: "real",
};
let driveMode = DRIVE_MODE.SIMULATION;
let gpsWatchId = null;
let lastGpsLatLng = null;
let lastGpsHeadingDeg = null;
/** Vitesse mini (m/s) pour faire confiance au `heading` GPS : en dessous, cap souvent bruité à l’arrêt (contrairement aux apps type Maps qui le figent ou suivent la route). */
const GPS_HEADING_MIN_SPEED_MS = 0.5;
/** Si le GPS est plus loin que ça (perpendiculaire au tracé), on n’affiche plus le curseur « collé » à la ligne (écart type ~précision GPS). */
const GPS_SNAP_CROSS_TRACK_MAX_M = 10;
/** Dernière distance latérale GPS → polyligne mission (m), mode réel uniquement ; `null` si inactif. */
let lastGpsCrossTrackM = null;

function setGpsStatus(msg) {
  if (gpsStatusEl) {
    gpsStatusEl.textContent = msg;
  }
}

function stopGpsTracking() {
  if (gpsWatchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(gpsWatchId);
  }
  gpsWatchId = null;
  lastGpsLatLng = null;
  lastGpsHeadingDeg = null;
  lastGpsCrossTrackM = null;
  if (typeof resetGpsUnsavedDeviationMovementWarn === "function") {
    resetGpsUnsavedDeviationMovementWarn();
  }
}

function applyGpsPositionToMission(pos) {
  const acc = Number(pos?.coords?.accuracy || 0);
  const lat = Number(pos?.coords?.latitude || 0);
  const lon = Number(pos?.coords?.longitude || 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return;
  }
  lastGpsLatLng = [lat, lon];
  const gpsHeading = Number(pos?.coords?.heading);
  const rawSpeed = pos?.coords?.speed;
  const speedMs = Number(rawSpeed);
  const speedKnown = rawSpeed != null && Number.isFinite(speedMs);
  const speedHighEnough =
    speedKnown && speedMs >= GPS_HEADING_MIN_SPEED_MS;
  lastGpsHeadingDeg =
    Number.isFinite(gpsHeading) && speedHighEnough ? gpsHeading : null;

  // Hors mission (ex. guidage Itinéraire GPS uniquement) : on veut quand même une position
  // GPS fraîche, sans projection sur un tracé.
  if (!currentPattern || !pathTotalMeters || pathTotalMeters <= 0) {
    const speedKmh = Number(pos?.coords?.speed);
    const speedInfo =
      Number.isFinite(speedKmh) && speedKmh >= 0
        ? ` | ~${Math.round(speedKmh * 3.6)} km/h`
        : "";
    const qualif =
      acc && acc > 80 ? "GPS actif (précision faible)" : "GPS actif";
    setGpsStatus(
      `${qualif} (~${Math.max(1, Math.round(acc || 0))} m${speedInfo}).`,
    );
    return;
  }
  let projected;
  if (typeof projectLatLngOntoActivePath === "function") {
    const pr = projectLatLngOntoActivePath(lat, lon);
    projected = pr.alongMeters;
    lastGpsCrossTrackM = pr.crossTrackMeters;
  } else {
    projected = distanceAlongPathForLatLng(lat, lon);
    lastGpsCrossTrackM = 0;
  }
  let nextDistance = Math.max(0, Math.min(pathTotalMeters, projected));
  // Evite un retour en arriere trop brusque quand le GPS saute.
  if (nextDistance + 15 < distanceAlongPathMeters) {
    nextDistance = distanceAlongPathMeters;
  }
  const prevVoiceD = lastVoiceDistance;
  distanceAlongPathMeters = nextDistance;
  maybeAnnounceProchainArret(prevVoiceD, distanceAlongPathMeters);
  lastVoiceDistance = distanceAlongPathMeters;
  updateMapNavigation();
  redrawDoneLineAtDistance(distanceAlongPathMeters);
  updateStopToStopOverlay();
  updateStats();
  const speedKmh = Number(pos?.coords?.speed);
  const speedInfo =
    Number.isFinite(speedKmh) && speedKmh >= 0
      ? ` | ~${Math.round(speedKmh * 3.6)} km/h`
      : "";
  const qualif =
    acc && acc > 80 ? "GPS actif (précision faible)" : "GPS actif";
  setGpsStatus(
    `${qualif} (~${Math.max(1, Math.round(acc || 0))} m${speedInfo}).`,
  );
  if (typeof maybeWarnUnsavedDeviationAfterGpsMovement === "function") {
    maybeWarnUnsavedDeviationAfterGpsMovement(lat, lon);
  }
}

function startGpsTracking() {
  if (!navigator.geolocation) {
    tamAppAlert("Ce téléphone ne fournit pas la géolocalisation.");
    setGpsStatus("GPS indisponible sur cet appareil.");
    return false;
  }
  stopGpsTracking();
  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      applyGpsPositionToMission(pos);
    },
    (err) => {
      const msg =
        err?.code === 1
          ? "GPS refuse (permission)."
          : err?.code === 2
            ? "GPS indisponible."
            : "GPS en attente…";
      setGpsStatus(msg);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12000,
    },
  );
  setGpsStatus("Activation du GPS…");
  return true;
}

function refreshDriveModeUi() {
  if (!startBtn) return;
  startBtn.textContent =
    driveMode === DRIVE_MODE.REAL
      ? "Démarrer mode réel GPS"
      : "Démarrer simulation";
  if (driveMode === DRIVE_MODE.SIMULATION) {
    setGpsStatus("GPS inactif.");
  } else if (gpsWatchId == null) {
    setGpsStatus("Mode réel prêt. Appuyez sur Démarrer.");
  }
  if (typeof refreshMapMissionHudState === "function") {
    refreshMapMissionHudState();
  }
}

const map = L.map("map", {
  rotate: true,
  bearing: 0,
  rotateControl: false,
}).setView([43.61, 3.88], 12);

/** Fond plan (OSM) ; commutation avec vue satellite (Esri World Imagery, gratuit). */
const basemapLayerOsm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
});
const basemapLayerSatellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tuiles &copy; Esri — sources : Esri, Maxar, Earthstar Geographics et contributeurs du programme GIS",
  },
);
let basemapActiveKey = "osm";
let basemapActiveLayer = basemapLayerOsm.addTo(map);

function tamSetBasemapLayer(key) {
  const next = key === "satellite" ? "satellite" : "osm";
  if (next === basemapActiveKey) return;
  map.removeLayer(basemapActiveLayer);
  basemapActiveKey = next;
  basemapActiveLayer = next === "satellite" ? basemapLayerSatellite : basemapLayerOsm;
  basemapActiveLayer.addTo(map);
}

/** Ajouté après le contrôle « Itinéraire » (coin haut gauche : zoom, itinéraire, ce bouton). */
let tamBasemapToggleLeafletControl = null;
function tamInstallBasemapToggleControl() {
  if (tamBasemapToggleLeafletControl || typeof L === "undefined" || !map) return;
  const ctrl = L.control({ position: "topleft" });
  ctrl.onAdd = function onAddBasemapCtrl() {
    const wrap = L.DomUtil.create("div", "leaflet-bar tam-basemap-control");
    const a = L.DomUtil.create("a", "tam-basemap-toggle tam-basemap-toggle--preview-satellite", wrap);
    a.href = "#";
    a.setAttribute("role", "button");
    a.title = "Passer à la vue satellite";
    a.setAttribute("aria-label", "Passer à la vue satellite");
    L.DomUtil.create("span", "tam-basemap-toggle__thumb", a).setAttribute("aria-hidden", "true");
    a.style.display = "inline-flex";
    a.style.alignItems = "center";
    a.style.justifyContent = "center";
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.on(a, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      const goSat = basemapActiveKey === "osm";
      tamSetBasemapLayer(goSat ? "satellite" : "osm");
      if (basemapActiveKey === "satellite") {
        a.classList.remove("tam-basemap-toggle--preview-satellite");
        a.classList.add("tam-basemap-toggle--preview-osm");
        a.title = "Passer à la carte plan (OpenStreetMap)";
        a.setAttribute("aria-label", "Passer à la carte plan (OpenStreetMap)");
      } else {
        a.classList.remove("tam-basemap-toggle--preview-osm");
        a.classList.add("tam-basemap-toggle--preview-satellite");
        a.title = "Passer à la vue satellite";
        a.setAttribute("aria-label", "Passer à la vue satellite");
      }
    });
    return wrap;
  };
  ctrl.addTo(map);
  tamBasemapToggleLeafletControl = ctrl;
}

const navIcon = L.divIcon({
  className: "nav-vehicle",
  html: '<div class="nav-triangle" role="img" aria-label="Position simulée"></div>',
  iconSize: [32, 32],
  iconAnchor: [16, 26],
});
let fullLine = L.polyline([], {
  color: "#005ca9",
  weight: 6,
  opacity: 0.6,
}).addTo(map);
let doneLine = L.polyline([], {
  color: "#9aa3ad",
  weight: 8,
  opacity: 0.95,
}).addTo(map);
/** Un segment contour black / détour jaune par saisie (tracés multiples). */
const manualBypassOverlays = L.layerGroup().addTo(map);
const manualDetourOverlays = L.layerGroup().addTo(map);
const manualDraftLayer = L.layerGroup().addTo(map);
let manualDraftLine = null;
let manualDraftMarkers = [];
let manualDraftPoints = [];
let manualDrawActive = false;
/** Couche temporaire : segment actif entre l'arret courant et le suivant. */
const stopToStopLayer = L.layerGroup().addTo(map);
const allStopsLayer = L.layerGroup().addTo(map);
const skippedStopsLayer = L.layerGroup().addTo(map);
const provisionalStopsLayer = L.layerGroup().addTo(map);
let marker = L.marker([43.61, 3.88], {
  icon: navIcon,
  zIndexOffset: 800,
}).addTo(map);
map.on("zoomend", () => {
  applyMapVisualProfile();
});

function normalizeProvisionalStopNameInput(raw) {
  const defaultBare = "Arrêt provisoire";
  let s = String(raw ?? "").trim();
  if (!s) return defaultBare;
  const prefixRe = /^arrêt provisoire\s*:\s*/i;
  if (prefixRe.test(s)) {
    const rest = s.replace(prefixRe, "").trim();
    return rest || defaultBare;
  }
  return s;
}

/**
 * Saisie du nom (modale HTML, même style que les autres messages du simulateur).
 * Prérempli « Arrêt provisoire : » ; normalisation côté pose sur la carte.
 * @returns {Promise<string|null>}
 */
function openProvisionalStopNameDialog() {
  return showAppPromptDialog(
    TAM_APP_DIALOG_TITLE,
    "Saisir le nom de l’arrêt provisoire (projeté sur le tracé) :",
    PROVISIONAL_STOP_NAME_PREFIX,
  );
}

map.on("click", async (ev) => {
  if (
    opsState.provisionalEditActive &&
    !manualDrawActive &&
    currentPattern &&
    pathTotalMeters > 0 &&
    ev?.latlng
  ) {
    const nameIn = await openProvisionalStopNameDialog();
    if (nameIn === null) {
      return;
    }
    const trimmed = normalizeProvisionalStopNameInput(nameIn);
    const id = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const projM = distanceAlongPathForLatLng(
      ev.latlng.lat,
      ev.latlng.lng,
    );
    const snapped = pointAtDistanceMeters(projM);
    opsState.provisionalStops.push({
      id,
      stop_name: trimmed,
      lat: snapped[0],
      lon: snapped[1],
    });
    recomputeSkippedStopsForCurrentMission();
    rebuildActiveGuideStops();
    drawProvisionalStopsOverlay();
    drawAllStopsOverlay();
    drawSkippedStopsOverlay();
    updateStopToStopOverlay();
    updateStats();
    resyncVoixForPosition(distanceAlongPathMeters);
    refreshProvisionalUi();
    refreshTemporaryDeviationUi();
    setGpsStatus(
      typeof provisionalStopPublicLabel === "function"
        ? `${provisionalStopPublicLabel(trimmed)} — ajouté.`
        : `Arrêt provisoire ajouté : ${trimmed}`,
    );
    return;
  }
  if (
    opsState.manualActive &&
    opsState.manualProfile &&
    !manualDrawActive &&
    !opsState.provisionalEditActive &&
    !opsState.nonServedEditActive &&
    ev?.latlng &&
    manualDetourOverlays.getLayers().length > 0
  ) {
    const hit = pickManualDetourSegmentAtLatLng(ev.latlng);
    if (
      hit >= 0 &&
      manualTraceSegmentSelectEl &&
      !manualTraceSegmentSelectEl.disabled
    ) {
      manualTraceSegmentSelectEl.value = String(hit);
      applyManualDeviationOverlayStyles(getMapVisualProfile());
      const n = manualProfileToVisualChainArray(
        opsState.manualProfile,
      ).length;
      L.popup({ maxWidth: 300, className: "tam-portion-popup-wrap" })
        .setLatLng(ev.latlng)
        .setContent(
          `<div style="line-height:1.35"><strong>Déviation ${hit + 1}</strong> sur ${n}<br/><span style="font-size:12px;opacity:.88">Liste « Déviation à supprimer » alignée sur cette déviation.</span></div>`,
        )
        .openOn(map);
      setGpsStatus(
        `Déviation ${hit + 1} sur ${n} — identifiée sur la carte.`,
      );
      return;
    }
  }
  if (!opsState.manualActive || !opsState.nonServedEditActive) {
    return;
  }
  if (
    typeof performance !== "undefined" &&
    performance.now() < nonServedEditSuppressMapClearUntil
  ) {
    return;
  }
  if (nonServedEditFocusStopId == null) {
    return;
  }
  nonServedEditFocusStopId = null;
  drawAllStopsOverlay();
  drawSkippedStopsOverlay();
});

function uniqueValues(arr, getter) {
  return [...new Set(arr.map(getter))];
}

function setRecapVisible(on) {
  if (!mapRecapEl || !recapToggleBtn) return;
  mapRecapEl.classList.toggle("show", !!on);
  recapToggleBtn.classList.toggle("active", !!on);
  try {
    localStorage.setItem(LS_KEY_RECAP, on ? "1" : "0");
  } catch (e) {
    // ignore
  }
  refreshMapLayout();
}

function flattenPolylineCoordsForDistance(latlngs) {
  if (!latlngs?.length) return [];
  const head = latlngs[0];
  if (head && typeof head.lat === "number") {
    return latlngs.map((x) => [Number(x.lat), Number(x.lng)]);
  }
  return flattenPolylineCoordsForDistance(latlngs.flat());
}

/** Distance minimale (m) d’un point à une polyline [lat,lng][]. */
function distanceLatLngToPolylineMinMeters(latlng, coordPairs) {
  if (!coordPairs || coordPairs.length < 2) return Infinity;
  const p = L.latLng(latlng.lat, latlng.lng);
  let best = Infinity;
  for (let i = 0; i < coordPairs.length - 1; i++) {
    const a = L.latLng(coordPairs[i][0], coordPairs[i][1]);
    const b = L.latLng(coordPairs[i + 1][0], coordPairs[i + 1][1]);
    const segLen = a.distanceTo(b);
    const steps = Math.max(3, Math.min(28, Math.ceil(segLen / 14)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const lat = a.lat + t * (b.lat - a.lat);
      const lng = a.lng + t * (b.lng - a.lng);
      const d = p.distanceTo(L.latLng(lat, lng));
      if (d < best) best = d;
    }
  }
  return best;
}

/** Indice de portion (0-based) sous le clic, ou -1. */
function pickManualDetourSegmentAtLatLng(latlng) {
  let bestIdx = -1;
  let bestD = Infinity;
  manualDetourOverlays.eachLayer((ly) => {
    const idx = ly.__tamManualSegIdx;
    if (idx == null || typeof ly.getLatLngs !== "function") return;
    const pairs = flattenPolylineCoordsForDistance(ly.getLatLngs());
    const d = distanceLatLngToPolylineMinMeters(latlng, pairs);
    if (d < bestD) {
      bestD = d;
      bestIdx = idx;
    }
  });
  const z = typeof map?.getZoom === "function" ? map.getZoom() : 13;
  const threshM = z >= 17 ? 18 : z >= 15 ? 28 : 42;
  if (!Number.isFinite(bestD) || bestD > threshM) return -1;
  return bestIdx;
}

/** Met en évidence la portion sélectionnée dans la liste (détour jaune + contour évité). */
function applyManualDeviationOverlayStyles(p) {
  const pVisual = p || getMapVisualProfile();
  const selIdx = parseInt(manualTraceSegmentSelectEl?.value ?? "", 10);
  const chainLen = manualProfileToVisualChainArray(
    opsState.manualProfile,
  ).length;
  const hasSel =
    !!manualTraceSegmentSelectEl &&
    !manualTraceSegmentSelectEl.disabled &&
    Number.isFinite(selIdx) &&
    selIdx >= 0 &&
    selIdx < chainLen;

  manualBypassOverlays.eachLayer((ly) => {
    if (!ly?.setStyle) return;
    const idx = ly.__tamManualSegIdx;
    if (idx == null) return;
    const hi = hasSel && idx === selIdx;
    ly.setStyle({
      color: "#111111",
      weight: hi
        ? pVisual.manualBypassWeight + 2
        : pVisual.manualBypassWeight,
      opacity: hasSel && !hi ? 0.38 : 0.95,
      dashArray: hi ? "16 7" : "10 8",
    });
  });
  manualDetourOverlays.eachLayer((ly) => {
    if (!ly?.setStyle) return;
    const idx = ly.__tamManualSegIdx;
    if (idx == null) return;
    const hi = hasSel && idx === selIdx;
    if (hi) {
      ly.setStyle({
        color: "#fff176",
        weight: pVisual.manualDetourWeight + 3,
        opacity: 1,
        dashArray: "14 10",
      });
    } else {
      ly.setStyle({
        color: "#ffd400",
        weight: pVisual.manualDetourWeight,
        opacity: hasSel && !hi ? 0.45 : 0.95,
        dashArray: null,
      });
    }
  });
}

function getMapVisualProfile() {
  const z = Number(map?.getZoom?.() || 13);
  const t = Math.max(0, Math.min(1, (z - 11) / 7));
  const lerp = (a, b) => a + (b - a) * t;
  return {
    fullWeight: lerp(4, 9),
    doneWeight: lerp(5, 11),
    manualBypassWeight: lerp(4, 10),
    manualDetourWeight: lerp(4, 10),
    draftWeight: lerp(4, 9),
    stopRadius: lerp(5, 10),
    stopStroke: lerp(1, 2.2),
    skippedRadius: lerp(6, 12),
    skippedStroke: lerp(1.2, 2.5),
    draftPointRadiusMain: lerp(3.5, 7),
    draftPointRadius: lerp(3, 6),
  };
}

function applyMapVisualProfile() {
  const p = getMapVisualProfile();
  fullLine.setStyle({ weight: p.fullWeight });
  doneLine.setStyle({ weight: p.doneWeight });
  applyManualDeviationOverlayStyles(p);
  if (manualDraftLine) {
    manualDraftLine.setStyle({ weight: p.draftWeight });
  }
  if (manualDraftMarkers?.length) {
    manualDraftMarkers.forEach((m, idx) => {
      const r = idx === 0 ? p.draftPointRadiusMain : p.draftPointRadius;
      if (typeof m.setRadius === "function") m.setRadius(r);
      if (typeof m.setStyle === "function")
        m.setStyle({ weight: p.stopStroke });
    });
  }
  drawAllStopsOverlay();
  drawSkippedStopsOverlay();
  drawProvisionalStopsOverlay();
  stopToStopLayer.__tamSegIdx = -1;
  updateStopToStopOverlay();
}

/** Liste déroulante des portions chaînées (ordre des validations). */
function refreshManualTraceSegmentSelectUi() {
  const sel = manualTraceSegmentSelectEl;
  if (!sel) return;
  const chain = manualProfileToVisualChainArray(opsState.manualProfile);
  const prevRaw = sel.value;
  sel.innerHTML = "";
  if (!chain.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  chain.forEach((_, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Déviation ${i + 1} (${chain.length} au total)`;
    sel.appendChild(opt);
  });
  let pick = chain.length - 1;
  const prev = parseInt(prevRaw, 10);
  if (!Number.isNaN(prev) && prev >= 0 && prev < chain.length) {
    pick = prev;
  }
  sel.value = String(pick);
  applyManualDeviationOverlayStyles(getMapVisualProfile());
}

/** Le brouillon de tracé en cours fait partie de la session temporaire. */
function temporarySessionOwnsDraft() {
  return !!manualDrawActive && !!opsState.temporaryDeviationActive;
}
/** Brouillon lancé depuis la barre planifiée (pas de session temp encore). */
function plannedSubtabOwnsDraft() {
  return !!manualDrawActive && !opsState.temporaryDeviationActive;
}
function refreshManualDrawUi() {
  const planDraft = plannedSubtabOwnsDraft();
  const tempDraft = temporarySessionOwnsDraft();
  const tempSess = !!opsState.temporaryDeviationActive;

  if (manualDrawStartBtn) {
    let dis = false;
    let txt = "Tracer la déviation planifiée";
    if (tempDraft) {
      txt = "Tracé en cours depuis Temporaire";
      dis = true;
    } else if (planDraft) {
      txt = "Quitter le tracé (carte)";
    } else if (tempSess) {
      /** Pas de crayon « actif » : Planifiée redevient cliquable. */
      txt = "Tracer la déviation planifiée";
      dis = false;
    }
    manualDrawStartBtn.textContent = txt;
    manualDrawStartBtn.disabled = dis;
    manualDrawStartBtn.title =
      tempSess && !tempDraft && !planDraft
        ? "Session Temporaire ouverte. « Quitter le tracé » (sans valider) retire toujours les points. « Rétablir… » ramène tracé validé, arrêts non desservis et provisoires comme au début de la session."
        : "";
  }

  if (manualDrawUndoBtn) {
    manualDrawUndoBtn.disabled =
      !planDraft || manualDraftPoints.length === 0;
    manualDrawUndoBtn.title =
      tempDraft && manualDraftPoints.length > 0
        ? "Utilisez le même contrôle sous Déviation > Temporaire."
        : "";
  }

  if (manualDrawSaveBtn) {
    manualDrawSaveBtn.disabled =
      !planDraft || manualDraftPoints.length < 2;
    manualDrawSaveBtn.textContent =
      "Valider le tracé de la déviation planifiée";
    manualDrawSaveBtn.title =
      tempDraft && manualDraftPoints.length >= 2
        ? "Validez le tracé depuis Déviation > Temporaire."
        : "";
  }

  if (tempManualDrawStartBtn) {
    let dis = false;
    let txt = "Tracer la déviation temporaire";
    if (planDraft) {
      txt = "Tracer la déviation temporaire";
      dis = true;
    } else if (tempDraft) {
      txt = "Quitter le tracé (carte)";
    }
    tempManualDrawStartBtn.textContent = txt;
    tempManualDrawStartBtn.disabled = dis;
    tempManualDrawStartBtn.title =
      planDraft &&
      manualDraftPoints.length > 0
        ? "Un tracé est en cours depuis Planifiée : quittez ou validez le tracé là-bas d’abord."
        : "";
  }

  if (tempManualDrawUndoBtn) {
    tempManualDrawUndoBtn.disabled =
      !tempDraft || manualDraftPoints.length === 0;
  }

  if (tempManualDrawSaveBtn) {
    tempManualDrawSaveBtn.disabled =
      !tempDraft || manualDraftPoints.length < 2;
    tempManualDrawSaveBtn.textContent =
      "Valider le tracé de la déviation temporaire";
    tempManualDrawSaveBtn.title = "";
  }
  if (manualTraceClearBtn) {
    const hasValidatedTrace =
      opsState.manualProfile &&
      Array.isArray(opsState.manualProfile.mergedCoords) &&
      opsState.manualProfile.mergedCoords.length >= 2;
    const hasDraft = !!manualDrawActive && manualDraftPoints.length > 0;
    manualTraceClearBtn.disabled = !hasValidatedTrace && !hasDraft;
  }
  refreshManualTraceSegmentSelectUi();
  if (manualTraceRemoveSegmentBtn) {
    const chainSegs = manualProfileToVisualChainArray(
      opsState.manualProfile,
    ).length;
    const blockedDraft =
      !!manualDrawActive && manualDraftPoints.length > 0;
    manualTraceRemoveSegmentBtn.disabled =
      chainSegs === 0 || blockedDraft;
  }
  if (nonServedBtn) {
    nonServedBtn.classList.toggle(
      "active",
      !!opsState.nonServedEditActive,
    );
    nonServedBtn.textContent = opsState.nonServedEditActive
      ? "Quitter le mode arrêt non desservi"
      : "Saisir arrêt non desservi";
  }
  refreshProvisionalUi();
}

function refreshProvisionalUi() {
  if (provisionalStopBtn) {
    provisionalStopBtn.classList.toggle(
      "active",
      !!opsState.provisionalEditActive,
    );
    provisionalStopBtn.textContent = opsState.provisionalEditActive
      ? "Quitter la saisie arrêts provisoires"
      : "Saisir arrêts provisoires";
  }
  if (provisionalUndoBtn) {
    provisionalUndoBtn.disabled = !opsState.provisionalStops?.length;
  }
}

function clearManualDraftVisuals() {
  manualDraftLayer.clearLayers();
  manualDraftLine = null;
  manualDraftMarkers = [];
}

function redrawManualDraftVisuals() {
  clearManualDraftVisuals();
  if (!manualDraftPoints.length) {
    refreshManualDrawUi();
    return;
  }
  const p = getMapVisualProfile();
  manualDraftLine = L.polyline(manualDraftPoints, {
    color: "#ff7f00",
    weight: p.draftWeight,
    opacity: 0.95,
    dashArray: "9 8",
  }).addTo(manualDraftLayer);
  manualDraftMarkers = manualDraftPoints.map((pt, idx) =>
    L.circleMarker(pt, {
      radius: idx === 0 ? p.draftPointRadiusMain : p.draftPointRadius,
      color: "#ff7f00",
      fillColor: "#ff7f00",
      fillOpacity: 0.95,
      weight: p.stopStroke,
    }).addTo(manualDraftLayer),
  );
  refreshManualDrawUi();
}

function stopManualDrawMode(opts) {
  const o = opts || {};
  manualDrawActive = false;
  if (!o.keepPoints) {
    manualDraftPoints = [];
    clearManualDraftVisuals();
  }
  refreshManualDrawUi();
}

function startManualDrawMode() {
  manualDrawActive = true;
  manualDraftPoints = [];
  clearManualDraftVisuals();
  refreshManualDrawUi();
  setGpsStatus(
    opsState.temporaryDeviationActive
      ? "Tracé de la déviation temporaire actif : touchez la carte pour poser des points."
      : "Tracé de la déviation planifiée actif : touchez la carte pour poser des points.",
  );
}

function buildCumMetersForCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return [0];
  const cum = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    const d = L.latLng(coords[i]).distanceTo(L.latLng(coords[i + 1]));
    cum.push(cum[i] + d);
  }
  return cum;
}

function distanceAlongCoordsForLatLng(coords, cum, lat, lng) {
  if (!coords || coords.length < 2 || !cum || !cum.length) return 0;
  const s = L.latLng(lat, lng);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = L.latLng(coords[i]);
    const p1 = L.latLng(coords[i + 1]);
    const segLenM = p0.distanceTo(p1);
    if (segLenM < 1e-6) continue;
    const dLat = p1.lat - p0.lat;
    const dLng = p1.lng - p0.lng;
    const a0 = s.lat - p0.lat;
    const b0 = s.lng - p0.lng;
    const len2 = dLat * dLat + dLng * dLng;
    const t = Math.max(0, Math.min(1, (a0 * dLat + b0 * dLng) / len2));
    const proj = [p0.lat + t * dLat, p0.lng + t * dLng];
    const d = s.distanceTo(L.latLng(proj));
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * segLenM;
    }
  }
  return best;
}

function pointAtDistanceOnCoords(coords, cum, d) {
  if (!coords || coords.length < 2 || !cum || !cum.length) {
    return coords && coords[0] ? coords[0] : [43.61, 3.88];
  }
  const total = cum[cum.length - 1] || 0;
  if (d <= 0) return coords[0];
  if (d >= total) return coords[coords.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cum[mid] < d) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const a = coords[i];
  const b = coords[i + 1];
  const d0 = cum[i];
  const d1 = cum[i + 1];
  const seg = d1 - d0;
  const t = seg < 1e-6 ? 0 : (d - d0) / seg;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function windowOnCoordsBetweenMeters(coords, cum, d0, d1) {
  if (!coords || coords.length < 2 || !cum || !cum.length) return [];
  const total = cum[cum.length - 1] || 0;
  const from = Math.max(0, Math.min(total, d0));
  const to = Math.max(0, Math.min(total, d1));
  if (Math.abs(to - from) < 1e-3) return [];
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const pts = [pointAtDistanceOnCoords(coords, cum, lo)];
  for (let i = 1; i < coords.length - 1; i++) {
    if (cum[i] > lo && cum[i] < hi) pts.push(coords[i]);
  }
  pts.push(pointAtDistanceOnCoords(coords, cum, hi));
  if (from > to) pts.reverse();
  return pts;
}

/** Fusionne des intervalles [m] sur la base mission (chevauchements ou presque contigus). */
function mergeBypassRangesOnBase(pairs) {
  const sorted = [...pairs]
    .map(([a, b]) => [
      Math.min(Number(a), Number(b)),
      Math.max(Number(a), Number(b)),
    ])
    .filter(
      ([lo, hi]) =>
        Number.isFinite(lo) && Number.isFinite(hi) && hi - lo > 0.5,
    )
    .sort((x, y) => x[0] - y[0]);
  if (!sorted.length) return [];
  const gapMergeM = 12;
  const out = [];
  let cur = [sorted[0][0], sorted[0][1]];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n[0] <= cur[1] + gapMergeM) {
      cur[1] = Math.max(cur[1], n[1]);
    } else {
      out.push(cur);
      cur = [n[0], n[1]];
    }
  }
  out.push(cur);
  return out;
}

/**
 * Intervalles sur la base GTFS couverts par un ou plusieurs détours manuels chaînés.
 * Ancien format : un seul couple startDistance / endDistance sur la base.
 */
function normalizeBypassRangesOnBase(mp) {
  if (!mp || typeof mp !== "object") return [];
  const raw = mp.baseBypassRanges;
  if (Array.isArray(raw) && raw.length) {
    const pairs = [];
    for (const it of raw) {
      if (Array.isArray(it) && it.length >= 2) {
        pairs.push([Number(it[0]), Number(it[1])]);
      }
    }
    const m = mergeBypassRangesOnBase(pairs);
    if (m.length) return m;
  }
  const a = Number(mp.startDistance);
  const b = Number(mp.endDistance);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return mergeBypassRangesOnBase([[a, b]]);
  }
  return [];
}

/**
 * Fusionne un détour sur une géométrie de référence (base ou ligne déjà fusionnée).
 * Avec startDistanceOnBase / endDistanceOnBase (m sur la polyline base mission), les coupures
 * suivent la projection de ces abscisses sur la référence : chaque portion peut être retirée
 * sans invalider les autres (recalcul dans l’ordre des validations).
 */
function mergeManualDetourOntoReference(base, reference, seg) {
  if (!Array.isArray(base) || base.length < 2) return null;
  if (!Array.isArray(reference) || reference.length < 2) return null;
  const draftPoints = Array.isArray(seg.detourCoords)
    ? seg.detourCoords.map((pt) => [Number(pt[0]), Number(pt[1])])
    : [];
  if (draftPoints.length < 2) return null;

  const cumBase = buildCumMetersForCoords(base);
  const cum = buildCumMetersForCoords(reference);
  const total = cum[cum.length - 1] || 0;

  let detourCoords = draftPoints.map((pt) => [...pt]);
  let dA;
  let dB;
  let segOnBase;

  const s0 = Number(seg.startDistanceOnBase);
  const s1 = Number(seg.endDistanceOnBase);
  const useAnchors =
    Number.isFinite(s0) && Number.isFinite(s1) && Math.abs(s1 - s0) > 0.5;

  if (useAnchors) {
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    const ptOnBaseA = pointAtDistanceOnCoords(base, cumBase, lo);
    const ptOnBaseB = pointAtDistanceOnCoords(base, cumBase, hi);
    dA = distanceAlongCoordsForLatLng(
      reference,
      cum,
      ptOnBaseA[0],
      ptOnBaseA[1],
    );
    dB = distanceAlongCoordsForLatLng(
      reference,
      cum,
      ptOnBaseB[0],
      ptOnBaseB[1],
    );
    segOnBase = [lo, hi];
  } else {
    const a = detourCoords[0];
    const bPt = detourCoords[detourCoords.length - 1];
    dA = distanceAlongCoordsForLatLng(reference, cum, a[0], a[1]);
    dB = distanceAlongCoordsForLatLng(reference, cum, bPt[0], bPt[1]);
    if (!Number.isFinite(dA) || !Number.isFinite(dB)) return null;
    if (dA > dB) {
      const tmp = dA;
      dA = dB;
      dB = tmp;
      detourCoords.reverse();
    }
    if (reference === base) {
      segOnBase = [dA, dB];
    } else {
      const ptA = pointAtDistanceOnCoords(reference, cum, dA);
      const ptB = pointAtDistanceOnCoords(reference, cum, dB);
      const daB = distanceAlongCoordsForLatLng(
        base,
        cumBase,
        ptA[0],
        ptA[1],
      );
      const dbB = distanceAlongCoordsForLatLng(
        base,
        cumBase,
        ptB[0],
        ptB[1],
      );
      if (!Number.isFinite(daB) || !Number.isFinite(dbB)) return null;
      segOnBase = [Math.min(daB, dbB), Math.max(daB, dbB)];
    }
  }

  if (!Number.isFinite(dA) || !Number.isFinite(dB)) return null;
  if (dA > dB) {
    const tmp = dA;
    dA = dB;
    dB = tmp;
    detourCoords.reverse();
  }
  if (Math.abs(dB - dA) < 1) return null;

  const before = windowOnCoordsBetweenMeters(reference, cum, 0, dA);
  const after = windowOnCoordsBetweenMeters(reference, cum, dB, total);
  const bypassedCoords = windowOnCoordsBetweenMeters(
    reference,
    cum,
    dA,
    dB,
  );
  const mergedCoords = [...before, ...detourCoords, ...after];
  if (mergedCoords.length < 2) return null;

  return {
    mergedCoords,
    bypassedCoords,
    detourCoords,
    segOnBase,
    dA,
    dB,
  };
}

/** Anciennes fiches sans ancres base : complète les maillons (sans changer mergedCoords stocké). */
function fillMissingManualSegmentBaseAnchors(mp) {
  if (!mp || typeof mp !== "object") return;
  const base = opsState.baseCoordinates;
  if (!Array.isArray(base) || base.length < 2) return;
  const chain = mp.detourVisualChain;
  if (!Array.isArray(chain) || chain.length === 0) return;
  let previousMerged = null;
  for (let i = 0; i < chain.length; i++) {
    const seg = chain[i];
    const sb = Number(seg.startDistanceOnBase);
    const se = Number(seg.endDistanceOnBase);
    const hasAnchors =
      Number.isFinite(sb) &&
      Number.isFinite(se) &&
      Math.abs(se - sb) > 0.5;
    const mr = mergeManualDetourOntoReference(
      base,
      previousMerged && previousMerged.length >= 2
        ? previousMerged
        : base,
      seg,
    );
    if (!mr) return;
    if (!hasAnchors) {
      seg.startDistanceOnBase = mr.segOnBase[0];
      seg.endDistanceOnBase = mr.segOnBase[1];
    }
    previousMerged = mr.mergedCoords;
  }
}

function buildManualProfileFromDraft(draftPoints) {
  const base = opsState.baseCoordinates;
  if (!Array.isArray(base) || base.length < 2) return null;
  if (!Array.isArray(draftPoints) || draftPoints.length < 2) return null;
  const previousProfile =
    opsState.manualActive &&
    opsState.manualProfile &&
    Array.isArray(opsState.manualProfile.mergedCoords) &&
    opsState.manualProfile.mergedCoords.length >= 2
      ? opsState.manualProfile
      : null;
  const reference =
    previousProfile?.mergedCoords?.length >= 2
      ? previousProfile.mergedCoords
      : base;

  const mergedResult = mergeManualDetourOntoReference(base, reference, {
    detourCoords: draftPoints.map((pt) => [...pt]),
  });
  if (!mergedResult) return null;

  const {
    mergedCoords,
    bypassedCoords,
    detourCoords,
    segOnBase,
    dA,
    dB,
  } = mergedResult;

  const prevRanges = previousProfile
    ? normalizeBypassRangesOnBase(previousProfile)
    : [];
  const baseBypassRanges = mergeBypassRangesOnBase([
    ...prevRanges,
    segOnBase,
  ]);

  const linkSeg = normalizeDeviationChainSegmentFromStored({
    detourCoords,
    bypassedCoords,
    startDistanceOnBase: segOnBase[0],
    endDistanceOnBase: segOnBase[1],
  });
  const detourVisualChain =
    previousProfile &&
    Array.isArray(previousProfile.detourVisualChain) &&
    previousProfile.detourVisualChain.length
      ? [
          ...previousProfile.detourVisualChain.map(
            normalizeDeviationChainSegmentFromStored,
          ),
          linkSeg,
        ]
      : [linkSeg];

  return {
    startDistance: dA,
    endDistance: dB,
    detourCoords,
    bypassedCoords,
    mergedCoords,
    baseBypassRanges,
    detourVisualChain,
  };
}

/** Copie profonde d’un JSON sérialisable (état payload / overrides). */
function tamCloneSerializable(fallback, src) {
  try {
    return JSON.parse(JSON.stringify(src !== undefined ? src : fallback));
  } catch {
    return fallback;
  }
}

/** Liste de paires [lat,lng] numériques. */
function tamMapLatLngPairs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((xy) => [Number(xy[0]), Number(xy[1])]);
}

/**
 * Segment de chaîne déviation depuis stockage ou payload (coords + ancres base si présentes).
 * Unique source utilisée pour manualProfileToVisualChain, sauvegarde et restauration.
 */
function normalizeDeviationChainSegmentFromStored(seg) {
  const o = {
    detourCoords: tamMapLatLngPairs(seg.detourCoords),
    bypassedCoords: tamMapLatLngPairs(seg.bypassedCoords),
  };
  const sb = Number(seg.startDistanceOnBase);
  const se = Number(seg.endDistanceOnBase);
  if (
    Number.isFinite(sb) &&
    Number.isFinite(se) &&
    Math.abs(se - sb) > 0.5
  ) {
    o.startDistanceOnBase = sb;
    o.endDistanceOnBase = se;
  }
  return o;
}

/** Segments successifs issus du stockage (chaîne ou ancien format une seule portion). */
function manualProfileToVisualChainArray(mp) {
  if (!mp || typeof mp !== "object") return [];
  if (
    Array.isArray(mp.detourVisualChain) &&
    mp.detourVisualChain.length
  ) {
    return mp.detourVisualChain.map(
      normalizeDeviationChainSegmentFromStored,
    );
  }
  if (Array.isArray(mp.detourCoords) && mp.detourCoords.length >= 2) {
    return [
      normalizeDeviationChainSegmentFromStored({
        detourCoords: mp.detourCoords,
        bypassedCoords: mp.bypassedCoords,
      }),
    ];
  }
  return [];
}

/** Recalcule un profil à partir d’une chaîne complète (suppression d’une portion au milieu, etc.). */
function rebuildManualProfileFromVisualChain(chain) {
  const base = opsState.baseCoordinates;
  if (!Array.isArray(base) || base.length < 2 || !Array.isArray(chain)) {
    return null;
  }
  if (chain.length === 0) return null;

  let previousProfile = null;
  const mergedChainOut = [];

  for (let ci = 0; ci < chain.length; ci++) {
    const segIn = chain[ci];
    const reference =
      previousProfile?.mergedCoords?.length >= 2
        ? previousProfile.mergedCoords
        : base;
    const mergedResult = mergeManualDetourOntoReference(
      base,
      reference,
      segIn,
    );
    if (!mergedResult) return null;

    const linkSeg = normalizeDeviationChainSegmentFromStored({
      detourCoords: mergedResult.detourCoords,
      bypassedCoords: mergedResult.bypassedCoords,
      startDistanceOnBase: mergedResult.segOnBase[0],
      endDistanceOnBase: mergedResult.segOnBase[1],
    });
    mergedChainOut.push(linkSeg);

    const prevRanges = previousProfile
      ? normalizeBypassRangesOnBase(previousProfile)
      : [];
    const baseBypassRanges = mergeBypassRangesOnBase([
      ...prevRanges,
      mergedResult.segOnBase,
    ]);

    previousProfile = {
      startDistance: mergedResult.dA,
      endDistance: mergedResult.dB,
      detourCoords: mergedResult.detourCoords,
      bypassedCoords: mergedResult.bypassedCoords,
      mergedCoords: mergedResult.mergedCoords,
      baseBypassRanges,
      detourVisualChain: mergedChainOut.map(
        normalizeDeviationChainSegmentFromStored,
      ),
    };
  }

  return previousProfile;
}

function clearManualRouteOverlayLayers() {
  manualBypassOverlays.clearLayers();
  manualDetourOverlays.clearLayers();
}

function rebuildManualDeviationOverlaysVisual() {
  clearManualRouteOverlayLayers();
  if (!opsState.manualProfile || !opsState.manualActive) return;
  const mp = opsState.manualProfile;
  let chains =
    Array.isArray(mp.detourVisualChain) && mp.detourVisualChain.length
      ? mp.detourVisualChain
      : [];
  if (
    chains.length === 0 &&
    Array.isArray(mp.detourCoords) &&
    mp.detourCoords.length >= 2
  ) {
    chains = [
      {
        detourCoords: mp.detourCoords,
        bypassedCoords: mp.bypassedCoords || [],
      },
    ];
  }
  const p = getMapVisualProfile();
  chains.forEach((seg, segIdx) => {
    const byp = Array.isArray(seg.bypassedCoords)
      ? seg.bypassedCoords
      : [];
    const det = Array.isArray(seg.detourCoords) ? seg.detourCoords : [];
    if (byp.length >= 2) {
      const line = L.polyline(byp, {
        color: "#111111",
        weight: p.manualBypassWeight,
        opacity: 0.95,
        dashArray: "10 8",
      });
      line.__tamManualSegIdx = segIdx;
      manualBypassOverlays.addLayer(line);
    }
    if (det.length >= 2) {
      const line = L.polyline(det, {
        color: "#ffd400",
        weight: p.manualDetourWeight,
        opacity: 0.95,
      });
      line.__tamManualSegIdx = segIdx;
      manualDetourOverlays.addLayer(line);
    }
  });
  applyManualDeviationOverlayStyles(p);
}

function updateManualDeviationVisual(mode) {
  clearManualRouteOverlayLayers();
  if (
    mode === OPS_MODE.MANUEL &&
    opsState.manualProfile &&
    opsState.manualActive
  ) {
    rebuildManualDeviationOverlaysVisual();
  }
}

map.on("click", (e) => {
  if (!manualDrawActive) return;
  const lat = Number(e?.latlng?.lat);
  const lng = Number(e?.latlng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }
  manualDraftPoints.push([lat, lng]);
  redrawManualDraftVisuals();
});

function setPanelTab(panelName) {
  if (!controlPanelEl) return;
  const sections = controlPanelEl.querySelectorAll(".panel-section");
  sections.forEach((s) => s.classList.remove("show"));
  [missionTabBtn, opsTabBtn, voiceTabBtn, helpTabBtn].forEach(
    (b) => b && b.classList.remove("active"),
  );
  if (panelName === "mission") {
    controlPanelEl
      .querySelectorAll(".panel-mission")
      .forEach((s) => s.classList.add("show"));
    missionTabBtn?.classList.add("active");
  } else if (panelName === "ops") {
    controlPanelEl.querySelectorAll(".panel-ops").forEach((s) => {
      if (s.hasAttribute("data-ops-sub")) {
        s.classList.remove("show");
      } else {
        s.classList.add("show");
      }
    });
    applyOpsPanelsVisibility();
    opsTabBtn?.classList.add("active");
  } else if (panelName === "voice") {
    controlPanelEl
      .querySelectorAll(".panel-audio")
      .forEach((s) => s.classList.add("show"));
    voiceTabBtn?.classList.add("active");
  } else if (panelName === "help") {
    controlPanelEl
      .querySelectorAll(".panel-help")
      .forEach((s) => s.classList.add("show"));
    helpTabBtn?.classList.add("active");
  }
  controlPanelRememberTab = panelName;
}

/** Sans argument : rouvre sur le dernier onglet mémorisé. */
function openControlPanel(tabName) {
  if (!controlPanelEl) return;
  controlPanelEl.classList.add("open");
  const tab =
    tabName !== undefined && tabName !== null && tabName !== ""
      ? tabName
      : controlPanelRememberTab || "mission";
  setPanelTab(tab);
  refreshMapLayout();
}

function closeControlPanel() {
  setLineListboxOpen(false);
  controlPanelEl?.classList.remove("open");
  refreshMapLayout();
}

function refreshMapLayout() {
  const run = () => {
    if (map && typeof map.invalidateSize === "function") {
      map.invalidateSize(false);
    }
  };
  run();
  setTimeout(run, 80);
  setTimeout(run, 260);
  setTimeout(run, 650);
}

function appendOpsLog(action, note) {
  const p = currentPattern || selectedPattern();
  try {
    const raw = localStorage.getItem(LS_KEY_OPS_LOG);
    const logs = raw ? JSON.parse(raw) : [];
    logs.push({
      ts: new Date().toISOString(),
      line: p?.route_short_name || "",
      headsign: p?.headsign || "",
      variant: p?.variant_name || "",
      action,
      mode: opsState.mode,
      note: note || "",
    });
    localStorage.setItem(
      LS_KEY_OPS_LOG,
      JSON.stringify(logs.slice(-300)),
    );
  } catch (e) {
    // ignore
  }
}

function recomputeOpsMode() {
  if (opsState.manualActive) return OPS_MODE.MANUEL;
  return OPS_MODE.BASE;
}

function describeOpsState() {
  if (opsState.mode === OPS_MODE.MANUEL)
    return "Déviation manuelle active.";
  return "Aucune déviation active.";
}

function applyOpsStateUi() {
  opsState.mode = recomputeOpsMode();
  if (modeActiveEl) modeActiveEl.textContent = opsState.mode;
  if (modeStatusEl) modeStatusEl.textContent = describeOpsState();
  refreshManualDrawUi();
  refreshTemporaryDeviationUi();
}

function refreshTemporaryDeviationUi() {
  const temporarySessionOn = !!opsState.temporaryDeviationActive;
  const pat = selectedPattern();
  const hasMission = !!pat;
  const hasContent = !deviationPayloadIsEmpty(
    deviationPayloadFromLiveState(),
  );
  const tipWhenSavingNeedsContent =
    "Ce bouton s’active si vous validez un tracé sur la carte ou si vous saisissez au moins un arrêt non desservi ou provisoire.";

  const liveJson =
    typeof deviationPayloadJsonForCompare === "function"
      ? deviationPayloadJsonForCompare(deviationPayloadFromLiveState())
      : "";
  const baselineReady = plannedDeviationSaveBaselineJson != null;
  const payloadDirty =
    hasMission &&
    hasContent &&
    baselineReady &&
    liveJson !== plannedDeviationSaveBaselineJson;

  if (saveDeviationBtn) {
    const { disabled, title } = computePlannedSaveDeviationToolbarState({
      temporarySessionOn,
      hasMission,
      hasContent,
      deferPlannedGate: deferPlannedSaveUntilEditedAfterTempRecorded,
      payloadDirty,
      tipWhenSavingNeedsContent,
    });
    saveDeviationBtn.disabled = disabled;
    saveDeviationBtn.title = title;
    saveDeviationBtn.classList.toggle("secondary", disabled);
  }
  if (temporarySaveDeviationBtn) {
    const { disabled, title } = computeTemporarySaveDeviationToolbarState({
      temporarySessionOn,
      hasMission,
      hasContent,
      tipWhenSavingNeedsContent,
    });
    temporarySaveDeviationBtn.disabled = disabled;
    temporarySaveDeviationBtn.title = title;
    temporarySaveDeviationBtn.classList.toggle("secondary", disabled);
  }
  if (lineSelect) lineSelect.disabled = temporarySessionOn;
  if (headsignSelect) headsignSelect.disabled = temporarySessionOn;
  if (variantSelect) variantSelect.disabled = temporarySessionOn;
  if (lineSelectTrigger) lineSelectTrigger.disabled = temporarySessionOn;
  if (typeof refreshUnsavedDeviationBannerUi === "function") {
    refreshUnsavedDeviationBannerUi();
  }
}

/** Lève la barrière planifiée après un « Enregistrer la déviation temporaire » (gestes distincts utilisateur). */
function unlockPlannedSaveAfterRecordedTemporaryDeviation() {
  if (!deferPlannedSaveUntilEditedAfterTempRecorded) return;
  deferPlannedSaveUntilEditedAfterTempRecorded = false;
  refreshTemporaryDeviationUi();
}

/** Juste après enregistrer en Temporaire : ne pas faire hériter le bouton Planifiée du même tracé carte. */
function deferPlannedSaveGateAfterRecordedTemporaryDeviation() {
  deferPlannedSaveUntilEditedAfterTempRecorded = true;
  refreshTemporaryDeviationUi();
}

function resetOpsStateForMission(ropts) {
  const ro = ropts || {};
  const preserveTemporarySnapshot =
    !!ro.preserveTemporarySnapshot || restoringTemporarySnapshot;
  opsState.manualActive = false;
  opsState.nonServedEditActive = false;
  opsState.mode = OPS_MODE.BASE;
  opsState.initialMode = OPS_MODE.BASE;
  opsState.returnMode = OPS_MODE.BASE;
  opsState.targetPatternId = "";
  opsState.baseCoordinates = null;
  opsState.modeCoordinates = {
    MANUEL_ACTIF: null,
  };
  opsState.manualProfile = null;
  opsState.manualStopOverrides = {};
  opsState.provisionalStops = [];
  opsState.provisionalEditActive = false;
  nonServedEditFocusStopId = null;
  clearManualRouteOverlayLayers();
  if (!preserveTemporarySnapshot) {
    opsState.temporaryDeviationActive = false;
    snapshotBeforeTemporary = null;
  }
  plannedDeviationEditSnapshot = null;
  deferPlannedSaveUntilEditedAfterTempRecorded = false;
  plannedDeviationSaveBaselineJson = null;
  if (typeof clearLiveDeviationLoadedSource === "function") {
    clearLiveDeviationLoadedSource();
  }
  applyOpsStateUi();
}

/** True tant qu'il faut empêcher de quitter la mission attachée au snapshot Temporaire. */
function missionViolatesTemporaryDeviationLock(pattern) {
  return (
    !restoringTemporarySnapshot &&
    !revertingMissionSelectors &&
    opsState.temporaryDeviationActive &&
    snapshotBeforeTemporary &&
    pattern &&
    String(pattern.pattern_id || "") !==
      String(snapshotBeforeTemporary.pattern_id || "")
  );
}

/**
 * Alerte puis repositionnement ligne/variante sur la mission du snapshot Temporaire.
 * @returns {object|null} entrée trouvée dans `data.patterns`
 */
function alertAndRevertMissionSelectorsForTemporaryLock(alertMessage) {
  tamAppAlert(alertMessage);
  const targetId = String(snapshotBeforeTemporary?.pattern_id || "");
  const pat =
    data?.patterns?.find((x) => String(x.pattern_id || "") === targetId) ||
    null;
  if (pat) {
    revertingMissionSelectors = true;
    try {
      selectMissionSelectorsForPattern(pat);
    } finally {
      revertingMissionSelectors = false;
    }
  }
  return pat;
}

/** Message informatif (titre fixe simulateur). */
function tamAppAlert(bodyText) {
  showAppMessageDialog(TAM_APP_DIALOG_TITLE, String(bodyText || ""));
}

/**
 * Message modal (titre + texte). Évite `window.alert` : pas d’en-tête d’origine (localhost)
 * ni case « Ne pas autoriser… à vous solliciter à nouveau » (Chrome, alertes répétées).
 * Retombe sur `window.alert` si `<dialog>` indisponible.
 */
function showAppMessageDialog(title, bodyText) {
  const dlg = document.getElementById("appMessageDialog");
  if (!dlg || typeof dlg.showModal !== "function") {
    window.alert((title ? `${title}\n\n` : "") + String(bodyText || ""));
    return;
  }
  if (!dlg.dataset.tamBackdropCloseWired) {
    dlg.dataset.tamBackdropCloseWired = "1";
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) dlg.close();
    });
  }
  const tEl = document.getElementById("appMessageDialogTitle");
  const bEl = document.getElementById("appMessageDialogBody");
  if (tEl) tEl.textContent = title || "Message";
  if (bEl) bEl.textContent = bodyText || "";
  dlg.returnValue = "";
  dlg.showModal();
}

/**
 * Confirmation (Oui / Non côté navigateur → OK / Annuler). Retombe sur `window.confirm` si besoin.
 * @returns {Promise<boolean>}
 */
function showAppConfirmDialog(title, bodyText) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("appConfirmDialog");
    if (!dlg || typeof dlg.showModal !== "function") {
      resolve(
        window.confirm(
          (title ? `${title}\n\n` : "") + String(bodyText || ""),
        ),
      );
      return;
    }
    if (!dlg.dataset.tamBackdropCloseWired) {
      dlg.dataset.tamBackdropCloseWired = "1";
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) dlg.close("cancel");
      });
    }
    const tEl = document.getElementById("appConfirmDialogTitle");
    const bEl = document.getElementById("appConfirmDialogBody");
    const okBtn = document.getElementById("appConfirmDialogOk");
    const cancelBtn = document.getElementById("appConfirmDialogCancel");
    if (tEl) tEl.textContent = title || TAM_APP_DIALOG_TITLE;
    if (bEl) {
      bEl.textContent = bodyText || "";
      bEl.style.whiteSpace = "pre-line";
    }
    const onOk = () => dlg.close("ok");
    const onCancel = () => dlg.close("cancel");
    const onClose = () => {
      okBtn?.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      resolve(dlg.returnValue === "ok");
    };
    dlg.addEventListener("close", onClose, { once: true });
    okBtn?.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    dlg.returnValue = "";
    dlg.showModal();
  });
}

/**
 * Saisie texte courte. Retombe sur `window.prompt` si `<dialog>` indisponible.
 * @returns {Promise<string|null>} chaîne saisie, ou `null` si Annuler / fermeture.
 */
function showAppPromptDialog(title, message, defaultValue) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("appPromptDialog");
    if (!dlg || typeof dlg.showModal !== "function") {
      resolve(
        window.prompt(
          (title ? `${title}\n\n` : "") + String(message || ""),
          defaultValue != null ? String(defaultValue) : "",
        ),
      );
      return;
    }
    if (!dlg.dataset.tamBackdropCloseWired) {
      dlg.dataset.tamBackdropCloseWired = "1";
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) dlg.close();
      });
    }
    const tEl = document.getElementById("appPromptDialogTitle");
    const mEl = document.getElementById("appPromptDialogMessage");
    const input = document.getElementById("appPromptDialogInput");
    const okBtn = document.getElementById("appPromptDialogOk");
    const cancelBtn = document.getElementById("appPromptDialogCancel");
    if (tEl) tEl.textContent = title || TAM_APP_DIALOG_TITLE;
    if (mEl) {
      mEl.textContent = message || "";
      mEl.hidden = !message;
    }
    if (input) {
      input.value = defaultValue != null ? String(defaultValue) : "";
    }
    const PENDING = {};
    let result = PENDING;
    const onClose = () => {
      okBtn?.removeEventListener("click", onOk);
      cancelBtn?.removeEventListener("click", onCancel);
      input?.removeEventListener("keydown", onInputKeydown);
      dlg.removeEventListener("close", onClose);
      resolve(result === PENDING ? null : result);
    };
    function onOk() {
      result = input ? input.value : "";
      dlg.close();
    }
    function onCancel() {
      result = null;
      dlg.close();
    }
    function onInputKeydown(ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        onOk();
      }
    }
    dlg.addEventListener("close", onClose, { once: true });
    okBtn?.addEventListener("click", onOk);
    cancelBtn?.addEventListener("click", onCancel);
    input?.addEventListener("keydown", onInputKeydown);
    dlg.showModal();
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  });
}

function ensureOpsTargetPattern() {
  const p = selectedPattern() || currentPattern;
  if (!p) return null;
  if (missionViolatesTemporaryDeviationLock(p)) {
    const pat = alertAndRevertMissionSelectorsForTemporaryLock(
      "Une déviation temporaire est en cours. Enregistrez-la (Temporaire) ou rétablissez l'état de début de mission avant de changer de mission.",
    );
    return currentPattern || pat || null;
  }
  if (!opsState.targetPatternId) {
    opsState.targetPatternId = p.pattern_id || "";
    return p;
  }
  if (opsState.targetPatternId !== (p.pattern_id || "")) {
    resetOpsStateForMission();
    opsState.targetPatternId = p.pattern_id || "";
    applyOpsStateUi();
  }
  return p;
}

