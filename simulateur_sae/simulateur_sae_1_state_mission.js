/* simulateur SAE — fichier 1/3 : état mission, lignes / variantes, ops et carte jusqu’à `ensureOpsTargetPattern`.
 * Ordre des `<script src>` dans `simulateur_sae.html` obligatoire : `simulateur_sae_0_personal_landmarks_catalog.js` (optionnel mais recommandé) puis 1 → 2 → 3. */

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
/** Sens simulation HUD carte : 1 = avant, -1 = arrière. */
let simDirection = 1;
/** Multiplicateurs au tap (×1, ×2, ×3, ×10) — avance et recul indépendants. */
let simSpeedForward = 1;
let simSpeedBackward = 1;
/** Changement de sens demandé : pause d’abord, 2ᵉ tap sur le bouton opposé pour repartir. */
let mapHudScrubPendingDirection = 0;
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
const LS_KEY_PERSONAL_LANDMARKS = "tam_personal_map_landmarks_v1";
const LS_KEY_PLM_ICON_RECENT = "tam_personal_landmark_icon_recent_v1";
const LS_KEY_PERSONAL_LANDMARK_FAVORITES_CAP = "tam_personal_landmark_favorites_cap_v1";
const LS_KEY_PLM_CAP_FILTER_BAND_M = "tam_personal_landmark_cap_band_m_v1";
const PLM_CAP_FILTER_BAND_DEFAULT_M = 100;
const PLM_CAP_FILTER_BAND_MIN_M = 10;
const PLM_CAP_FILTER_BAND_MAX_M = 300;
const PLM_DEFAULT_ICON_ID = "pin";
const PLM_DEFAULT_COLOR_NEW = "#005ca9";
const PLM_DEFAULT_COLOR_LEGACY = "#c62828";
/** Décalage lat/lng (degrés) pour placer une copie visible à côté du repère d’origine. */
const PLM_DUPLICATE_OFFSET_PX = 25;
const LS_KEY_PLM_GROUPS = "tam_personal_landmark_groups_v1";
const LS_KEY_PERSONAL_ZONES = "tam_personal_map_zones_v1";
const LS_KEY_PLM_LANDMARKS_LAYER_VISIBLE = "tam_plm_landmarks_layer_visible_v1";
const LS_KEY_PLM_ZONES_LAYER_VISIBLE = "tam_plm_zones_layer_visible_v1";
const LS_KEY_PLM_ZONE_VOICE_ANNOUNCE = "tam_plm_zone_voice_announce_v1";
const PLM_ZONE_MISSION_HUD_ZOOM_FROM_MAX = 1;
const PLM_ZONE_MISSION_BACKTRACK_RESET_M = 5;
const PLM_SLOT_SPACING_LAT = 0.00022;
const PLM_SLOT_SPACING_LNG = 0.00032;
const PLM_SLOT_MATCH_THRESHOLD = 8e-11;
const PLM_MAP_MAX_ZOOM = 19;
const PLM_MAGNETIC_ZOOM_FROM_MAX = 2;
const PLM_MAGNETIC_SPACING_PX = 30;
/** Seuil d’aimantation à la pose / au drag : moitié de la taille repère (30 px). */
const PLM_PLACEMENT_SNAP_THRESHOLD_PX = PLM_MAGNETIC_SPACING_PX / 2;
const PLM_MARKER_ICON_W = 30;
const PLM_MARKER_ICON_H = 30;
const PLM_MARKER_ICON_ANCHOR_X = 15;
const PLM_MARKER_ICON_ANCHOR_Y = 30;
const PLM_LABEL_GAP_BELOW_PX = 4;
/** Libellé zone : au-dessus du contour (écran), pas à l’intérieur. */
const PLM_ZONE_LABEL_GAP_ABOVE_PX = 6;
const PLM_ZONE_LABEL_MIN_WIDTH_PX = 56;
const PLM_ZONE_LABEL_MAX_WIDTH_PX = 420;
const PLM_ZONE_LABEL_BAR_PAD_X_PX = 16;
const PLM_ZONE_LABEL_BAR_BORDER_PX = 2;
const PLM_ZONE_LABEL_FONT = "700 12px Arial, sans-serif";
const PLM_ZONE_LABEL_HEIGHT_PX = 26;
let plmZoneLabelMeasureCtx = null;

function plmMeasureZoneLabelBarWidthPx(name) {
  const text = String(name ?? "").trim();
  if (!text) return PLM_ZONE_LABEL_MIN_WIDTH_PX;
  if (!plmZoneLabelMeasureCtx) {
    plmZoneLabelMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  plmZoneLabelMeasureCtx.font = PLM_ZONE_LABEL_FONT;
  const textW = plmZoneLabelMeasureCtx.measureText(text).width;
  const raw = Math.ceil(
    textW + PLM_ZONE_LABEL_BAR_PAD_X_PX + PLM_ZONE_LABEL_BAR_BORDER_PX,
  );
  return Math.min(PLM_ZONE_LABEL_MAX_WIDTH_PX, Math.max(1, raw));
}
const PLM_SLOT_DELTA = {
  n: [PLM_SLOT_SPACING_LAT, 0],
  ne: [PLM_SLOT_SPACING_LAT, PLM_SLOT_SPACING_LNG],
  e: [0, PLM_SLOT_SPACING_LNG],
  se: [-PLM_SLOT_SPACING_LAT, PLM_SLOT_SPACING_LNG],
  s: [-PLM_SLOT_SPACING_LAT, 0],
  sw: [-PLM_SLOT_SPACING_LAT, -PLM_SLOT_SPACING_LNG],
  w: [0, -PLM_SLOT_SPACING_LNG],
  nw: [PLM_SLOT_SPACING_LAT, -PLM_SLOT_SPACING_LNG],
};
const PLM_SLOT_LABEL = {
  n: "Nord",
  ne: "Nord-est",
  e: "Est",
  se: "Sud-est",
  s: "Sud",
  sw: "Sud-ouest",
  w: "Ouest",
  nw: "Nord-ouest",
};
const PLM_SLOT_GRID_ORDER = [
  "nw",
  "n",
  "ne",
  "w",
  "c",
  "e",
  "sw",
  "s",
  "se",
];
const PLM_SLOT_PIXEL_DIR = {
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
  nw: [-1, -1],
};
const PLM_GRID_OFFSET_TO_SLOT = {
  "-1,-1": "nw",
  "0,-1": "n",
  "1,-1": "ne",
  "-1,0": "w",
  "1,0": "e",
  "-1,1": "sw",
  "0,1": "s",
  "1,1": "se",
};

let plmGroupsById = {};
let plmMarkerById = new Map();
let plmGroupDragSnapshot = null;
let plmZoomLayoutRaf = 0;
let plmLabelsLayoutRaf = 0;
let plmRotationSession = null;
let plmRotationHandleMarker = null;
let plmRotationLayer = null;

function plmNewLandmarkId() {
  return `plm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function plmGenerateGroupId() {
  return `plmg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadPlmGroupsFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY_PLM_GROUPS);
    plmGroupsById = raw ? JSON.parse(raw) : {};
    if (!plmGroupsById || typeof plmGroupsById !== "object") {
      plmGroupsById = {};
    }
  } catch (e) {
    plmGroupsById = {};
  }
}

function savePlmGroupsToStorage() {
  try {
    localStorage.setItem(LS_KEY_PLM_GROUPS, JSON.stringify(plmGroupsById));
  } catch (e) {
    // ignore
  }
  if (typeof plmScheduleAutoBackup === "function") plmScheduleAutoBackup();
}

function plmGetGroupDescription(groupId) {
  if (!groupId) return "";
  return String(plmGroupsById[groupId]?.description ?? "").trim();
}

function plmSetGroupDescription(groupId, text) {
  if (!groupId) return;
  const t = String(text ?? "").trim();
  if (!t) {
    if (plmGroupsById[groupId]) {
      const next = { ...plmGroupsById[groupId] };
      delete next.description;
      if (Object.keys(next).length === 0) delete plmGroupsById[groupId];
      else plmGroupsById[groupId] = next;
    }
  } else {
    plmGroupsById[groupId] = {
      ...(plmGroupsById[groupId] || {}),
      description: t,
    };
  }
  savePlmGroupsToStorage();
}

function plmRemoveGroupIfEmpty(groupId) {
  if (!groupId) return;
  if (plmMembersOfGroup(groupId).length === 0) {
    delete plmGroupsById[groupId];
    savePlmGroupsToStorage();
  }
}

function plmMembersOfGroup(groupId) {
  if (!groupId) return [];
  return personalLandmarksList.filter((x) => x.groupId === groupId);
}

function plmSyncGroupMemberNames(groupId, name) {
  const n = String(name ?? "").trim();
  if (!groupId || !n) return;
  for (let i = 0; i < personalLandmarksList.length; i++) {
    if (personalLandmarksList[i].groupId === groupId) {
      personalLandmarksList[i] = {
        ...personalLandmarksList[i],
        name: n,
        description: "",
      };
    }
  }
}

function plmLandmarkDescriptionText(item) {
  if (!item) return "";
  if (item.groupId) {
    return plmGetGroupDescription(item.groupId);
  }
  return String(item.description ?? "").trim();
}

function plmLandmarkHideName(item) {
  return !!item?.hideName;
}

function plmLandmarkDisplayName(item) {
  if (!item || plmLandmarkHideName(item)) return "";
  return String(item.name ?? "").trim();
}

function plmLandmarkHasMapLabelContent(item) {
  if (!item) return false;
  const ref = plmLandmarkLabelAttachItem(item) || item;
  if (!!plmLandmarkDescriptionText(ref)) return true;
  if (plmLandmarkHideName(ref)) return false;
  return !!String(ref.name ?? "").trim();
}

/** Vide titre (champ name), description structurée et coches — conserve icône et position. */
function plmApplyClearLandmarkContent(landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item) return false;
  if (item.groupId) {
    const gid = item.groupId;
    plmSetGroupDescription(gid, "");
    for (let i = 0; i < personalLandmarksList.length; i++) {
      if (personalLandmarksList[i].groupId !== gid) continue;
      const next = { ...personalLandmarksList[i] };
      next.name = "";
      next.description = "";
      delete next.hideName;
      personalLandmarksList[i] = next;
    }
  } else {
    const idx = personalLandmarksList.findIndex((x) => x.id === landmarkId);
    if (idx < 0) return false;
    const next = { ...personalLandmarksList[idx] };
    next.name = "";
    next.description = "";
    delete next.hideName;
    personalLandmarksList[idx] = next;
  }
  savePersonalLandmarksToStorage();
  savePlmGroupsToStorage();
  if (typeof plmScheduleAutoBackup === "function") plmScheduleAutoBackup();
  redrawPersonalLandmarksLayer();
  return true;
}

async function plmClearLandmarkContentFromContext(landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item) return;
  const label = item.groupId
    ? "Vider ce groupe"
    : "Vider ce repère";
  const ok = await showAppConfirmDialog(
    TAM_APP_DIALOG_TITLE,
    `${label} ?\n\nTitre, CMR, vitesses, lignes INDES et INDIR seront effacés (rien de coché). L’icône et la position sur la carte restent inchangées.`,
  );
  if (!ok) return;
  if (!plmApplyClearLandmarkContent(landmarkId)) return;
  setGpsStatus(
    item.groupId
      ? "Groupe vidé : plus de titre ni de description structurée."
      : "Repère vidé : plus de titre ni de description structurée.",
  );
}

function plmEscapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plmMarkerScreenBoundsFromLatLng(lat, lng, anchorX, anchorY) {
  if (!map) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  const ax =
    typeof anchorX === "number" ? anchorX : PLM_MARKER_ICON_ANCHOR_X;
  const ay =
    typeof anchorY === "number" ? anchorY : PLM_MARKER_ICON_ANCHOR_Y;
  const p = map.latLngToContainerPoint(L.latLng(lat, lng));
  return {
    left: p.x - ax,
    top: p.y - ay,
    right: p.x - ax + PLM_MARKER_ICON_W,
    bottom: p.y - ay + PLM_MARKER_ICON_H,
  };
}

/** Bounds écran d’un repère affiché (ancre centre en groupe, pied sinon). */
function plmMarkerScreenBoundsForLandmark(item) {
  if (!item || !map) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  const marker = plmMarkerById?.get(item.id);
  const ll = marker ? marker.getLatLng() : null;
  const lat = ll ? ll.lat : plmDisplayLatLngForLandmark(item).lat;
  const lng = ll ? ll.lng : plmDisplayLatLngForLandmark(item).lng;
  const inGroup = !!String(item.groupId ?? "").trim();
  const ay = inGroup ? PLM_MARKER_ICON_H / 2 : PLM_MARKER_ICON_ANCHOR_Y;
  return plmMarkerScreenBoundsFromLatLng(
    lat,
    lng,
    PLM_MARKER_ICON_ANCHOR_X,
    ay,
  );
}

/**
 * Même point carte que le repère ; iconAnchor place le haut-gauche du libellé
 * sous le bas-gauche de l’icône (30×30). Rotation identique → suit le repère seul.
 */
function plmLabelIconAnchorForItem(item) {
  const inGroup = !!String(item?.groupId ?? "").trim();
  const ay = inGroup ? PLM_MARKER_ICON_H / 2 : PLM_MARKER_ICON_ANCHOR_Y;
  const belowPx = PLM_MARKER_ICON_H - ay + PLM_LABEL_GAP_BELOW_PX;
  return [PLM_MARKER_ICON_ANCHOR_X, -belowPx];
}

function plmLandmarkLabelAttachItem(item) {
  if (!item) return null;
  if (item.groupId) {
    return plmLandmarkForGroupLabel(item.groupId) || item;
  }
  return item;
}

function plmLandmarkForGroupLabel(groupId) {
  const members = plmMembersOfGroup(groupId);
  const named = members.find((m) => String(m.name ?? "").trim());
  return named || members[0] || null;
}

function plmBuildMapLabelHtml(item) {
  const title = plmLandmarkDisplayName(item);
  let desc = plmLandmarkDescriptionText(item);
  if (
    title &&
    typeof window.plmStripTitleFromDescriptionRaw === "function"
  ) {
    desc = window.plmStripTitleFromDescriptionRaw(desc, title);
  }
  let inner = "";
  if (title && typeof window.plmTitlePillHtmlString === "function") {
    inner += `<div class="tam-plm-map-label__title-row">${window.plmTitlePillHtmlString(title, item?.titleColorHex)}</div>`;
  }
  if (desc) {
    const descHtml =
      typeof window.plmBuildDescriptionDisplayHtml === "function"
        ? window.plmBuildDescriptionDisplayHtml(desc)
        : plmEscapeHtml(desc).replace(/\n/g, "<br>");
    if (descHtml) {
      inner += `<div class="tam-plm-map-label__desc">${descHtml}</div>`;
    }
  }
  if (!inner) return "";
  return `<div class="tam-plm-map-label__card">${inner}</div>`;
}

function plmCreateMapLabelIcon(html, item) {
  const anchor = item
    ? plmLabelIconAnchorForItem(item)
    : [PLM_MARKER_ICON_ANCHOR_X, -PLM_LABEL_GAP_BELOW_PX];
  return L.divIcon({
    className: "tam-plm-map-label",
    html,
    iconAnchor: anchor,
  });
}

function plmMapUsesMagneticLayout() {
  if (!map || typeof map.getZoom !== "function") return false;
  const z = Math.floor(map.getZoom() + 1e-6);
  return z >= PLM_MAP_MAX_ZOOM - PLM_MAGNETIC_ZOOM_FROM_MAX;
}


function plmLatLngFromSlot(pivotLat, pivotLng, slot) {
  const dir = PLM_SLOT_PIXEL_DIR[slot];
  if (!dir || !map) return null;
  const p0 = map.latLngToContainerPoint(L.latLng(pivotLat, pivotLng));
  const p1 = L.point(
    p0.x + dir[0] * PLM_MAGNETIC_SPACING_PX,
    p0.y + dir[1] * PLM_MAGNETIC_SPACING_PX,
  );
  const ll = map.containerPointToLatLng(p1);
  return [ll.lat, ll.lng];
}

function plmLatLngFromSlotDegrees(pivotLat, pivotLng, slot) {
  const pair = PLM_SLOT_DELTA[slot];
  if (!pair) return null;
  return [pivotLat + pair[0], pivotLng + pair[1]];
}

/** Groupe : décalage écran (grille 30 px) seulement en zoom magnétique, pas en mode Cap. */
function plmGroupUsesScreenPivotLayout() {
  if (plmMapHeadingUpActive()) return false;
  return plmMapUsesMagneticLayout();
}

function plmGridOffsetFromPivotLatLng(pivotLat, pivotLng, memLat, memLng) {
  if (
    !map ||
    !plmIsValidPlmLatLng(pivotLat, pivotLng) ||
    !plmIsValidPlmLatLng(memLat, memLng)
  ) {
    return { qx: 0, qy: 0 };
  }
  const p0 = map.latLngToContainerPoint(L.latLng(pivotLat, pivotLng));
  const p1 = map.latLngToContainerPoint(L.latLng(memLat, memLng));
  const spacing = PLM_MAGNETIC_SPACING_PX;
  return {
    qx: Math.round((p1.x - p0.x) / spacing),
    qy: Math.round((p1.y - p0.y) / spacing),
  };
}

/** Décalage grille absolu (depuis le pivot du groupe), pas « une case depuis le parent ». */
function plmGridOffsetForMember(item, pivot) {
  if (!item || !pivot || item.id === pivot.id) return { qx: 0, qy: 0 };
  const gqx = Number(item.gridQx);
  const gqy = Number(item.gridQy);
  if (Number.isFinite(gqx) && Number.isFinite(gqy)) {
    return { qx: gqx, qy: gqy };
  }
  return plmGridOffsetFromPivotLatLng(
    pivot.lat,
    pivot.lng,
    item.lat,
    item.lng,
  );
}

function plmRefreshGroupGridOffsets(groupId, force) {
  const pivot = plmGroupPivotMember(groupId);
  if (!pivot || !map || !plmIsValidPlmLatLng(pivot.lat, pivot.lng)) {
    return false;
  }
  const p0 = map.latLngToContainerPoint(L.latLng(pivot.lat, pivot.lng));
  const spacing = PLM_MAGNETIC_SPACING_PX;
  let changed = false;
  for (const mem of plmMembersOfGroup(groupId)) {
    const idx = personalLandmarksList.findIndex((x) => x.id === mem.id);
    if (idx < 0) continue;
    const cur = personalLandmarksList[idx];
    if (
      !force &&
      mem.id !== pivot.id &&
      Number.isFinite(Number(cur.gridQx)) &&
      Number.isFinite(Number(cur.gridQy))
    ) {
      continue;
    }
    let qx = 0;
    let qy = 0;
    if (mem.id !== pivot.id && plmIsValidPlmLatLng(mem.lat, mem.lng)) {
      const p1 = map.latLngToContainerPoint(L.latLng(mem.lat, mem.lng));
      qx = Math.round((p1.x - p0.x) / spacing);
      qy = Math.round((p1.y - p0.y) / spacing);
    }
    if (cur.gridQx !== qx || cur.gridQy !== qy) {
      personalLandmarksList[idx] = { ...cur, gridQx: qx, gridQy: qy };
      changed = true;
    }
  }
  return changed;
}

/**
 * Aux zooms magnétiques (z max, max−1, max−2) : recalcule lat/lng depuis la grille
 * fixe (gridQx/gridQy), pour garder 30 px à l’écran en mode Cap (rotation carte intacte).
 */
function plmBakeGroupLatLngFromGrid(groupId) {
  if (!plmMapUsesMagneticLayout() || !map) return false;
  const pivot = plmGroupPivotMember(groupId);
  if (!pivot || !plmIsValidPlmLatLng(pivot.lat, pivot.lng)) return false;
  plmRefreshGroupGridOffsets(groupId, false);
  let changed = false;
  for (const mem of plmMembersOfGroup(groupId)) {
    const idx = personalLandmarksList.findIndex((x) => x.id === mem.id);
    if (idx < 0) continue;
    const off = plmGridOffsetForMember(mem, pivot);
    let lat = pivot.lat;
    let lng = pivot.lng;
    if (mem.id !== pivot.id) {
      const pos = plmLatLngFromGridOffsetStored(
        pivot.lat,
        pivot.lng,
        off.qx,
        off.qy,
      );
      if (!pos || !plmIsValidPlmLatLng(pos[0], pos[1])) continue;
      lat = pos[0];
      lng = pos[1];
    }
    const cur = personalLandmarksList[idx];
    if (cur.lat !== lat || cur.lng !== lng) {
      personalLandmarksList[idx] = { ...cur, lat, lng };
      changed = true;
    }
  }
  return changed;
}

function plmBakeAllGroupsLatLngFromGrid() {
  if (!plmMapUsesMagneticLayout()) return false;
  const seen = new Set();
  let changed = false;
  for (const item of personalLandmarksList) {
    if (!item.groupId || seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    if (plmBakeGroupLatLngFromGrid(item.groupId)) changed = true;
  }
  return changed;
}

/**
 * Position affichée : repère isolé ou mode Cap = lat/lng stockés (comme une zone) ;
 * groupe en zoom magnétique sans Cap = pivot + décalage écran (cases 30 px).
 */
function plmDisplayLatLngForLandmark(item, visiting) {
  if (!item || !plmIsValidPlmLatLng(item.lat, item.lng)) {
    return { lat: item?.lat, lng: item?.lng };
  }
  const parentId = String(item.parentId ?? "").trim();
  const slot = String(item.slot ?? "").trim();
  if (parentId && slot) {
    const seen = visiting || new Set();
    if (seen.has(item.id)) {
      return { lat: item.lat, lng: item.lng };
    }
    seen.add(item.id);
    const parent = personalLandmarksList.find((x) => x.id === parentId);
    if (parent) {
      const pp = plmDisplayLatLngForLandmark(parent, seen);
      const pos = plmLatLngFromSlot(pp.lat, pp.lng, slot);
      if (pos && plmIsValidPlmLatLng(pos[0], pos[1])) {
        return { lat: pos[0], lng: pos[1] };
      }
    }
  }
  if (plmMapHeadingUpActive()) {
    return { lat: item.lat, lng: item.lng };
  }
  const groupId = String(item.groupId ?? "").trim();
  if (plmGroupUsesScreenPivotLayout() && groupId) {
    const pivot = plmGroupPivotMember(groupId);
    if (pivot && plmIsValidPlmLatLng(pivot.lat, pivot.lng)) {
      if (item.id === pivot.id) {
        return { lat: pivot.lat, lng: pivot.lng };
      }
      const off = plmGridOffsetForMember(item, pivot);
      const pos = plmLatLngFromGridOffset(pivot.lat, pivot.lng, off.qx, off.qy);
      if (pos && plmIsValidPlmLatLng(pos[0], pos[1])) {
        return { lat: pos[0], lng: pos[1] };
      }
    }
  }
  return { lat: item.lat, lng: item.lng };
}

function plmApplyMagneticLayoutForGroup(groupId, force) {
  if (!plmMapUsesMagneticLayout()) return false;
  return plmRefreshGroupGridOffsets(groupId, !!force);
}

function plmApplyMagneticLayoutForAllGroups(force) {
  if (!plmMapUsesMagneticLayout()) return false;
  const seen = new Set();
  let changed = false;
  for (const item of personalLandmarksList) {
    if (!item.groupId || seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    if (plmApplyMagneticLayoutForGroup(item.groupId, force)) changed = true;
  }
  return changed;
}

/** Case voisine immédiate (grille ~30 px) par rapport au centre affiché. */
function plmNeighborSlotFromPixelDelta(dx, dy) {
  const spacing = PLM_MAGNETIC_SPACING_PX;
  const dist = Math.hypot(dx, dy);
  if (dist < spacing * 0.35) return null;
  const qx = Math.round(dx / spacing);
  const qy = Math.round(dy / spacing);
  if (qx === 0 && qy === 0) return null;
  if (Math.abs(qx) > 1 || Math.abs(qy) > 1) return null;
  const slot = PLM_GRID_OFFSET_TO_SLOT[`${qx},${qy}`];
  if (!slot) return null;
  const err = Math.hypot(dx - qx * spacing, dy - qy * spacing);
  if (err > spacing * 0.42) return null;
  return slot;
}

function plmFindSlotKeyForDelta(dLat, dLng) {
  let best = null;
  let bestDist = Infinity;
  for (const [key, pair] of Object.entries(PLM_SLOT_DELTA)) {
    const dist = (dLat - pair[0]) ** 2 + (dLng - pair[1]) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = key;
    }
  }
  if (bestDist > PLM_SLOT_MATCH_THRESHOLD) return null;
  return best;
}

/** Cases occupées autour du repère ouvert (positions réelles sur la carte, pas seulement parentId). */
function plmOccupiedSlotsAroundCenter(centerLat, centerLng, excludeId, groupId) {
  const occupied = new Set();
  const candidates = groupId
    ? plmMembersOfGroup(groupId)
    : personalLandmarksList;
  const p0 =
    map && plmIsValidPlmLatLng(centerLat, centerLng)
      ? map.latLngToContainerPoint(L.latLng(centerLat, centerLng))
      : null;
  for (const m of candidates) {
    if (excludeId && m.id === excludeId) continue;
    const pos = plmDisplayLatLngForLandmark(m);
    if (!plmIsValidPlmLatLng(pos.lat, pos.lng)) continue;
    let slot = null;
    if (p0) {
      const p1 = map.latLngToContainerPoint(L.latLng(pos.lat, pos.lng));
      slot = plmNeighborSlotFromPixelDelta(p1.x - p0.x, p1.y - p0.y);
    }
    if (!slot) {
      slot = plmFindSlotKeyForDelta(
        pos.lat - centerLat,
        pos.lng - centerLng,
      );
    }
    if (slot) occupied.add(slot);
  }
  return occupied;
}

function plmRenderSlotGrid(container, centerLat, centerLng, groupId, landmarkId) {
  if (!container) return;
  container.innerHTML = "";
  const slotActive = {};
  const occupied = plmOccupiedSlotsAroundCenter(
    centerLat,
    centerLng,
    landmarkId,
    groupId,
  );
  for (const key of PLM_SLOT_GRID_ORDER) {
    const cell = document.createElement("div");
    cell.className = "tam-plm-slot-cell";
    if (key === "c") {
      cell.classList.add("tam-plm-slot-cell--center");
      cell.textContent = "Repère actuel";
      container.appendChild(cell);
      continue;
    }
    const isOccupied = occupied.has(key);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tam-plm-slot-btn";
    btn.dataset.plmSlot = key;
    btn.textContent = isOccupied ? "—" : "+";
    btn.title = PLM_SLOT_LABEL[key] || key;
    btn.setAttribute("aria-label", PLM_SLOT_LABEL[key] || key);
    btn.disabled = isOccupied;
    btn.addEventListener("click", () => {
      if (isOccupied) return;
      slotActive[key] = !slotActive[key];
      btn.classList.toggle("is-active", !!slotActive[key]);
    });
    cell.appendChild(btn);
    container.appendChild(cell);
  }
  container._plmSlotActive = slotActive;
  container._plmGetSlots = () =>
    Object.keys(slotActive).filter((k) => slotActive[k]);
}

function plmLandmarkScreenPoint(item) {
  const disp = plmDisplayLatLngForLandmark(item);
  if (!map || !plmIsValidPlmLatLng(disp.lat, disp.lng)) return null;
  return map.latLngToContainerPoint(L.latLng(disp.lat, disp.lng));
}

function plmIsScreenPointOccupiedByLandmark(p, excludeIds) {
  const tol = PLM_PLACEMENT_SNAP_THRESHOLD_PX;
  for (const item of personalLandmarksList) {
    if (excludeIds?.has(item.id)) continue;
    const p0 = plmLandmarkScreenPoint(item);
    if (!p0) continue;
    if (Math.hypot(p.x - p0.x, p.y - p0.y) <= tol) return true;
  }
  return false;
}

function plmIsSoloLandmarkItem(item) {
  return !!item && !String(item.groupId ?? "").trim();
}

function plmSnapDirectionFromPixelDelta(dx, dy) {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < PLM_MAGNETIC_SPACING_PX * 0.2 && ady < PLM_MAGNETIC_SPACING_PX * 0.2) {
    return { qx: 0, qy: 0 };
  }
  if (adx >= ady * 0.55 && ady >= adx * 0.55) {
    return { qx: dx > 0 ? 1 : -1, qy: dy > 0 ? 1 : -1 };
  }
  if (adx >= ady) {
    return { qx: dx > 0 ? 1 : -1, qy: 0 };
  }
  return { qx: 0, qy: dy > 0 ? 1 : -1 };
}

function plmLandmarkIconBearingForAlign(item) {
  if (!item) return 0;
  if (plmLandmarkHasIconBearing(item)) {
    return plmNormalizeBearingDeg(Number(item.iconBearingDeg));
  }
  return plmCaptureLandmarkIconBearingDeg();
}

/** À l’aimantation : reprendre la rotation du repère voisin (icône « droite » sur l’écran). */
function plmApplySnapAlignBearingToAnchor(row, anchorLandmarkId) {
  if (!row || !anchorLandmarkId) return row;
  const anchor = personalLandmarksList.find((x) => x.id === anchorLandmarkId);
  if (!anchor) return row;
  return {
    ...row,
    iconBearingDeg: plmLandmarkIconBearingForAlign(anchor),
  };
}

/**
 * Repères individuels : si la pose est proche d’une case voisine (grille 30 px),
 * aimanter bord à bord sans créer de groupe (8 directions, chaînage illimité).
 */
function plmSnapLandmarkLatLngNearNeighbors(lat, lng, excludeId) {
  if (!map || !plmIsValidPlmLatLng(lat, lng)) {
    return { lat, lng, snapped: false, anchorLandmarkId: null };
  }
  const spacing = PLM_MAGNETIC_SPACING_PX;
  const pClick = map.latLngToContainerPoint(L.latLng(lat, lng));
  const excludeIds = new Set();
  if (excludeId) excludeIds.add(excludeId);
  const dirs = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];

  const trySnapPoint = (pSnap) => {
    const dist = Math.hypot(pClick.x - pSnap.x, pClick.y - pSnap.y);
    if (dist > PLM_PLACEMENT_SNAP_THRESHOLD_PX) return null;
    if (plmIsScreenPointOccupiedByLandmark(pSnap, excludeIds)) return null;
    return { dist, ll: map.containerPointToLatLng(pSnap) };
  };

  let nearest = null;
  let nearestDist = spacing * 1.75 + 1;
  for (const item of personalLandmarksList) {
    if (excludeId && item.id === excludeId) continue;
    const p0 = plmLandmarkScreenPoint(item);
    if (!p0) continue;
    const d = Math.hypot(pClick.x - p0.x, pClick.y - p0.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = { item, p0 };
    }
  }
  if (nearest) {
    const { qx, qy } = plmSnapDirectionFromPixelDelta(
      pClick.x - nearest.p0.x,
      pClick.y - nearest.p0.y,
    );
    if (qx !== 0 || qy !== 0) {
      const hit = trySnapPoint(
        L.point(
          nearest.p0.x + qx * spacing,
          nearest.p0.y + qy * spacing,
        ),
      );
      if (hit) {
        return {
          lat: hit.ll.lat,
          lng: hit.ll.lng,
          snapped: true,
          anchorLandmarkId: nearest.item.id,
        };
      }
    }
  }

  let best = null;
  let bestDist = PLM_PLACEMENT_SNAP_THRESHOLD_PX + 1;
  let bestAnchorId = null;
  for (const item of personalLandmarksList) {
    if (excludeId && item.id === excludeId) continue;
    const p0 = plmLandmarkScreenPoint(item);
    if (!p0) continue;
    for (const [qx, qy] of dirs) {
      const hit = trySnapPoint(
        L.point(p0.x + qx * spacing, p0.y + qy * spacing),
      );
      if (!hit || hit.dist >= bestDist) continue;
      bestDist = hit.dist;
      best = hit.ll;
      bestAnchorId = item.id;
    }
  }
  if (best) {
    return {
      lat: best.lat,
      lng: best.lng,
      snapped: true,
      anchorLandmarkId: bestAnchorId,
    };
  }
  return { lat, lng, snapped: false, anchorLandmarkId: null };
}

function plmFindNearestFreeGridCell(qx, qy, usedCells, pivotP, preferredP) {
  const spacing = PLM_MAGNETIC_SPACING_PX;
  const key0 = `${qx},${qy}`;
  if (!usedCells.has(key0)) return { qx, qy };
  const candidates = [];
  for (let r = 1; r < 16; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = qx + dx;
        const ny = qy + dy;
        const key = `${nx},${ny}`;
        if (usedCells.has(key)) continue;
        const pSnap = L.point(
          pivotP.x + nx * spacing,
          pivotP.y + ny * spacing,
        );
        const dist = preferredP
          ? Math.hypot(pSnap.x - preferredP.x, pSnap.y - preferredP.y)
          : Math.hypot(nx - qx, ny - qy);
        candidates.push({ qx: nx, qy: ny, dist });
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.dist - b.dist);
      return { qx: candidates[0].qx, qy: candidates[0].qy };
    }
  }
  return { qx, qy };
}

/**
 * Aux zooms magnétiques : recale les repères solo proches sur la grille 30 px
 * (sans groupe), pour conserver l’aimantation après zoom arrière / avant.
 */
function plmBakeSoloLandmarksMagneticClusters() {
  if (
    !plmMapUsesMagneticLayout() ||
    !map ||
    plmMapHeadingUpActive() ||
    plmIsLiveMissionForLandmarkDisplay()
  ) {
    return false;
  }
  const spacing = PLM_MAGNETIC_SPACING_PX;
  const joinMax = spacing + PLM_PLACEMENT_SNAP_THRESHOLD_PX;
  const entries = [];
  for (const item of personalLandmarksList) {
    if (!plmIsSoloLandmarkItem(item) || !plmIsValidPlmLatLng(item.lat, item.lng)) {
      continue;
    }
    const p = plmLandmarkScreenPoint(item);
    if (!p) continue;
    entries.push({ id: item.id, p, item });
  }
  if (entries.length === 0) return false;

  const parent = new Map();
  function find(id) {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const d = Math.hypot(
        entries[i].p.x - entries[j].p.x,
        entries[i].p.y - entries[j].p.y,
      );
      if (d <= joinMax) unite(entries[i].id, entries[j].id);
    }
  }

  const clusters = new Map();
  for (const ent of entries) {
    const root = find(ent.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(ent);
  }

  let changed = false;
  for (const cluster of clusters.values()) {
    if (cluster.length === 0) continue;
    cluster.sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y || a.id.localeCompare(b.id));
    const pivotEnt = cluster[0];
    const pivotIdx = personalLandmarksList.findIndex((x) => x.id === pivotEnt.id);
    if (pivotIdx < 0) continue;
    const pivotRow = personalLandmarksList[pivotIdx];
    const pivotLat = pivotRow.lat;
    const pivotLng = pivotRow.lng;
    const pivotP = pivotEnt.p;
    const usedCells = new Set(["0,0"]);

    const pivotCur = personalLandmarksList[pivotIdx];
    const pivotNext = { ...pivotCur, lat: pivotLat, lng: pivotLng };
    delete pivotNext.parentId;
    delete pivotNext.slot;
    delete pivotNext.gridQx;
    delete pivotNext.gridQy;
    if (
      pivotCur.lat !== pivotNext.lat ||
      pivotCur.lng !== pivotNext.lng ||
      pivotCur.parentId ||
      pivotCur.slot ||
      pivotCur.gridQx != null ||
      pivotCur.gridQy != null
    ) {
      personalLandmarksList[pivotIdx] = pivotNext;
      changed = true;
    }

    for (const ent of cluster) {
      if (ent.id === pivotEnt.id) continue;
      const idx = personalLandmarksList.findIndex((x) => x.id === ent.id);
      if (idx < 0) continue;
      let qx = Math.round((ent.p.x - pivotP.x) / spacing);
      let qy = Math.round((ent.p.y - pivotP.y) / spacing);
      const cellKey = `${qx},${qy}`;
      if (usedCells.has(cellKey)) {
        const free = plmFindNearestFreeGridCell(
          qx,
          qy,
          usedCells,
          pivotP,
          ent.p,
        );
        qx = free.qx;
        qy = free.qy;
      }
      usedCells.add(`${qx},${qy}`);
      const pos = plmLatLngFromGridOffset(pivotLat, pivotLng, qx, qy);
      if (!pos || !plmIsValidPlmLatLng(pos[0], pos[1])) continue;
      const cur = personalLandmarksList[idx];
      const next = { ...cur, lat: pos[0], lng: pos[1] };
      delete next.parentId;
      delete next.slot;
      delete next.gridQx;
      delete next.gridQy;
      if (
        cur.lat !== next.lat ||
        cur.lng !== next.lng ||
        cur.parentId ||
        cur.slot ||
        cur.gridQx != null ||
        cur.gridQy != null
      ) {
        personalLandmarksList[idx] = next;
        changed = true;
      }
    }
  }
  return changed;
}

/** Affichage à l’écran (30 px) — dépend du zoom courant. */
function plmLatLngFromGridOffset(pivotLat, pivotLng, qx, qy) {
  if (!plmIsValidPlmLatLng(pivotLat, pivotLng)) return null;
  if (plmMapUsesMagneticLayout() && map) {
    const p0 = map.latLngToContainerPoint(L.latLng(pivotLat, pivotLng));
    const p1 = L.point(
      p0.x + qx * PLM_MAGNETIC_SPACING_PX,
      p0.y + qy * PLM_MAGNETIC_SPACING_PX,
    );
    const ll = map.containerPointToLatLng(p1);
    return [ll.lat, ll.lng];
  }
  return plmLatLngFromGridOffsetStored(pivotLat, pivotLng, qx, qy);
}

/** Persistance lat/lng — indépendante du zoom (évite la dérive au zoom arrière / avant). */
function plmLatLngFromGridOffsetStored(pivotLat, pivotLng, qx, qy) {
  if (!plmIsValidPlmLatLng(pivotLat, pivotLng)) return null;
  return [
    pivotLat - qy * PLM_SLOT_SPACING_LAT,
    pivotLng + qx * PLM_SLOT_SPACING_LNG,
  ];
}

function plmGroupPivotMember(groupId) {
  const members = plmMembersOfGroup(groupId);
  const root = members.find((m) => !String(m.parentId ?? "").trim());
  return root || members[0] || null;
}

function plmBuildGroupGridLayout(groupId, padding) {
  const pad = Number.isFinite(padding) ? padding : 1;
  const pivotMem = plmGroupPivotMember(groupId);
  if (!pivotMem) return null;
  const pivotDisp = plmDisplayLatLngForLandmark(pivotMem);
  if (!plmIsValidPlmLatLng(pivotDisp.lat, pivotDisp.lng)) return null;
  const spacing = PLM_MAGNETIC_SPACING_PX;
  const p0 =
    map && plmMapUsesMagneticLayout()
      ? map.latLngToContainerPoint(L.latLng(pivotDisp.lat, pivotDisp.lng))
      : null;
  const cells = new Map();
  for (const mem of plmMembersOfGroup(groupId)) {
    const d = plmDisplayLatLngForLandmark(mem);
    if (!plmIsValidPlmLatLng(d.lat, d.lng)) continue;
    let qx;
    let qy;
    if (p0) {
      const p1 = map.latLngToContainerPoint(L.latLng(d.lat, d.lng));
      qx = Math.round((p1.x - p0.x) / spacing);
      qy = Math.round((p1.y - p0.y) / spacing);
    } else {
      qx = Math.round((d.lng - pivotDisp.lng) / PLM_SLOT_SPACING_LNG);
      qy = Math.round(-(d.lat - pivotDisp.lat) / PLM_SLOT_SPACING_LAT);
    }
    cells.set(`${qx},${qy}`, {
      landmarkId: mem.id,
      isPivot: mem.id === pivotMem.id,
    });
  }
  if (!cells.size) return null;
  let minQx = 0;
  let maxQx = 0;
  let minQy = 0;
  let maxQy = 0;
  let first = true;
  for (const key of cells.keys()) {
    const [qx, qy] = key.split(",").map(Number);
    if (first) {
      minQx = maxQx = qx;
      minQy = maxQy = qy;
      first = false;
    } else {
      minQx = Math.min(minQx, qx);
      maxQx = Math.max(maxQx, qx);
      minQy = Math.min(minQy, qy);
      maxQy = Math.max(maxQy, qy);
    }
  }
  minQx -= pad;
  maxQx += pad;
  minQy -= pad;
  maxQy += pad;
  return {
    groupId,
    pivotId: pivotMem.id,
    pivotLat: pivotDisp.lat,
    pivotLng: pivotDisp.lng,
    cells,
    minQx,
    maxQx,
    minQy,
    maxQy,
  };
}

function plmResolveParentSlotForGridCell(layout, qx, qy) {
  if (!layout) return null;
  const key = `${qx},${qy}`;
  if (layout.cells.has(key)) return null;
  const deltas = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ];
  for (const [dx, dy] of deltas) {
    const nKey = `${qx + dx},${qy + dy}`;
    const occ = layout.cells.get(nKey);
    if (!occ?.landmarkId) continue;
    const slot = PLM_GRID_OFFSET_TO_SLOT[`${-dx},${-dy}`];
    if (!slot) continue;
    const taken = personalLandmarksList.some(
      (m) => m.parentId === occ.landmarkId && m.slot === slot,
    );
    if (!taken) {
      return { parentId: occ.landmarkId, slot };
    }
  }
  return null;
}

function plmFindNearestGroupId(landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item || item.groupId) return null;
  const pos = plmDisplayLatLngForLandmark(item);
  if (!plmIsValidPlmLatLng(pos.lat, pos.lng)) return null;
  const groupIds = new Set();
  for (const m of personalLandmarksList) {
    if (m.groupId) groupIds.add(m.groupId);
  }
  let best = null;
  let bestDist = Infinity;
  for (const gid of groupIds) {
    const members = plmMembersOfGroup(gid);
    if (!members.length) continue;
    let clat = 0;
    let clng = 0;
    for (const mem of members) {
      const d = plmDisplayLatLngForLandmark(mem);
      clat += d.lat;
      clng += d.lng;
    }
    clat /= members.length;
    clng /= members.length;
    const dist = (pos.lat - clat) ** 2 + (pos.lng - clng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = gid;
    }
  }
  return best;
}

function plmRenderMergeGroupGrid(container, layout) {
  if (!container || !layout) return;
  container.innerHTML = "";
  const cols = layout.maxQx - layout.minQx + 1;
  container.style.gridTemplateColumns = `repeat(${cols}, 32px)`;
  let selectedQx = null;
  let selectedQy = null;
  const updateOk = () => {
    const okBtn = document.getElementById("appPlmMergeGroupDialogOk");
    if (okBtn) okBtn.disabled = selectedQx == null;
  };
  const selectCell = (qx, qy, btn) => {
    container.querySelectorAll(".tam-plm-slot-btn.is-selected").forEach((el) => {
      el.classList.remove("is-selected");
    });
    selectedQx = qx;
    selectedQy = qy;
    btn.classList.add("is-selected");
    updateOk();
  };
  for (let qy = layout.minQy; qy <= layout.maxQy; qy++) {
    for (let qx = layout.minQx; qx <= layout.maxQx; qx++) {
      const cell = document.createElement("div");
      cell.className = "tam-plm-slot-cell";
      const key = `${qx},${qy}`;
      const occ = layout.cells.get(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tam-plm-slot-btn";
      if (occ?.landmarkId) {
        cell.classList.add("tam-plm-slot-cell--occupied");
        btn.disabled = true;
        btn.textContent = "●";
        const mem = personalLandmarksList.find((x) => x.id === occ.landmarkId);
        btn.title = mem?.name || "Repère du groupe";
        btn.setAttribute("aria-label", mem?.name || "Repère du groupe");
      } else {
        const link = plmResolveParentSlotForGridCell(layout, qx, qy);
        if (link) {
          btn.textContent = "+";
          btn.title = "Placer le repère ici";
          btn.setAttribute("aria-label", "Placer le repère ici");
          btn.addEventListener("click", () => selectCell(qx, qy, btn));
        } else {
          btn.disabled = true;
          btn.classList.add("tam-plm-slot-btn--blocked");
          btn.textContent = "·";
          btn.title = "Emplacement indisponible";
          btn.setAttribute("aria-label", "Emplacement indisponible");
        }
      }
      cell.appendChild(btn);
      container.appendChild(cell);
    }
  }
  container._plmGetMergeSelection = () => {
    if (selectedQx == null || selectedQy == null) return null;
    const link = plmResolveParentSlotForGridCell(
      layout,
      selectedQx,
      selectedQy,
    );
    if (!link) return null;
    return { qx: selectedQx, qy: selectedQy, ...link };
  };
  updateOk();
}

function plmMergeLandmarkIntoGroup(landmarkId, groupId, selection, layout) {
  if (!selection || !layout) return false;
  const idx = personalLandmarksList.findIndex((x) => x.id === landmarkId);
  if (idx < 0) return false;
  const item = personalLandmarksList[idx];
  if (item.groupId) return false;
  const pos = plmLatLngFromGridOffset(
    layout.pivotLat,
    layout.pivotLng,
    selection.qx,
    selection.qy,
  );
  if (!pos || !plmIsValidPlmLatLng(pos[0], pos[1])) return false;
  const groupName =
    String(plmLandmarkForGroupLabel(groupId)?.name ?? "").trim() || item.name;
  const pivot = plmGroupPivotMember(groupId);
  const grid =
    pivot && plmIsValidPlmLatLng(pivot.lat, pivot.lng)
      ? plmGridOffsetFromPivotLatLng(pivot.lat, pivot.lng, pos[0], pos[1])
      : { qx: selection.qx, qy: selection.qy };
  personalLandmarksList[idx] = {
    ...item,
    lat: pos[0],
    lng: pos[1],
    groupId,
    parentId: selection.parentId,
    slot: selection.slot,
    gridQx: grid.qx,
    gridQy: grid.qy,
    name: groupName,
    description: "",
  };
  layout.cells.set(`${selection.qx},${selection.qy}`, {
    landmarkId,
    isPivot: false,
  });
  if (plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForGroup(groupId);
  }
  return true;
}

/**
 * Modale : choisir l’emplacement d’un repère isolé dans le groupe le plus proche.
 * @returns {Promise<boolean>} true si fusion effectuée
 */
function openPlmMergeIntoGroupDialog(landmarkId) {
  return new Promise((resolve) => {
    const groupId = plmFindNearestGroupId(landmarkId);
    if (!groupId) {
      tamAppAlert("Aucun groupe de repères à proximité.");
      resolve(false);
      return;
    }
    const layout = plmBuildGroupGridLayout(groupId, 1);
    if (!layout) {
      tamAppAlert("Impossible d’afficher la grille du groupe.");
      resolve(false);
      return;
    }
    const dlg = document.getElementById("appPlmMergeGroupDialog");
    const introEl = document.getElementById("appPlmMergeGroupDialogIntro");
    const gridEl = document.getElementById("appPlmMergeGroupDialogGrid");
    const okBtn = document.getElementById("appPlmMergeGroupDialogOk");
    const cancelBtn = document.getElementById("appPlmMergeGroupDialogCancel");
    if (
      !dlg ||
      typeof dlg.showModal !== "function" ||
      !introEl ||
      !gridEl ||
      !okBtn ||
      !cancelBtn
    ) {
      resolve(false);
      return;
    }
    const groupLabel =
      String(plmLandmarkForGroupLabel(groupId)?.name ?? "").trim() ||
      "groupe proche";
    introEl.textContent = `Choisissez l’emplacement dans « ${groupLabel} » (cliquez sur +). Les cases vides autour du groupe sont proposées.`;
    plmRenderMergeGroupGrid(gridEl, layout);
    let settled = false;
    const finish = (merged) => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      resolve(!!merged);
    };
    const onOk = () => {
      const sel =
        typeof gridEl._plmGetMergeSelection === "function"
          ? gridEl._plmGetMergeSelection()
          : null;
      if (!sel) return;
      if (!plmMergeLandmarkIntoGroup(landmarkId, groupId, sel, layout)) {
        tamAppAlert("Impossible de fusionner le repère à cet emplacement.");
        return;
      }
      savePersonalLandmarksToStorage();
      redrawPersonalLandmarksLayer();
      setGpsStatus(`Repère fusionné dans le groupe « ${groupLabel} ».`);
      finish(true);
    };
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    const onBackdrop = (ev) => {
      if (ev.target === dlg) finish(false);
    };
    okBtn.addEventListener("click", onOk, { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
    dlg.addEventListener("close", onClose, { once: true });
    dlg.addEventListener("click", onBackdrop, { once: true });
    dlg.showModal();
  });
}

function plmAddChildrenFromSlots(
  parentId,
  centerLat,
  centerLng,
  groupId,
  slots,
  baseName,
  iconId,
  colorHex,
) {
  if (!parentId || !groupId || !slots?.length) return 0;
  let added = 0;
  for (const slot of slots) {
    if (!PLM_SLOT_DELTA[slot]) continue;
    const taken = plmOccupiedSlotsAroundCenter(
      centerLat,
      centerLng,
      parentId,
      groupId,
    ).has(slot);
    if (taken) continue;
    let lat;
    let lng;
    if (plmMapUsesMagneticLayout()) {
      const pos = plmLatLngFromSlot(centerLat, centerLng, slot);
      if (!pos) continue;
      lat = pos[0];
      lng = pos[1];
    } else {
      const pos = plmLatLngFromSlotDegrees(centerLat, centerLng, slot);
      if (!pos) continue;
      lat = pos[0];
      lng = pos[1];
    }
    if (!plmIsValidPlmLatLng(lat, lng)) continue;
    const parentRow = personalLandmarksList.find((x) => x.id === parentId);
    const iconBearingDeg = plmLandmarkHasIconBearing(parentRow)
      ? plmNormalizeBearingDeg(Number(parentRow.iconBearingDeg))
      : plmCaptureLandmarkIconBearingDeg();
    const pivot = plmGroupPivotMember(groupId);
    const grid =
      pivot && plmIsValidPlmLatLng(pivot.lat, pivot.lng)
        ? plmGridOffsetFromPivotLatLng(pivot.lat, pivot.lng, lat, lng)
        : (() => {
            const dir = PLM_SLOT_PIXEL_DIR[slot];
            return { qx: dir ? dir[0] : 0, qy: dir ? dir[1] : 0 };
          })();
    personalLandmarksList.push({
      id: plmNewLandmarkId(),
      lat,
      lng,
      name: baseName,
      description: "",
      iconId: normalizePlmIconId(iconId),
      colorHex: normalizePlmColorHex(colorHex),
      groupId,
      parentId,
      slot,
      gridQx: grid.qx,
      gridQy: grid.qy,
      iconBearingDeg,
    });
    added += 1;
  }
  return added;
}

function plmSanitizeParentLinks() {
  let changed = false;
  for (let i = 0; i < personalLandmarksList.length; i++) {
    const row = personalLandmarksList[i];
    const pid = String(row.parentId ?? "").trim();
    if (!pid) continue;
    if (!personalLandmarksList.some((x) => x.id === pid)) {
      const next = { ...row };
      delete next.parentId;
      delete next.slot;
      personalLandmarksList[i] = next;
      changed = true;
    }
  }
  return changed;
}

function plmCommitDialogSave(r) {
  if (r.action !== "save") return { ok: false, added: 0 };
  const name = String(r.name ?? "").trim();
  const slots = Array.isArray(r.slots) ? r.slots : [];
  let groupId = r.groupId || null;
  if (slots.length && !groupId) {
    groupId = plmGenerateGroupId();
  }

  if (r.id) {
    const idx = personalLandmarksList.findIndex((x) => x.id === r.id);
    if (idx < 0) return { ok: false, added: 0 };
    const prev = personalLandmarksList[idx];
    const adding = slots.length > 0;
    const finalGroupId = groupId || prev.groupId || null;
    const row = {
      id: r.id,
      lat: prev.lat,
      lng: prev.lng,
      name,
      description: finalGroupId ? "" : String(r.description ?? "").trim(),
      iconId: adding
        ? normalizePlmIconId(prev.iconId)
        : normalizePlmIconId(r.iconId),
      colorHex: adding
        ? normalizePlmColorHex(prev.colorHex)
        : normalizePlmColorHex(r.colorHex),
    };
    const titleColorHex = adding
      ? normalizePlmTitleColorHex(prev.titleColorHex)
      : normalizePlmTitleColorHex(r.titleColorHex);
    if (titleColorHex) row.titleColorHex = titleColorHex;
    delete row.hideName;
    if (finalGroupId) row.groupId = finalGroupId;
    if (prev.parentId) {
      row.parentId = prev.parentId;
      row.slot = prev.slot;
    }
    if (plmLandmarkHasIconBearing(prev)) {
      row.iconBearingDeg = plmNormalizeBearingDeg(Number(prev.iconBearingDeg));
    }
    personalLandmarksList[idx] = row;
    if (finalGroupId) {
      plmSetGroupDescription(finalGroupId, r.description);
      if (name) {
        plmSyncGroupMemberNames(finalGroupId, name);
      }
    }
    const center = personalLandmarksList[idx];
    const cpos = plmDisplayLatLngForLandmark(center);
    const added = plmAddChildrenFromSlots(
      r.id,
      cpos.lat,
      cpos.lng,
      finalGroupId,
      slots,
      r.name,
      r.iconId,
      r.colorHex,
    );
    if (finalGroupId) {
      plmRefreshGroupGridOffsets(finalGroupId);
    }
    if (!finalGroupId && !slots.length) {
      plmRemoveGroupIfEmpty(prev.groupId);
    }
    return { ok: true, added };
  }

  const newId = plmNewLandmarkId();
  const snapped = plmSnapLandmarkLatLngNearNeighbors(
    Number(r.lat),
    Number(r.lng),
  );
  let row = {
    id: newId,
    lat: snapped.lat,
    lng: snapped.lng,
    name,
    description: String(r.description ?? "").trim(),
    iconId: normalizePlmIconId(r.iconId),
    colorHex: normalizePlmColorHex(r.colorHex),
  };
  const newTitleColor = normalizePlmTitleColorHex(r.titleColorHex);
  if (newTitleColor) row.titleColorHex = newTitleColor;
  delete row.hideName;
  row.iconBearingDeg = plmCaptureLandmarkIconBearingDeg();
  if (snapped.snapped && snapped.anchorLandmarkId) {
    row = plmApplySnapAlignBearingToAnchor(row, snapped.anchorLandmarkId);
  }
  personalLandmarksList.push(row);
  if (plmMapUsesMagneticLayout()) {
    plmBakeSoloLandmarksMagneticClusters();
  }
  return { ok: true, added: 0, snapped: snapped.snapped };
}

function plmNewZoneId() {
  return `plmz_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function plmNormalizeZoneShape(raw) {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "rectangle") return "rectangle";
  if (
    s === "quadrilateral" ||
    s === "trapeze" ||
    s === "trapèze" ||
    s === "trapezoid"
  ) {
    return "quadrilateral";
  }
  if (s === "ellipse" || s === "oval" || s === "ovale") return "ellipse";
  return "circle";
}

function plmHeadingUpCheckboxEl() {
  return typeof headingUpEl !== "undefined"
    ? headingUpEl
    : document.getElementById("headingUp");
}

/** Case « Cap » cochée (rotation carte pilotée par le cap). */
function plmMapHeadingUpActive() {
  if (!map) return false;
  return !!plmHeadingUpCheckboxEl()?.checked;
}

/** Mode Cap actif : rectangle aligné à l’écran, pas au nord géographique. */
function plmMapUsesCapView() {
  if (!plmMapHeadingUpActive()) return false;
  if (typeof map.getBearing !== "function") return false;
  return Math.abs(map.getBearing()) > 0.4;
}

function plmMapBearingDeg() {
  if (!map || typeof map.getBearing !== "function") return 0;
  const b = map.getBearing();
  return Number.isFinite(b) ? b : 0;
}

function plmNormalizeBearingDeg(deg) {
  return ((Number(deg) % 360) + 360) % 360;
}

function plmLandmarkHasIconBearing(item) {
  const v = item?.iconBearingDeg;
  return v != null && v !== "" && Number.isFinite(Number(v));
}

/** Cap carte (°) au placement si « Cap » est coché — ancrage comme une zone. */
function plmCaptureLandmarkIconBearingDeg() {
  if (!plmMapHeadingUpActive()) return 0;
  return plmNormalizeBearingDeg(plmMapBearingDeg());
}

/** Rotation fixe au placement ; en Cap, rotateWithView ajoute le cap courant (comme les zones). */
function plmLandmarkIconRotationRad(item) {
  if (!plmLandmarkHasIconBearing(item)) return 0;
  return (
    (-plmNormalizeBearingDeg(Number(item.iconBearingDeg)) * Math.PI) / 180
  );
}

function plmLandmarkMarkerOptions(item) {
  return {
    icon: makePersonalLandmarkDivIcon(item),
    zIndexOffset: 450,
    draggable: true,
    bubblingMouseEvents: false,
    rotateWithView: plmMapHeadingUpActive(),
    rotation: plmLandmarkIconRotationRad(item),
  };
}

function plmSyncLandmarkMarkerRotations() {
  if (!plmLandmarksLayerVisible) return;
  const cap = plmMapHeadingUpActive();
  for (const item of personalLandmarksList) {
    const m = plmMarkerById.get(item.id);
    if (!m) continue;
    m.options.rotateWithView = cap;
    const disp = plmDisplayLatLngForLandmark(item);
    if (plmIsValidPlmLatLng(disp.lat, disp.lng)) {
      m.setLatLng([disp.lat, disp.lng]);
    }
    if (typeof m.setRotation === "function") {
      m.setRotation(plmLandmarkIconRotationRad(item));
    }
    m.update();
  }
  if (!plmLabelsVisible || !personalLandmarkLabelsLayer) return;
  personalLandmarkLabelsLayer.eachLayer((lm) => {
    const id = lm.__tamPlmLandmarkId;
    if (!id) return;
    const item = personalLandmarksList.find((x) => x.id === id);
    if (!item) return;
    const attach = plmLandmarkLabelAttachItem(item) || item;
    const m = plmMarkerById.get(attach.id);
    if (m) {
      const ll = m.getLatLng();
      if (plmIsValidPlmLatLng(ll.lat, ll.lng)) {
        lm.setLatLng(ll);
      }
    }
    lm.options.rotateWithView = cap;
    if (typeof lm.setRotation === "function") {
      lm.setRotation(plmLandmarkIconRotationRad(attach));
    }
    if (typeof lm.update === "function") lm.update();
  });
}

function plmEnsureRotationLayer() {
  if (!map) return null;
  if (!plmRotationLayer) {
    plmRotationLayer = L.layerGroup().addTo(map);
  }
  return plmRotationLayer;
}

function plmRotationPivotLatLng(item) {
  const disp = plmDisplayLatLngForLandmark(item);
  if (!plmIsValidPlmLatLng(disp.lat, disp.lng)) return null;
  return L.latLng(disp.lat, disp.lng);
}

function plmRotationHandleAngleDegFromLatLng(pivotLl, handleLl) {
  const p0 = map.latLngToContainerPoint(pivotLl);
  const p1 = map.latLngToContainerPoint(handleLl);
  return plmNormalizeBearingDeg((Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI);
}

function plmRotationHandleLatLngForItem(item) {
  if (!map || !item) return null;
  const pivot = plmRotationPivotLatLng(item);
  if (!pivot) return null;
  const bearing = plmLandmarkHasIconBearing(item)
    ? plmNormalizeBearingDeg(Number(item.iconBearingDeg))
    : 0;
  const dist = 44;
  const rad = ((-bearing + 90) * Math.PI) / 180;
  const p0 = map.latLngToContainerPoint(pivot);
  const p1 = L.point(
    p0.x + Math.cos(rad) * dist,
    p0.y + Math.sin(rad) * dist,
  );
  return map.containerPointToLatLng(p1);
}

function plmSetRotationTargetsDraggable(on) {
  const s = plmRotationSession;
  if (!s) return;
  for (const id of s.ids) {
    const m = plmMarkerById.get(id);
    if (!m?.dragging) continue;
    if (on) {
      if (s.dragWasEnabled?.get(id)) m.dragging.enable();
    } else {
      if (!s.dragWasEnabled) s.dragWasEnabled = new Map();
      const was =
        typeof m.dragging.enabled === "function" && m.dragging.enabled();
      s.dragWasEnabled.set(id, was);
      m.dragging.disable();
    }
  }
}

function plmApplyRotationSessionToStorage() {
  const s = plmRotationSession;
  if (!s) return;
  for (const id of s.ids) {
    const idx = personalLandmarksList.findIndex((x) => x.id === id);
    const live = s.liveBearings?.get(id);
    if (idx < 0 || live == null) continue;
    personalLandmarksList[idx] = {
      ...personalLandmarksList[idx],
      iconBearingDeg: plmNormalizeBearingDeg(live),
    };
  }
}

function plmClearRotationHandle() {
  if (plmRotationHandleMarker) {
    plmRotationHandleMarker.remove();
    plmRotationHandleMarker = null;
  }
  if (plmRotationLayer) plmRotationLayer.clearLayers();
}

function plmCancelLandmarkRotation() {
  if (!plmRotationSession) return;
  const s = plmRotationSession;
  plmRotationSession = null;
  if (s.onKeyDown) {
    document.removeEventListener("keydown", s.onKeyDown);
  }
  plmSetRotationTargetsDraggable(true);
  plmClearRotationHandle();
  plmSyncLandmarkMarkerRotations();
}

function plmCommitLandmarkRotation() {
  if (!plmRotationSession) return;
  plmApplyRotationSessionToStorage();
  plmCancelLandmarkRotation();
  savePersonalLandmarksToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus("Rotation du repère enregistrée.");
}

function plmRefreshRotationHandlePosition() {
  const s = plmRotationSession;
  if (!s || !plmRotationHandleMarker) return;
  const item = personalLandmarksList.find((x) => x.id === s.pivotLandmarkId);
  if (!item) return;
  const ll = plmRotationHandleLatLngForItem(item);
  if (ll) plmRotationHandleMarker.setLatLng(ll);
}

function plmUpdateLandmarkRotationFromHandle(handleLl) {
  const s = plmRotationSession;
  if (!s?.pivot) return;
  const angleNow = plmRotationHandleAngleDegFromLatLng(s.pivot, handleLl);
  if (s.handleAngle0 == null) {
    s.handleAngle0 = angleNow;
    return;
  }
  const delta = angleNow - s.handleAngle0;
  if (!s.liveBearings) s.liveBearings = new Map();
  for (const id of s.ids) {
    const start = s.startBearings.get(id) ?? 0;
    const live = plmNormalizeBearingDeg(start - delta);
    s.liveBearings.set(id, live);
    const idx = personalLandmarksList.findIndex((x) => x.id === id);
    if (idx < 0) continue;
    personalLandmarksList[idx] = {
      ...personalLandmarksList[idx],
      iconBearingDeg: live,
    };
    const m = plmMarkerById.get(id);
    if (m && typeof m.setRotation === "function") {
      m.setRotation(plmLandmarkIconRotationRad(personalLandmarksList[idx]));
      m.update();
    }
  }
}

function plmStartLandmarkRotation(landmarkId) {
  if (
    typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
    tamCloudBlocksLandmarkZoneEdits()
  ) {
    return;
  }
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item || !map) return;
  plmCancelLandmarkRotation();

  const ids = item.groupId
    ? plmMembersOfGroup(item.groupId).map((m) => m.id)
    : [landmarkId];
  const startBearings = new Map();
  for (const id of ids) {
    const row = personalLandmarksList.find((x) => x.id === id);
    if (!row) continue;
    const bearing = plmLandmarkHasIconBearing(row)
      ? plmNormalizeBearingDeg(Number(row.iconBearingDeg))
      : plmCaptureLandmarkIconBearingDeg();
    startBearings.set(id, bearing);
    const idx = personalLandmarksList.findIndex((x) => x.id === id);
    if (idx >= 0) {
      personalLandmarksList[idx] = { ...row, iconBearingDeg: bearing };
    }
  }

  const pivot = plmRotationPivotLatLng(item);
  if (!pivot) return;

  plmRotationSession = {
    ids,
    pivotLandmarkId: landmarkId,
    pivot,
    startBearings,
    liveBearings: new Map(startBearings),
    handleAngle0: null,
    dragWasEnabled: null,
  };

  plmSetRotationTargetsDraggable(false);
  const layer = plmEnsureRotationLayer();
  if (!layer) return;
  layer.clearLayers();

  const handleLl = plmRotationHandleLatLngForItem(item);
  if (!handleLl) return;

  plmRotationHandleMarker = L.marker(handleLl, {
    draggable: true,
    bubblingMouseEvents: false,
    zIndexOffset: 1300,
    icon: L.divIcon({
      className: "tam-plm-rotation-handle",
      html: "↻",
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
  });
  plmRotationHandleMarker.on("mousedown touchstart", (e) => {
    L.DomEvent.stopPropagation(e);
  });
  plmRotationHandleMarker.on("drag", () => {
    plmUpdateLandmarkRotationFromHandle(plmRotationHandleMarker.getLatLng());
  });
  plmRotationHandleMarker.on("dragend", () => {
    plmCommitLandmarkRotation();
  });
  plmRotationHandleMarker.addTo(layer);

  plmRotationSession.onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      const s = plmRotationSession;
      if (!s) return;
      for (const id of s.ids) {
        const idx = personalLandmarksList.findIndex((x) => x.id === id);
        if (idx < 0) continue;
        personalLandmarksList[idx] = {
          ...personalLandmarksList[idx],
          iconBearingDeg: s.startBearings.get(id) ?? 0,
        };
      }
      plmCancelLandmarkRotation();
      redrawPersonalLandmarksLayer();
      setGpsStatus("Rotation annulée.");
    }
  };
  document.addEventListener("keydown", plmRotationSession.onKeyDown);

  setGpsStatus(
    item.groupId
      ? "Rotation du groupe : faites pivoter la poignée ↻, relâchez pour valider. Échap : annuler."
      : "Rotation : faites pivoter la poignée ↻, relâchez pour valider. Échap : annuler.",
  );
}

function plmZoneLatLngsToCornerTuples(latlngs) {
  return latlngs.map((ll) => [ll.lat, ll.lng]);
}

function plmZoneCornerTuplesToLatLngs(corners) {
  return corners.map(([la, ln]) => L.latLng(la, ln));
}

function plmRectangleCornersFromNorthBounds(swLat, swLng, neLat, neLng) {
  const south = Math.min(swLat, neLat);
  const north = Math.max(swLat, neLat);
  const west = Math.min(swLng, neLng);
  const east = Math.max(swLng, neLng);
  return [
    [south, west],
    [south, east],
    [north, east],
    [north, west],
  ];
}

/** Rectangle dont les côtés suivent l’affichage carte (mode Cap). */
function plmZoneScreenRectCornersLatLng(latLng1, latLng2) {
  const p1 = map.latLngToContainerPoint(latLng1);
  const p2 = map.latLngToContainerPoint(latLng2);
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  return [
    map.containerPointToLatLng(L.point(minX, minY)),
    map.containerPointToLatLng(L.point(maxX, minY)),
    map.containerPointToLatLng(L.point(maxX, maxY)),
    map.containerPointToLatLng(L.point(minX, maxY)),
  ];
}

function plmZoneRectangleFromTwoLatLng(p1, p2) {
  if (plmMapUsesCapView()) {
    return {
      corners: plmZoneLatLngsToCornerTuples(
        plmZoneScreenRectCornersLatLng(p1, p2),
      ),
      alignedToView: true,
    };
  }
  const b = L.latLngBounds(p1, p2);
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    corners: plmRectangleCornersFromNorthBounds(
      sw.lat,
      sw.lng,
      ne.lat,
      ne.lng,
    ),
    alignedToView: false,
  };
}

function plmZoneRectangleMinSizeOk(corners) {
  if (!map || !corners || corners.length < 4) return false;
  const ll = plmZoneCornerTuplesToLatLngs(corners);
  const d01 = map.distance(ll[0], ll[1]);
  const d12 = map.distance(ll[1], ll[2]);
  return (
    Math.max(d01, d12) >= PLM_ZONE_MIN_RADIUS_M &&
    Math.min(d01, d12) >= 1
  );
}

function plmZoneProjectMeters(ll, origin) {
  const p = map.project(ll, map.getZoom());
  const o = map.project(origin, map.getZoom());
  const latMid = (ll.lat + origin.lat) / 2;
  const mPerPx =
    (40075000 * Math.cos((latMid * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
  return { x: (p.x - o.x) * mPerPx, y: (o.y - p.y) * mPerPx };
}

function plmZoneUnprojectMeters(xy, origin) {
  const latMid = origin.lat;
  const mPerPx =
    (40075000 * Math.cos((latMid * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
  const o = map.project(origin, map.getZoom());
  const p = L.point(o.x + xy.x / mPerPx, o.y - xy.y / mPerPx);
  return map.unproject(p, map.getZoom());
}

/** Rectangle : coin opposé fixe, côtés opposés parallèles (écran en mode Cap, sinon repère local). */
function plmZoneDragRectangleCorner(corners, alignedToView, dragIndex, newLl) {
  const c = plmZoneCornerTuplesToLatLngs(corners);
  const opp = (dragIndex + 2) % 4;
  if (alignedToView) {
    const pOpp = map.latLngToContainerPoint(c[opp]);
    const pDrag = map.latLngToContainerPoint(newLl);
    const minX = Math.min(pOpp.x, pDrag.x);
    const maxX = Math.max(pOpp.x, pDrag.x);
    const minY = Math.min(pOpp.y, pDrag.y);
    const maxY = Math.max(pOpp.y, pDrag.y);
    return plmZoneLatLngsToCornerTuples(
      plmZoneScreenRectCornersLatLng(
        map.containerPointToLatLng(L.point(minX, minY)),
        map.containerPointToLatLng(L.point(maxX, maxY)),
      ),
    );
  }
  const origin = L.latLng(
    (c[dragIndex].lat + c[opp].lat) / 2,
    (c[dragIndex].lng + c[opp].lng) / 2,
  );
  const u0 = plmZoneProjectMeters(c[(dragIndex + 1) % 4], origin);
  const v0 = plmZoneProjectMeters(c[(dragIndex + 3) % 4], origin);
  let ux = u0.x - plmZoneProjectMeters(c[dragIndex], origin).x;
  let uy = u0.y - plmZoneProjectMeters(c[dragIndex], origin).y;
  let vx = v0.x - plmZoneProjectMeters(c[dragIndex], origin).x;
  let vy = v0.y - plmZoneProjectMeters(c[dragIndex], origin).y;
  const lenU = Math.hypot(ux, uy) || 1;
  ux /= lenU;
  uy /= lenU;
  const dot = vx * ux + vy * uy;
  vx -= dot * ux;
  vy -= dot * uy;
  const lenV = Math.hypot(vx, vy) || 1;
  vx /= lenV;
  vy /= lenV;
  const pDrag = plmZoneProjectMeters(newLl, origin);
  const pOpp = plmZoneProjectMeters(c[opp], origin);
  const halfDiagX = (pDrag.x - pOpp.x) / 2;
  const halfDiagY = (pDrag.y - pOpp.y) / 2;
  const halfW = Math.abs(halfDiagX * ux + halfDiagY * uy);
  const halfH = Math.abs(halfDiagX * vx + halfDiagY * vy);
  const centerM = {
    x: (pDrag.x + pOpp.x) / 2,
    y: (pDrag.y + pOpp.y) / 2,
  };
  const mk = (sx, sy) =>
    plmZoneUnprojectMeters(
      { x: centerM.x + sx * halfW * ux + sy * halfH * vx, y: centerM.y + sx * halfW * uy + sy * halfH * vy },
      origin,
    );
  return plmZoneLatLngsToCornerTuples([
    mk(-1, -1),
    mk(1, -1),
    mk(1, 1),
    mk(-1, 1),
  ]);
}

function plmZoneEllipseRingLatLngs(z, segments = 64) {
  const pts = [];
  const bearing0 = Number(z.bearingDeg) || 0;
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    const mx = z.radiusMajorM * Math.cos(t);
    const my = z.radiusMinorM * Math.sin(t);
    const dist = Math.max(PLM_ZONE_MIN_RADIUS_M, Math.hypot(mx, my));
    const ang =
      bearing0 + (Math.atan2(my, mx) * 180) / Math.PI;
    pts.push(plmDestinationLatLng(z.centerLat, z.centerLng, ang, dist));
  }
  return pts;
}

/** Point d’ancrage au-dessus de la zone ; largeur du cadre = longueur du nom (écran). */
function plmZoneLabelLayout(zone, name) {
  if (!map || !zone) return null;
  const pts = plmZoneLatLngsFromShape(zone);
  if (!pts.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const ll of pts) {
    const p = map.latLngToContainerPoint(ll);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minX)) return null;
  const widthPx = plmMeasureZoneLabelBarWidthPx(name);
  const centerX = (minX + maxX) / 2;
  const baseAnchorY = minY - PLM_ZONE_LABEL_GAP_ABOVE_PX;
  return { centerX, baseAnchorY, widthPx };
}

function plmZoneLabelBarScreenRect(centerX, anchorY, widthPx) {
  const half = widthPx / 2;
  return {
    left: centerX - half,
    right: centerX + half,
    top: anchorY - PLM_ZONE_LABEL_HEIGHT_PX,
    bottom: anchorY,
  };
}

function plmZoneLabelBarsOverlap(a, b) {
  return !(
    a.right <= b.left ||
    b.right <= a.left ||
    a.bottom <= b.top ||
    b.bottom <= a.top
  );
}

/** Empile bord à bord (écran) : zones basses d’abord, remontée si chevauchement. */
function plmResolveZoneLabelStackAnchorY(item, placedRects) {
  let anchorY = item.baseAnchorY;
  for (let pass = 0; pass < placedRects.length + 1; pass++) {
    const rect = plmZoneLabelBarScreenRect(item.centerX, anchorY, item.widthPx);
    const hits = placedRects.filter((p) => plmZoneLabelBarsOverlap(rect, p));
    if (!hits.length) return anchorY;
    const stackY = Math.min(...hits.map((h) => h.top));
    if (stackY >= anchorY) return anchorY;
    anchorY = stackY;
  }
  return anchorY;
}

function plmCreateZoneMapLabelIcon(name, widthPx, strokeColor) {
  const w = Math.round(widthPx);
  const border = strokeColor || "#8b2500";
  const html =
    `<div class="tam-plm-zone-map-label__bar" style="width:${w}px;border-color:${border}">` +
    `<span class="tam-plm-zone-map-label__text">${plmEscapeHtml(name)}</span></div>`;
  const h = PLM_ZONE_LABEL_HEIGHT_PX;
  return L.divIcon({
    className: "tam-plm-zone-map-label",
    html,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
  });
}

function plmZoneLatLngsFromShape(zone) {
  const shape = plmNormalizeZoneShape(zone?.shape);
  if (shape === "circle") {
    return plmZoneEllipseRingLatLngs({
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusMajorM: zone.radiusM,
      radiusMinorM: zone.radiusM,
      bearingDeg: 0,
    });
  }
  if (shape === "ellipse") {
    return plmZoneEllipseRingLatLngs(zone);
  }
  return plmZoneCornerTuplesToLatLngs(zone.corners);
}

function plmZoneBoundsCornersFromLatLngs(latlngs, preferCapView) {
  if (!latlngs?.length || !map) return null;
  const useCap = !!preferCapView && plmMapUsesCapView();
  if (useCap) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ll of latlngs) {
      const p = map.latLngToContainerPoint(ll);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    return {
      corners: plmZoneLatLngsToCornerTuples(
        plmZoneScreenRectCornersLatLng(
          map.containerPointToLatLng(L.point(minX, minY)),
          map.containerPointToLatLng(L.point(maxX, maxY)),
        ),
      ),
      alignedToView: true,
    };
  }
  const b = L.latLngBounds(latlngs);
  const sw = b.getSouthWest();
  const ne = b.getNorthEast();
  return {
    corners: plmRectangleCornersFromNorthBounds(
      sw.lat,
      sw.lng,
      ne.lat,
      ne.lng,
    ),
    alignedToView: false,
  };
}

/** Conversion géométrique pour changer de forme sans re-tracer. */
function plmZoneConvertShape(zone, targetShape) {
  if (!zone) return null;
  const from = plmNormalizeZoneShape(zone.shape);
  const to = plmNormalizeZoneShape(targetShape);
  const base = {
    enabled: true,
    strokeColor: zone.strokeColor,
    strokeWeight: zone.strokeWeight,
    shape: to,
  };
  if (from === to) {
    return { ...zone, ...base, shape: to };
  }
  if (
    (from === "rectangle" || from === "quadrilateral") &&
    (to === "rectangle" || to === "quadrilateral")
  ) {
    if (to === "quadrilateral") {
      return {
        ...base,
        corners: zone.corners,
        alignedToView: !!zone.alignedToView,
      };
    }
    const pts = plmZoneCornerTuplesToLatLngs(zone.corners);
    const box = plmZoneBoundsCornersFromLatLngs(pts, zone.alignedToView);
    if (!box) return null;
    return { ...base, corners: box.corners, alignedToView: box.alignedToView };
  }
  if (from === "circle" && to === "ellipse") {
    return {
      ...base,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusMajorM: zone.radiusM,
      radiusMinorM: zone.radiusM,
      bearingDeg: 0,
    };
  }
  if (from === "ellipse" && to === "circle") {
    return {
      ...base,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusM: Math.max(zone.radiusMajorM, zone.radiusMinorM),
    };
  }
  const pts = plmZoneLatLngsFromShape(zone);
  if (!pts.length) return null;
  const centroid = L.latLng(
    pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  );
  if (to === "circle") {
    let radiusM = PLM_ZONE_MIN_RADIUS_M;
    for (const p of pts) {
      radiusM = Math.max(radiusM, map.distance(centroid, p));
    }
    return {
      ...base,
      centerLat: centroid.lat,
      centerLng: centroid.lng,
      radiusM,
    };
  }
  if (to === "ellipse") {
    const b = L.latLngBounds(pts);
    const c = b.getCenter();
    const ne = b.getNorthEast();
    const radiusMajorM = Math.max(
      PLM_ZONE_MIN_RADIUS_M,
      map.distance(c, L.latLng(ne.lat, c.lng)),
    );
    const radiusMinorM = Math.max(
      PLM_ZONE_MIN_RADIUS_M,
      map.distance(c, L.latLng(c.lat, ne.lng)),
    );
    return {
      ...base,
      centerLat: c.lat,
      centerLng: c.lng,
      radiusMajorM,
      radiusMinorM,
      bearingDeg: from === "ellipse" ? Number(zone.bearingDeg) || 0 : 0,
    };
  }
  if (to === "rectangle" || to === "quadrilateral") {
    const preferCap =
      from === "rectangle" || from === "quadrilateral"
        ? !!zone.alignedToView
        : plmMapUsesCapView();
    if (to === "quadrilateral" && (from === "quadrilateral" || from === "rectangle")) {
      return {
        ...base,
        corners: zone.corners,
        alignedToView: !!zone.alignedToView,
      };
    }
    const box = plmZoneBoundsCornersFromLatLngs(pts, preferCap);
    if (!box) return null;
    return {
      ...base,
      corners: box.corners,
      alignedToView: box.alignedToView,
    };
  }
  return null;
}

function plmNormalizeZonePayload(raw) {
  if (!raw || raw.enabled === false) return null;
  const shape = plmNormalizeZoneShape(raw.shape);
  const strokeColor = normalizePlmColorHex(raw.strokeColor);
  const strokeWeight = Math.min(
    12,
    Math.max(1, Math.round(Number(raw.strokeWeight) || PLM_ZONE_DEFAULT_WEIGHT)),
  );
  if (shape === "rectangle" || shape === "quadrilateral") {
    let corners = null;
    let alignedToView = !!raw.alignedToView;
    if (Array.isArray(raw.corners) && raw.corners.length >= 4) {
      corners = raw.corners.slice(0, 4).map((c) => {
        const la = Number(Array.isArray(c) ? c[0] : c?.lat);
        const ln = Number(Array.isArray(c) ? c[1] : c?.lng);
        if (!plmIsValidPlmLatLng(la, ln)) return null;
        return [la, ln];
      });
      if (corners.some((x) => !x)) return null;
    } else {
      const swLat = Number(raw.swLat);
      const swLng = Number(raw.swLng);
      const neLat = Number(raw.neLat);
      const neLng = Number(raw.neLng);
      if (
        !plmIsValidPlmLatLng(swLat, swLng) ||
        !plmIsValidPlmLatLng(neLat, neLng)
      ) {
        return null;
      }
      corners = plmRectangleCornersFromNorthBounds(swLat, swLng, neLat, neLng);
      alignedToView = false;
    }
    if (!plmZoneRectangleMinSizeOk(corners)) return null;
    return {
      enabled: true,
      shape,
      strokeColor,
      strokeWeight,
      corners,
      alignedToView,
    };
  }
  const centerLat = Number(raw.centerLat);
  const centerLng = Number(raw.centerLng);
  if (!plmIsValidPlmLatLng(centerLat, centerLng)) return null;
  if (shape === "ellipse") {
    let radiusMajorM = Number(raw.radiusMajorM);
    let radiusMinorM = Number(raw.radiusMinorM);
    if (!Number.isFinite(radiusMajorM) && Number.isFinite(Number(raw.radiusM))) {
      radiusMajorM = Number(raw.radiusM);
    }
    if (!Number.isFinite(radiusMinorM) && Number.isFinite(Number(raw.radiusM))) {
      radiusMinorM = Number(raw.radiusM);
    }
    if (
      !Number.isFinite(radiusMajorM) ||
      !Number.isFinite(radiusMinorM) ||
      radiusMajorM < PLM_ZONE_MIN_RADIUS_M ||
      radiusMinorM < PLM_ZONE_MIN_RADIUS_M
    ) {
      return null;
    }
    return {
      enabled: true,
      shape: "ellipse",
      strokeColor,
      strokeWeight,
      centerLat,
      centerLng,
      radiusMajorM,
      radiusMinorM,
      bearingDeg: Number(raw.bearingDeg) || 0,
    };
  }
  const radiusM = Number(raw.radiusM);
  if (!Number.isFinite(radiusM) || radiusM < PLM_ZONE_MIN_RADIUS_M) {
    return null;
  }
  return {
    enabled: true,
    shape: "circle",
    strokeColor,
    strokeWeight,
    centerLat,
    centerLng,
    radiusM,
  };
}

function plmZoneLayerOptions(zone, selected) {
  const o = {
    color: zone.strokeColor,
    weight: zone.strokeWeight,
    opacity: 0.95,
    fillColor: zone.strokeColor,
    fillOpacity: 0.1,
    interactive: true,
    className: selected
      ? "tam-plm-zone-path tam-plm-zone-path--selected"
      : "tam-plm-zone-path",
  };
  if (selected) {
    o.weight = zone.strokeWeight + 2;
    o.dashArray = "9 6";
  }
  return o;
}

function plmZoneOwnerKey(owner) {
  if (!owner) return "";
  return owner.kind === "zone" ? `z:${owner.id}` : "";
}

function plmZoneRecordOwner(zoneId) {
  if (!zoneId) return null;
  return { kind: "zone", id: zoneId };
}

function plmGetZoneOnLandmarkRow(row) {
  if (!row) return null;
  return plmNormalizeZonePayload(row.zone);
}

function plmZoneRowToPayload(row) {
  if (!row) return null;
  const { id, ...rest } = row;
  return plmNormalizeZonePayload(rest);
}

function loadPersonalZonesFromStorage() {
  try {
    const raw = JSON.parse(
      localStorage.getItem(LS_KEY_PERSONAL_ZONES) || "[]",
    );
    personalZonesList = Array.isArray(raw)
      ? raw.filter((z) => z && typeof z.id === "string")
      : [];
  } catch (e) {
    personalZonesList = [];
  }
}

function savePersonalZonesToStorage(skipFileBackup) {
  try {
    localStorage.setItem(
      LS_KEY_PERSONAL_ZONES,
      JSON.stringify(personalZonesList),
    );
  } catch (e) {
    /* ignore */
  }
  if (!skipFileBackup && typeof plmScheduleAutoBackup === "function") {
    plmScheduleAutoBackup();
  }
}

function plmMigrateAllZonesToIndependentList() {
  let changed = false;
  for (let i = 0; i < personalLandmarksList.length; i++) {
    const item = personalLandmarksList[i];
    const z = plmGetZoneOnLandmarkRow(item);
    if (!z) continue;
    personalZonesList.push({ id: plmNewZoneId(), ...z });
    const next = { ...personalLandmarksList[i] };
    delete next.zone;
    personalLandmarksList[i] = next;
    changed = true;
  }
  const seenGroups = new Set();
  for (const gid of Object.keys(plmGroupsById)) {
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    const gz = plmNormalizeZonePayload(plmGroupsById[gid]?.zone);
    if (!gz) continue;
    personalZonesList.push({ id: plmNewZoneId(), ...gz });
    const next = { ...plmGroupsById[gid] };
    delete next.zone;
    if (Object.keys(next).length === 0) delete plmGroupsById[gid];
    else plmGroupsById[gid] = next;
    changed = true;
  }
  if (changed) {
    savePersonalZonesToStorage(true);
    try {
      savePersonalLandmarksToStorage(true);
      savePlmGroupsToStorage();
    } catch (e) {
      /* ignore */
    }
  }
  return changed;
}

function plmZoneOwnersEqual(a, b) {
  return (
    !!a &&
    !!b &&
    a.kind === b.kind &&
    String(a.id) === String(b.id)
  );
}

function plmGetZoneForOwner(owner) {
  if (!owner || owner.kind !== "zone") return null;
  const row = personalZonesList.find((x) => x.id === owner.id);
  return plmZoneRowToPayload(row);
}

function plmSetZoneForOwner(owner, zone) {
  if (!owner || owner.kind !== "zone") return;
  const normalized = zone ? plmNormalizeZonePayload(zone) : null;
  const idx = personalZonesList.findIndex((x) => x.id === owner.id);
  if (idx < 0) return;
  const prevName = personalZonesList[idx]?.name;
  if (normalized) {
    const row = { id: owner.id, ...normalized };
    if (prevName != null && String(prevName).trim()) {
      row.name = String(prevName).trim();
    }
    personalZonesList[idx] = row;
  } else {
    personalZonesList.splice(idx, 1);
  }
  if (plmZoneOwnersEqual(plmSelectedZoneOwner, owner) && !normalized) {
    plmSelectedZoneOwner = null;
  }
  savePersonalZonesToStorage(true);
}

function plmDeleteZoneForOwner(owner) {
  plmSetZoneForOwner(owner, null);
  plmRedrawZonesLayer();
}

function plmSelectZoneOwner(owner) {
  if (!owner || !plmGetZoneForOwner(owner)) return;
  plmSelectedZoneOwner = owner;
  plmRedrawZonesLayer();
  plmZoneDrawSetHint(
    "Zone sélectionnée : glissez les poignées pour redimensionner. Suppr : effacer.",
  );
}

function plmClearZoneSelection() {
  if (!plmSelectedZoneOwner) return;
  plmSelectedZoneOwner = null;
  plmClearZoneEditHandles();
  plmRedrawZonesLayer();
}

function plmEnsureZoneEditHandlesLayer() {
  if (!map) return null;
  if (!plmZoneEditHandlesLayer) {
    plmZoneEditHandlesLayer = L.layerGroup().addTo(map);
  }
  return plmZoneEditHandlesLayer;
}

function plmClearZoneEditHandles() {
  if (plmZoneEditHandlesLayer) plmZoneEditHandlesLayer.clearLayers();
}

function plmZoneHandleMarker(lat, lng, onDrag, onDragEnd) {
  const m = L.marker([lat, lng], {
    draggable: true,
    bubblingMouseEvents: false,
    zIndexOffset: 1200,
    icon: L.divIcon({
      className: "tam-plm-zone-handle",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    }),
  });
  m.on("drag", () => {
    if (typeof onDrag === "function") onDrag(m.getLatLng());
  });
  m.on("dragend", () => {
    if (typeof onDragEnd === "function") onDragEnd(m.getLatLng());
  });
  return m;
}

function plmDestinationLatLng(lat, lng, bearingDeg, distM) {
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R) +
      Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1),
      Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return L.latLng((lat2 * 180) / Math.PI, (lng2 * 180) / Math.PI);
}

function plmRefreshZoneEditHandles() {
  plmClearZoneEditHandles();
  const layer = plmEnsureZoneEditHandlesLayer();
  if (!layer || !plmSelectedZoneOwner) return;
  const z = plmGetZoneForOwner(plmSelectedZoneOwner);
  if (!z) return;
  const owner = plmSelectedZoneOwner;

  const commitZone = (next) => {
    const normalized = plmNormalizeZonePayload(next);
    if (!normalized) return;
    plmSetZoneForOwner(owner, normalized);
    plmRedrawZonesLayer();
  };

  const syncPoly = (latlngs) => {
    const layerRef = personalZonesLayer?.getLayers?.().find(
      (ly) =>
        ly._plmZoneOwner && plmZoneOwnersEqual(ly._plmZoneOwner, owner),
    );
    if (layerRef && typeof layerRef.setLatLngs === "function") {
      layerRef.setLatLngs(latlngs);
    }
  };

  if (z.shape === "circle") {
    let live = { ...z };
    const syncCircle = () => {
      const layerRef = personalZonesLayer?.getLayers?.().find(
        (ly) =>
          ly._plmZoneOwner &&
          plmZoneOwnersEqual(ly._plmZoneOwner, owner),
      );
      if (layerRef && typeof layerRef.setLatLng === "function") {
        layerRef.setLatLng([live.centerLat, live.centerLng]);
        if (typeof layerRef.setRadius === "function") {
          layerRef.setRadius(live.radiusM);
        }
      }
    };
    const centerMk = plmZoneHandleMarker(
      z.centerLat,
      z.centerLng,
      (ll) => {
        live = { ...live, centerLat: ll.lat, centerLng: ll.lng };
        syncCircle();
      },
      (ll) => {
        live = { ...live, centerLat: ll.lat, centerLng: ll.lng };
        commitZone(live);
      },
    );
    const edge0 = plmDestinationLatLng(z.centerLat, z.centerLng, 0, z.radiusM);
    const edgeMk = plmZoneHandleMarker(
      edge0.lat,
      edge0.lng,
      (ll) => {
        const radiusM = Math.max(
          PLM_ZONE_MIN_RADIUS_M,
          map.distance(L.latLng(live.centerLat, live.centerLng), ll),
        );
        live = { ...live, radiusM };
        syncCircle();
      },
      (ll) => {
        const radiusM = Math.max(
          PLM_ZONE_MIN_RADIUS_M,
          map.distance(L.latLng(live.centerLat, live.centerLng), ll),
        );
        live = { ...live, radiusM };
        commitZone(live);
      },
    );
    centerMk.addTo(layer);
    edgeMk.addTo(layer);
    plmBindZoneHandleContextMenu(centerMk, owner);
    plmBindZoneHandleContextMenu(edgeMk, owner);
    return;
  }

  if (z.shape === "ellipse") {
    let live = { ...z };
    const syncEllipse = () => {
      syncPoly(plmZoneEllipseRingLatLngs(live));
    };
    const centerMk = plmZoneHandleMarker(
      z.centerLat,
      z.centerLng,
      (ll) => {
        live = { ...live, centerLat: ll.lat, centerLng: ll.lng };
        syncEllipse();
      },
      (ll) => {
        live = { ...live, centerLat: ll.lat, centerLng: ll.lng };
        commitZone(live);
      },
    );
    const majorPt = plmDestinationLatLng(
      z.centerLat,
      z.centerLng,
      z.bearingDeg,
      z.radiusMajorM,
    );
    const minorPt = plmDestinationLatLng(
      z.centerLat,
      z.centerLng,
      z.bearingDeg + 90,
      z.radiusMinorM,
    );
    const majorMk = plmZoneHandleMarker(
      majorPt.lat,
      majorPt.lng,
      (ll) => {
        live = {
          ...live,
          radiusMajorM: Math.max(
            PLM_ZONE_MIN_RADIUS_M,
            map.distance(L.latLng(live.centerLat, live.centerLng), ll),
          ),
          bearingDeg:
            (Math.atan2(
              ll.lng - live.centerLng,
              ll.lat - live.centerLat,
            ) *
              180) /
            Math.PI,
        };
        syncEllipse();
      },
      (ll) => {
        live = {
          ...live,
          radiusMajorM: Math.max(
            PLM_ZONE_MIN_RADIUS_M,
            map.distance(L.latLng(live.centerLat, live.centerLng), ll),
          ),
          bearingDeg:
            (Math.atan2(
              ll.lng - live.centerLng,
              ll.lat - live.centerLat,
            ) *
              180) /
            Math.PI,
        };
        commitZone(live);
      },
    );
    const minorMk = plmZoneHandleMarker(
      minorPt.lat,
      minorPt.lng,
      (ll) => {
        live = {
          ...live,
          radiusMinorM: Math.max(
            PLM_ZONE_MIN_RADIUS_M,
            map.distance(L.latLng(live.centerLat, live.centerLng), ll),
          ),
        };
        syncEllipse();
      },
      (ll) => {
        live = {
          ...live,
          radiusMinorM: Math.max(
            PLM_ZONE_MIN_RADIUS_M,
            map.distance(L.latLng(live.centerLat, live.centerLng), ll),
          ),
        };
        commitZone(live);
      },
    );
    centerMk.addTo(layer);
    majorMk.addTo(layer);
    minorMk.addTo(layer);
    plmBindZoneHandleContextMenu(centerMk, owner);
    plmBindZoneHandleContextMenu(majorMk, owner);
    plmBindZoneHandleContextMenu(minorMk, owner);
    return;
  }

  let corners = plmZoneCornerTuplesToLatLngs(z.corners);
  const constrained = z.shape === "rectangle";
  const syncCorners = () => {
    syncPoly(corners);
  };
  const commitCorners = () => {
    commitZone({
      ...z,
      corners: plmZoneLatLngsToCornerTuples(corners),
    });
  };
  let moveSnap = null;
  const centerLat = corners.reduce((s, c) => s + c.lat, 0) / 4;
  const centerLng = corners.reduce((s, c) => s + c.lng, 0) / 4;
  const centerMk = plmZoneHandleMarker(
    centerLat,
    centerLng,
    (ll) => {
      if (!moveSnap) {
        moveSnap = {
          lat0: ll.lat,
          lng0: ll.lng,
          corners0: corners.map((c) => ({ lat: c.lat, lng: c.lng })),
        };
      }
      const dLat = ll.lat - moveSnap.lat0;
      const dLng = ll.lng - moveSnap.lng0;
      corners = moveSnap.corners0.map((c) =>
        L.latLng(c.lat + dLat, c.lng + dLng),
      );
      syncCorners();
    },
    (ll) => {
      if (moveSnap) {
        const dLat = ll.lat - moveSnap.lat0;
        const dLng = ll.lng - moveSnap.lng0;
        corners = moveSnap.corners0.map((c) =>
          L.latLng(c.lat + dLat, c.lng + dLng),
        );
      }
      moveSnap = null;
      commitCorners();
    },
  );
  centerMk.addTo(layer);
  plmBindZoneHandleContextMenu(centerMk, owner);
  for (let i = 0; i < 4; i++) {
    const ll0 = corners[i];
    const mk = plmZoneHandleMarker(
      ll0.lat,
      ll0.lng,
      (ll) => {
        if (constrained) {
          corners = plmZoneCornerTuplesToLatLngs(
            plmZoneDragRectangleCorner(
              plmZoneLatLngsToCornerTuples(corners),
              !!z.alignedToView,
              i,
              ll,
            ),
          );
        } else {
          corners[i] = ll;
        }
        syncCorners();
      },
      (ll) => {
        if (constrained) {
          corners = plmZoneCornerTuplesToLatLngs(
            plmZoneDragRectangleCorner(
              plmZoneLatLngsToCornerTuples(corners),
              !!z.alignedToView,
              i,
              ll,
            ),
          );
        } else {
          corners[i] = ll;
        }
        commitCorners();
      },
    );
    mk.addTo(layer);
    plmBindZoneHandleContextMenu(mk, owner);
  }
}

function plmBindZoneLayerContextMenu(layer, owner) {
  layer.on("contextmenu", (e) => {
    L.DomEvent.stop(e);
    if (e.originalEvent) e.originalEvent.preventDefault();
    const ev = e.originalEvent || e;
    plmSelectZoneOwner(owner);
    plmShowZoneContextMenu(ev.clientX, ev.clientY, owner.id);
  });
}

function plmBindZoneHandleContextMenu(marker, owner) {
  marker.on("contextmenu", (e) => {
    L.DomEvent.stop(e);
    if (e.originalEvent) e.originalEvent.preventDefault();
    const ev = e.originalEvent || e;
    plmSelectZoneOwner(owner);
    plmShowZoneContextMenu(ev.clientX, ev.clientY, owner.id);
  });
}

function plmCreateZoneMapLayer(z, owner, selected) {
  const opts = plmZoneLayerOptions(z, selected);
  let layer;
  if (z.shape === "circle") {
    layer = L.circle([z.centerLat, z.centerLng], {
      ...opts,
      radius: z.radiusM,
    });
  } else if (z.shape === "ellipse") {
    layer = L.polygon(plmZoneEllipseRingLatLngs(z), opts);
  } else {
    layer = L.polygon(plmZoneCornerTuplesToLatLngs(z.corners), opts);
  }
  layer._plmZoneOwner = owner;
  layer.on("click", (e) => {
    if (personalLandmarkPlacementActive) return;
    L.DomEvent.stopPropagation(e);
    plmSelectZoneOwner(owner);
  });
  plmBindZoneLayerContextMenu(layer, owner);
  if (personalLandmarkPlacementActive && layer._path) {
    layer._path.style.pointerEvents = "none";
  }
  return layer;
}

/** Mode placement repère : la carte reçoit le clic (pas la sélection de zone). */
function plmSyncZonesPassThroughForLandmarkPlacement() {
  if (!personalZonesLayer) return;
  const passThrough = !!personalLandmarkPlacementActive;
  personalZonesLayer.eachLayer((layer) => {
    if (layer._path) {
      layer._path.style.pointerEvents = passThrough ? "none" : "";
    }
  });
}

function plmAddZoneLayerToGroup(zone, layerGroup, owner, selected) {
  const z = plmNormalizeZonePayload(zone);
  if (!z || !layerGroup) return null;
  const layer = plmCreateZoneMapLayer(z, owner, selected);
  layer.addTo(layerGroup);
  return layer;
}

function plmRedrawZonesLayer() {
  if (!personalZonesLayer) return;
  personalZonesLayer.clearLayers();
  plmClearZoneEditHandles();
  if (!plmZonesLayerVisible) {
    plmRefreshZoneLabels();
    return;
  }
  for (const row of personalZonesList) {
    const zone = plmZoneRowToPayload(row);
    if (!zone) continue;
    const owner = plmZoneRecordOwner(row.id);
    const selected = plmZoneOwnersEqual(plmSelectedZoneOwner, owner);
    plmAddZoneLayerToGroup(zone, personalZonesLayer, owner, selected);
  }
  if (plmSelectedZoneOwner && plmGetZoneForOwner(plmSelectedZoneOwner)) {
    plmRefreshZoneEditHandles();
  }
  plmRefreshZoneLabels();
  plmSyncZonesPassThroughForLandmarkPlacement();
}

function plmEnsureZonePreviewLayer() {
  if (!map) return null;
  if (!plmZonePreviewLayer) {
    plmZonePreviewLayer = L.layerGroup().addTo(map);
  }
  return plmZonePreviewLayer;
}

function plmClearZonePreviewLayer() {
  if (plmZonePreviewLayer) plmZonePreviewLayer.clearLayers();
}

function plmRefreshZonePreviewLayer(zoneDraft, zoneEnabled) {
  const layer = plmEnsureZonePreviewLayer();
  if (!layer) return;
  layer.clearLayers();
  if (!zoneEnabled) return;
  const z = plmNormalizeZonePayload(zoneDraft);
  if (z) plmAddZoneLayerToGroup(z, layer, null, false);
}

function plmZoneStatusLabel(zone) {
  const z = plmNormalizeZonePayload(zone);
  if (!z) return "Aucune géométrie : tracez sur la carte.";
  if (z.shape === "circle") {
    return `Cercle : rayon ${Math.round(z.radiusM)} m.`;
  }
  if (z.shape === "ellipse") {
    return `Ovale : ${Math.round(z.radiusMajorM)} × ${Math.round(z.radiusMinorM)} m.`;
  }
  const pts = plmZoneCornerTuplesToLatLngs(z.corners);
  const w = map ? Math.round(map.distance(pts[0], pts[1])) : 0;
  const h = map ? Math.round(map.distance(pts[1], pts[2])) : 0;
  const capNote = z.alignedToView ? " (aligné mode Cap)" : "";
  if (z.shape === "quadrilateral") {
    return `Quadrilatère tracé sur la carte.${capNote}`;
  }
  return `Rectangle : environ ${w} × ${h} m.${capNote}`;
}

function plmZoneDrawSetHint(text) {
  if (typeof setGpsStatus === "function") {
    setGpsStatus(String(text || ""));
  }
}

function plmStopZoneMapDraw(opts) {
  const o = opts || {};
  const session = plmZoneMapDrawSession;
  if (!session) return;
  plmZoneMapDrawSession = null;
  if (session.onKeydown) {
    document.removeEventListener("keydown", session.onKeydown);
  }
  if (session.previewShape) {
    try {
      session.previewShape.remove();
    } catch (e) {
      /* ignore */
    }
  }
  if (o.clearPreview) plmClearZonePreviewLayer();
  if (o.cancelled && typeof session.onCancel === "function") {
    session.onCancel();
  }
}

function plmInstallZoneMapDrawHandlers() {
  if (!map || map._tamPlmZoneDrawWired) return;
  map._tamPlmZoneDrawWired = true;
  map.on("click", plmOnMapClickZoneDraw);
  map.on("mousemove", plmOnMapMouseMoveZoneDraw);
}

function plmIsEditableTargetFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable
  );
}

function plmOnMapClickDeselectZone() {
  if (plmZoneMapDrawSession || personalLandmarkPlacementActive) return;
  if (plmEditorDialogDepth > 0 || plmZoneDialogDepth > 0) return;
  if (plmSelectedZoneOwner) plmClearZoneSelection();
}

function plmOnDocumentKeydownZone(ev) {
  if (ev.key === "Escape" && plmSelectedZoneOwner) {
    if (plmIsEditableTargetFocused()) return;
    if (plmZoneMapDrawSession || plmEditorDialogDepth > 0 || plmZoneDialogDepth > 0)
      return;
    plmClearZoneSelection();
    plmZoneDrawSetHint("");
  }
}

function plmInstallZoneSelectionHandlers() {
  if (!map || map._tamPlmZoneSelWired) return;
  map._tamPlmZoneSelWired = true;
  map.on("click", plmOnMapClickDeselectZone);
  document.addEventListener("keydown", plmOnDocumentKeydownZone);
}

function plmOnMapClickZoneDraw(ev) {
  const session = plmZoneMapDrawSession;
  if (!session || !ev?.latlng) return;
  L.DomEvent.stopPropagation(ev);
  const ll = ev.latlng;
  if (session.shape === "quadrilateral") {
    if (!session.points) session.points = [];
    session.points.push(ll);
    if (session.points.length < 4) {
      plmZoneDrawSetHint(
        `Zone — clic ${session.points.length + 1}/4 du quadrilatère. Échap : annuler.`,
      );
      return;
    }
    const zoneDraft = {
      enabled: true,
      shape: "quadrilateral",
      corners: plmZoneLatLngsToCornerTuples(session.points),
      alignedToView: false,
      strokeColor: session.strokeColor,
      strokeWeight: session.strokeWeight,
    };
    const normalized = plmNormalizeZonePayload(zoneDraft);
    if (!normalized) {
      tamAppAlert("Zone trop petite : recommencez le tracé sur la carte.");
      session.points = [];
      plmZoneDrawSetHint(plmZoneDrawHintForStep("quadrilateral", 0, false));
      return;
    }
    if (typeof session.onComplete === "function") {
      session.onComplete(normalized);
    }
    plmStopZoneMapDraw({ clearPreview: false });
    return;
  }
  if (session.step === 0) {
    session.p1 = ll;
    session.step = 1;
    plmZoneDrawSetHint(plmZoneDrawHintForStep(session.shape, 1, session.capView));
    return;
  }
  let zoneDraft = null;
  if (session.shape === "circle" || session.shape === "ellipse") {
    const radiusM = map.distance(session.p1, ll);
    if (session.shape === "ellipse") {
      zoneDraft = {
        enabled: true,
        shape: "ellipse",
        centerLat: session.p1.lat,
        centerLng: session.p1.lng,
        radiusMajorM: radiusM,
        radiusMinorM: radiusM,
        bearingDeg: 0,
        strokeColor: session.strokeColor,
        strokeWeight: session.strokeWeight,
      };
    } else {
      zoneDraft = {
        enabled: true,
        shape: "circle",
        centerLat: session.p1.lat,
        centerLng: session.p1.lng,
        radiusM,
        strokeColor: session.strokeColor,
        strokeWeight: session.strokeWeight,
      };
    }
  } else {
    const rect = plmZoneRectangleFromTwoLatLng(session.p1, ll);
    zoneDraft = {
      enabled: true,
      shape: "rectangle",
      corners: rect.corners,
      alignedToView: rect.alignedToView,
      strokeColor: session.strokeColor,
      strokeWeight: session.strokeWeight,
    };
  }
  const normalized = plmNormalizeZonePayload(zoneDraft);
  if (!normalized) {
    tamAppAlert("Zone trop petite : recommencez le tracé sur la carte.");
    if (session.previewShape) {
      try {
        session.previewShape.remove();
      } catch (e) {
        /* ignore */
      }
      session.previewShape = null;
    }
    session.step = 0;
    session.p1 = null;
    plmZoneDrawSetHint(
      plmZoneDrawHintForStep(session.shape, 0, session.capView),
    );
    return;
  }
  if (typeof session.onComplete === "function") {
    session.onComplete(normalized);
  }
  plmStopZoneMapDraw({ clearPreview: false });
}

function plmOnMapMouseMoveZoneDraw(ev) {
  const session = plmZoneMapDrawSession;
  if (!session || !ev?.latlng) return;
  if (session.previewShape) {
    try {
      session.previewShape.remove();
    } catch (e) {
      /* ignore */
    }
    session.previewShape = null;
  }
  const opts = plmZoneLayerOptions({
    strokeColor: session.strokeColor,
    strokeWeight: session.strokeWeight,
  });
  if (session.shape === "quadrilateral") {
    const pts = [...(session.points || [])];
    if (!pts.length) return;
    pts.push(ev.latlng);
    if (pts.length >= 2) {
      session.previewShape = L.polygon(pts, opts).addTo(map);
    }
    return;
  }
  if (session.step !== 1 || !session.p1) return;
  if (session.shape === "circle" || session.shape === "ellipse") {
    const radiusM = Math.max(
      PLM_ZONE_MIN_RADIUS_M,
      map.distance(session.p1, ev.latlng),
    );
    if (session.shape === "ellipse") {
      session.previewShape = L.polygon(
        plmZoneEllipseRingLatLngs({
          centerLat: session.p1.lat,
          centerLng: session.p1.lng,
          radiusMajorM: radiusM,
          radiusMinorM: radiusM,
          bearingDeg: 0,
        }),
        opts,
      ).addTo(map);
    } else {
      session.previewShape = L.circle(session.p1, {
        ...opts,
        radius: radiusM,
      }).addTo(map);
    }
  } else {
    const rect = plmZoneRectangleFromTwoLatLng(session.p1, ev.latlng);
    session.previewShape = L.polygon(
      plmZoneCornerTuplesToLatLngs(rect.corners),
      opts,
    ).addTo(map);
  }
}

function plmZoneDrawHintForStep(shape, step, capView) {
  if (shape === "quadrilateral") {
    return "Zone — 4 clics : les sommets du quadrilatère. Échap : annuler.";
  }
  if (shape === "circle") {
    return step === 0
      ? "Zone — 1er clic : centre du cercle. Échap : annuler."
      : "Zone — 2e clic : bord du cercle (rayon). Échap : annuler.";
  }
  if (shape === "ellipse") {
    return step === 0
      ? "Zone — 1er clic : centre de l’ovale. Échap : annuler."
      : "Zone — 2e clic : bord (rayon). Échap : annuler.";
  }
  if (capView) {
    return step === 0
      ? "Zone (mode Cap) — 1er clic : coin du rectangle à l’écran. Échap : annuler."
      : "Zone (mode Cap) — 2e clic : coin opposé à l’écran. Échap : annuler.";
  }
  return step === 0
    ? "Zone — 1er clic : premier coin du rectangle. Échap : annuler."
    : "Zone — 2e clic : coin opposé du rectangle. Échap : annuler.";
}

function plmStartZoneMapDraw(params) {
  plmInstallZoneMapDrawHandlers();
  plmStopZoneMapDraw({ clearPreview: false });
  const shape = plmNormalizeZoneShape(params.shape);
  const onKeydown = (ev) => {
    if (ev.key !== "Escape" || !plmZoneMapDrawSession) return;
    ev.preventDefault();
    ev.stopPropagation();
    plmStopZoneMapDraw({ clearPreview: true, cancelled: true });
  };
  document.addEventListener("keydown", onKeydown);
  const capView = shape === "rectangle" && plmMapUsesCapView();
  plmZoneDrawSetHint(plmZoneDrawHintForStep(shape, 0, capView));
  plmZoneMapDrawSession = {
    shape,
    capView,
    strokeColor: normalizePlmColorHex(params.strokeColor),
    strokeWeight: params.strokeWeight,
    step: 0,
    p1: null,
    points: shape === "quadrilateral" ? [] : null,
    previewShape: null,
    onComplete: params.onComplete,
    onCancel: params.onCancel,
    onKeydown,
  };
}

/** Réinitialise les hauteurs inline (le défilement est géré en CSS sur les panneaux internes). */
function plmSyncPersonalLandmarkDialogTabHeights(dlg) {
  const body = dlg?.querySelector("#appPersonalLandmarkDialogTabBody");
  if (!body) return;
  body.style.height = "";
  body.style.minHeight = "";
  body.style.maxHeight = "";
}

function plmActivatePersonalLandmarkDialogTab(dlg, tabId) {
  const tabs = [...dlg.querySelectorAll(".tam-plm-tabs__btn[data-plm-tab]")];
  const panels = [...dlg.querySelectorAll(".tam-plm-tab-panel[data-plm-tab-panel]")];
  for (const t of tabs) {
    const on = t.getAttribute("data-plm-tab") === tabId;
    t.setAttribute("aria-selected", on ? "true" : "false");
  }
  for (const p of panels) {
    const on = p.getAttribute("data-plm-tab-panel") === tabId;
    if (on) p.removeAttribute("hidden");
    else p.setAttribute("hidden", "");
  }
}

function getPlmIconCatalog() {
  if (
    typeof window !== "undefined" &&
    Array.isArray(window.TAM_PLM_ICONS) &&
    window.TAM_PLM_ICONS.length
  ) {
    return window.TAM_PLM_ICONS;
  }
  return [{ id: "pin", label: "Repère épingle", material: "place" }];
}

function plmMaterialLigature(def) {
  const m = def?.material;
  if (typeof m === "string" && /^[a-z0-9_]+$/.test(m)) return m;
  return "place";
}

function plmIconLetter(def) {
  const letter = String(def?.letter ?? "").trim();
  return /^[A-Za-z]$/.test(letter) ? letter.toUpperCase() : "";
}

function plmIconInnerHtml(def, mapMarker) {
  const letter = plmIconLetter(def);
  if (letter) {
    const cls = mapMarker
      ? "tam-plm-letter tam-plm-letter--map-marker"
      : "tam-plm-letter";
    return `<span class="${cls}" aria-hidden="true">${letter}</span>`;
  }
  const lig = plmMaterialLigature(def);
  const miCls = mapMarker
    ? "material-icons tam-plm-mi tam-plm-mi--map-marker"
    : "material-icons tam-plm-mi";
  return `<i class="${miCls}" aria-hidden="true">${lig}</i>`;
}

function getPlmColorCatalog() {
  if (
    typeof window !== "undefined" &&
    Array.isArray(window.TAM_PLM_COLORS) &&
    window.TAM_PLM_COLORS.length
  ) {
    return window.TAM_PLM_COLORS;
  }
  return [
    { hex: "#005ca9", label: "Bleu TAM" },
    { hex: "#c62828", label: "Rouge" },
  ];
}

/** Style inline pastille titre (fond + texte contrasté). */
function tamPlmTitlePillColorInlineStyle(bgHex) {
  const bg = normalizePlmColorHex(bgHex);
  const fg = plmContrastIconOnBackground(bg);
  return `background-color:${bg};color:${fg};border:1px solid rgba(0,0,0,0.12)`;
}

if (typeof window !== "undefined") {
  window.getPlmColorCatalog = getPlmColorCatalog;
  window.tamPlmTitlePillColorInlineStyle = tamPlmTitlePillColorInlineStyle;
}

function normalizePlmColorHex(raw) {
  const t = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  return PLM_DEFAULT_COLOR_NEW;
}

/** Couleur titre repère (optionnelle — vide = pastille grise par défaut). */
function normalizePlmTitleColorHex(raw) {
  const t = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  return "";
}

function normalizePlmIconId(raw) {
  const id = String(raw ?? "").trim();
  if (getPlmIconCatalog().some((x) => x.id === id)) return id;
  return PLM_DEFAULT_ICON_ID;
}

/** Nombre max d’icônes mémorisées pour la zone « récemment utilisées » (ordre MRU). */
const PLM_RECENT_MAX_STORE = 48;

function loadPlmIconRecentIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_PLM_ICON_RECENT) || "[]");
    if (!Array.isArray(raw)) return [];
    const icons = getPlmIconCatalog();
    const allowed = new Set(icons.map((x) => x.id));
    const seen = new Set();
    const out = [];
    for (const x of raw) {
      const tid = String(x ?? "").trim();
      if (!allowed.has(tid)) continue;
      if (seen.has(tid)) continue;
      seen.add(tid);
      out.push(tid);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function savePlmIconRecentIds(list) {
  try {
    localStorage.setItem(
      LS_KEY_PLM_ICON_RECENT,
      JSON.stringify(list.slice(0, PLM_RECENT_MAX_STORE)),
    );
  } catch (e) {
    // ignore
  }
}

/** À chaque enregistrement d’un repère : l’icône choisie remonte en tête de la liste MRU. */
function touchPlmIconRecent(iconId) {
  const id = normalizePlmIconId(iconId);
  const list = loadPlmIconRecentIds().filter((x) => x !== id);
  list.unshift(id);
  savePlmIconRecentIds(list);
}

function getPlmFavoritesCap() {
  const n = parseInt(
    String(localStorage.getItem(LS_KEY_PERSONAL_LANDMARK_FAVORITES_CAP) || ""),
    10,
  );
  if (Number.isFinite(n) && n >= 4 && n <= 20) return n;
  return 8;
}

function savePlmFavoritesCap(n) {
  const v = Math.max(4, Math.min(20, Math.round(Number(n)) || 8));
  try {
    localStorage.setItem(LS_KEY_PERSONAL_LANDMARK_FAVORITES_CAP, String(v));
  } catch (e) {
    // ignore
  }
  return v;
}

function getPlmCapFilterBandM() {
  const n = parseInt(
    String(localStorage.getItem(LS_KEY_PLM_CAP_FILTER_BAND_M) || ""),
    10,
  );
  if (
    Number.isFinite(n) &&
    n >= PLM_CAP_FILTER_BAND_MIN_M &&
    n <= PLM_CAP_FILTER_BAND_MAX_M
  ) {
    return n;
  }
  return PLM_CAP_FILTER_BAND_DEFAULT_M;
}

function savePlmCapFilterBandM(n) {
  const v = Math.max(
    PLM_CAP_FILTER_BAND_MIN_M,
    Math.min(
      PLM_CAP_FILTER_BAND_MAX_M,
      Math.round(Number(n)) || PLM_CAP_FILTER_BAND_DEFAULT_M,
    ),
  );
  try {
    localStorage.setItem(LS_KEY_PLM_CAP_FILTER_BAND_M, String(v));
  } catch (e) {
    // ignore
  }
  return v;
}

const TAM_BACKUP_FILENAME = "tam_sauvegarde_simulateur.json";
const TAM_BACKUP_PICKER_TYPES = [
  {
    description: "Sauvegarde simulateur TAM",
    accept: { "application/json": [".json"] },
  },
];
/** Copie locale (localStorage) : secours si l’écriture fichier n’est pas possible. */
const LS_KEY_BACKUP_MIRROR = "tam_sauvegarde_simulateur_mirror_v1";
const LS_KEY_BACKUP_SECOURS_MIRROR = "tam_sauvegarde_simulateur_secours_mirror_v1";
const LS_KEY_LAST_SECOURS_AT = "tam_backup_secours_last_at_v1";
const TAM_BACKUP_SECOURS_FILENAME = "tam_sauvegarde_simulateur_secours.json";
const TAM_SECOURS_BACKUP_INTERVAL_MS = 60 * 60 * 1000;

const TAM_SIMULATOR_URL_HINT =
  "http://127.0.0.1:8000/simulateur_sae.html";
const TAM_BACKUP_SERVER_URL = "/api/tam/backup";
const TAM_BACKUP_SERVER_STATUS_URL = "/api/tam/backup/status";
const TAM_BACKUP_SECOURS_SERVER_URL = "/api/tam/backup/secours";
const LS_KEY_USE_SERVER_BACKUP = "tam_use_server_backup_v1";
let tamServerBackupProbeCache = null;

function tamIsLocalDevHost() {
  const h = window.location.hostname;
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

function tamBackupFileApiAvailable() {
  if (!window.isSecureContext) return false;
  return (
    typeof window.showSaveFilePicker === "function" ||
    typeof window.showOpenFilePicker === "function"
  );
}

function tamServerBackupEnabled() {
  try {
    return localStorage.getItem(LS_KEY_USE_SERVER_BACKUP) === "1";
  } catch (e) {
    return false;
  }
}

function tamSetServerBackupEnabled(on) {
  try {
    if (on) localStorage.setItem(LS_KEY_USE_SERVER_BACKUP, "1");
    else localStorage.removeItem(LS_KEY_USE_SERVER_BACKUP);
  } catch (e) {
    // ignore
  }
}

async function tamProbeServerBackup(force) {
  const now = Date.now();
  if (!tamIsLocalDevHost()) {
    tamServerBackupProbeCache = { at: now, ok: false };
    return false;
  }
  if (
    !force &&
    tamServerBackupProbeCache &&
    now - tamServerBackupProbeCache.at < 15000
  ) {
    return tamServerBackupProbeCache.ok;
  }
  try {
    const r = await fetch(TAM_BACKUP_SERVER_STATUS_URL, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const ct = r.headers.get("content-type") || "";
    const ok = r.ok && ct.includes("application/json");
    tamServerBackupProbeCache = { at: now, ok };
    return ok;
  } catch (e) {
    tamServerBackupProbeCache = { at: now, ok: false };
    return false;
  }
}

async function tamWriteBackupViaServer(pretty) {
  try {
    const r = await fetch(TAM_BACKUP_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: pretty,
    });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json");
  } catch (e) {
    return false;
  }
}

async function tamWriteSecoursBackupViaServer(pretty) {
  try {
    const r = await fetch(TAM_BACKUP_SECOURS_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: pretty,
    });
    if (!r.ok) return { ok: false, status: r.status };
    const ct = r.headers.get("content-type") || "";
    return {
      ok: ct.includes("application/json"),
      status: r.status,
    };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

function tamSecoursBackupDue() {
  try {
    const last = Number(localStorage.getItem(LS_KEY_LAST_SECOURS_AT) || 0);
    return !last || Date.now() - last >= TAM_SECOURS_BACKUP_INTERVAL_MS;
  } catch (e) {
    return true;
  }
}

async function tamMaybeSecoursBackup(pretty) {
  if (!tamSecoursBackupDue()) return false;
  if (tamServerBackupEnabled() && tamIsLocalDevHost()) {
    const wr = await tamWriteSecoursBackupViaServer(pretty);
    if (!wr.ok) return false;
  }
  try {
    localStorage.setItem(LS_KEY_BACKUP_SECOURS_MIRROR, pretty);
    localStorage.setItem(LS_KEY_LAST_SECOURS_AT, String(Date.now()));
  } catch (e) {
    return false;
  }
  return true;
}

function tamBackupServerMissingMessage(httpStatus) {
  if (httpStatus === 404) {
    return (
      "Le serveur ne connaît pas l’API de sauvegarde (erreur 404).\n\n" +
      "Vous utilisez sans doute « python -m http.server ».\n" +
      "Arrêtez-le, puis lancez à la racine du projet :\n\n" +
      "python serve_tam.py\n\n" +
      "Rechargez http://127.0.0.1:8000/simulateur_sae.html"
    );
  }
  return (
    "Écriture sur disque impossible (serveur HTTP " +
    (httpStatus || "?") +
    ").\n\nLancez python serve_tam.py puis rechargez la page."
  );
}

function tamSecoursBackupAvailableLocally() {
  try {
    return !!localStorage.getItem(LS_KEY_BACKUP_SECOURS_MIRROR);
  } catch (e) {
    return false;
  }
}

async function tamRestoreSecoursBackup() {
  if (tamServerBackupEnabled() && tamIsLocalDevHost()) {
    try {
      const r = await fetch(TAM_BACKUP_SECOURS_SERVER_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("application/json")) {
        tamAutoBackupLastJson = "";
        tamApplyBackupFromObject(await r.json(), {
          skipFileBackup: true,
          replaceMissingKeys: true,
        });
        return;
      }
    } catch (e) {
      // fallback miroir
    }
  }
  const raw = localStorage.getItem(LS_KEY_BACKUP_SECOURS_MIRROR);
  if (!raw) {
    tamAppAlert("Aucune sauvegarde de secours disponible pour l’instant.");
    return;
  }
  tamAutoBackupLastJson = "";
  tamApplyBackupFromObject(JSON.parse(raw), {
    skipFileBackup: true,
    replaceMissingKeys: true,
  });
}

/** Active l’écriture via serve_tam.py sur PC (127.0.0.1), sans exiger le cloud. */
async function tamEnsureServerBackupForLocalDev() {
  if (!tamIsLocalDevHost()) return;
  if (tamServerBackupEnabled()) return;
  if (!(await tamProbeServerBackup(true))) return;
  tamSetServerBackupEnabled(true);
  tamAutoBackupLastJson = "";
  await tamDoAutoBackup();
}

async function tamEnsureServerBackupForMaster() {
  if (
    typeof tamCloudIsMasterSessionActive !== "function" ||
    !tamCloudIsMasterSessionActive()
  ) {
    return;
  }
  if (tamServerBackupEnabled() || !tamIsLocalDevHost()) return;
  tamSetServerBackupEnabled(true);
  tamAutoBackupLastJson = "";
  await tamDoAutoBackup();
}

async function tamEnsureServerBackupOnStartup() {
  await tamEnsureServerBackupForLocalDev();
  await tamEnsureServerBackupForMaster();
}

window.tamEnsureServerBackupForLocalDev = tamEnsureServerBackupForLocalDev;
window.tamEnsureServerBackupForMaster = tamEnsureServerBackupForMaster;
window.tamEnsureServerBackupOnStartup = tamEnsureServerBackupOnStartup;

function tamRefreshGearPopover() {
  const masterSec = document.getElementById("tamMasterBackupSection");
  const isMaster =
    typeof tamCloudIsMasterSessionActive === "function" &&
    tamCloudIsMasterSessionActive();
  if (masterSec) masterSec.hidden = !isMaster;
}
window.tamRefreshGearPopover = tamRefreshGearPopover;

async function tamPickBackupFileHandleViaPicker() {
  if (typeof window.showOpenFilePicker === "function") {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: TAM_BACKUP_PICKER_TYPES,
    });
    return handles[0];
  }
  return window.showSaveFilePicker({
    suggestedName: TAM_BACKUP_FILENAME,
    types: TAM_BACKUP_PICKER_TYPES,
  });
}
const TAM_BACKUP_ALL_KEYS = [
  LS_KEY_PERSONAL_LANDMARKS,
  LS_KEY_PERSONAL_ZONES,
  LS_KEY_PLM_LANDMARKS_LAYER_VISIBLE,
  LS_KEY_PLM_ZONES_LAYER_VISIBLE,
  LS_KEY_PLM_GROUPS,
  LS_KEY_PLM_ICON_RECENT,
  LS_KEY_PERSONAL_LANDMARK_FAVORITES_CAP,
  LS_KEY_PLM_CAP_FILTER_BAND_M,
  LS_KEY_DEVIATIONS,
  LS_KEY_OPS_LOG,
  LS_KEY_VOICE,
  LS_KEY_MODE,
  LS_KEY_ENABLED,
  LS_KEY_HEADING,
  LS_KEY_RECAP,
  LS_KEY_DRIVE_MODE,
  LS_KEY_PLM_ZONE_VOICE_ANNOUNCE,
  "tam_plm_structured_text_config_v1",
];
let tamAutoBackupTimer = 0;
let tamAutoBackupLastJson = "";
let tamCachedFileHandle = null;
let tamHandleReady = false;

const TAM_IDB_NAME = "tam-simulateur-backup";
const TAM_IDB_STORE = "meta";
const TAM_IDB_HANDLE_KEY = "fileHandle";

function tamOpenIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TAM_IDB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(TAM_IDB_STORE)) {
        db.createObjectStore(TAM_IDB_STORE);
      }
    };
  });
}

async function tamGetStoredHandle() {
  try {
    const db = await tamOpenIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TAM_IDB_STORE, "readonly");
      const req = tx.objectStore(TAM_IDB_STORE).get(TAM_IDB_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function tamSetStoredHandle(handle) {
  try {
    const db = await tamOpenIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TAM_IDB_STORE, "readwrite");
      tx.objectStore(TAM_IDB_STORE).put(handle, TAM_IDB_HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // silencieux
  }
}

async function tamWriteToHandle(handle, text) {
  let perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm !== "granted") {
    perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return false;
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

function tamPersistBackupMirror(jsonString) {
  try {
    localStorage.setItem(LS_KEY_BACKUP_MIRROR, jsonString);
  } catch (e) {
    // ignore
  }
}

/** Export manuel vers le dossier Téléchargements (une fois, à la demande). */
function tamDownloadBackupFile(jsonString) {
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = TAM_BACKUP_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function tamCollectBackupPayload() {
  const payload = {};
  for (const key of TAM_BACKUP_ALL_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) payload[key] = JSON.parse(raw);
    } catch (e) {
      const raw = localStorage.getItem(key);
      if (raw != null) payload[key] = raw;
    }
  }
  payload._meta = {
    version: 2,
    date: new Date().toISOString(),
    landmarks: personalLandmarksList.length,
    zones: personalZonesList.length,
  };
  return payload;
}

(async function tamRecoverHandleFromIdb() {
  try {
    const h = await tamGetStoredHandle();
    if (h) tamCachedFileHandle = h;
  } catch (e) {
    // silencieux
  } finally {
    tamHandleReady = true;
  }
})();

function tamApplyBackupFromObject(backup, opts) {
  const o = opts || {};
  if (!backup || typeof backup !== "object") throw new Error("format");
  const replaceMissing = !!o.replaceMissingKeys;
  for (const key of TAM_BACKUP_ALL_KEYS) {
    const has = Object.prototype.hasOwnProperty.call(backup, key);
    if (has && backup[key] != null) {
      localStorage.setItem(key, JSON.stringify(backup[key]));
    } else if (has && backup[key] == null) {
      localStorage.removeItem(key);
    } else if (replaceMissing) {
      localStorage.removeItem(key);
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(backup, LS_KEY_PERSONAL_LANDMARKS) &&
    !Object.prototype.hasOwnProperty.call(backup, LS_KEY_PLM_GROUPS)
  ) {
    localStorage.removeItem(LS_KEY_PLM_GROUPS);
  }
  loadPlmGroupsFromStorage();
  loadPersonalLandmarksFromStorage();
  loadPersonalZonesFromStorage();
  if (typeof plmApplyMapLayersVisibilityFromPrefs === "function") {
    plmApplyMapLayersVisibilityFromPrefs();
  }
  if (plmSanitizeParentLinks()) {
    savePersonalLandmarksToStorage(true);
  }
  const landmarkCount = personalLandmarksList.length;
  const zoneCount = personalZonesList.length;
  redrawPersonalLandmarksLayer();
  plmRedrawZonesLayer();
  if (typeof plmRefreshZoneLabels === "function") plmRefreshZoneLabels();
  if (typeof plmSyncZoneVoiceAnnounceCheckboxes === "function") {
    plmSyncZoneVoiceAnnounceCheckboxes();
  }
  if (!o.skipFileBackup && typeof plmScheduleAutoBackup === "function") {
    plmScheduleAutoBackup({ skipCloudPush: true });
  }
  if (!o.silent) {
    tamAppAlert(
      `Restauration terminée : ${landmarkCount} repère(s), ${zoneCount} zone(s), déviations et réglages rechargés.`,
    );
  }
  if (o.statusMessage && typeof setGpsStatus === "function") {
    setGpsStatus(o.statusMessage);
  } else if (!o.silent && typeof setGpsStatus === "function") {
    setGpsStatus("Sauvegarde restaurée.");
  }
  return { landmarkCount, zoneCount };
}

function tamImportBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      tamAutoBackupLastJson = "";
      tamApplyBackupFromObject(JSON.parse(reader.result), {
        skipFileBackup: true,
        replaceMissingKeys: true,
      });
    } catch (e) {
      tamAppAlert(
        "Impossible de lire le fichier de sauvegarde. Vérifiez qu'il s'agit bien du fichier « " +
        TAM_BACKUP_FILENAME +
        " ».",
      );
    }
  };
  reader.readAsText(file);
}

async function tamDoAutoBackup() {
  try {
    const payload = tamCollectBackupPayload();
    const json = JSON.stringify(payload);
    const pretty = JSON.stringify(payload, null, 2);
    const unchanged = json === tamAutoBackupLastJson;

    if (!unchanged) {
      tamAutoBackupLastJson = json;
      tamPersistBackupMirror(pretty);

      if (tamCachedFileHandle) {
        try {
          if (await tamWriteToHandle(tamCachedFileHandle, pretty)) {
            await tamMaybeSecoursBackup(pretty);
            return;
          }
        } catch (e) {
          tamCachedFileHandle = null;
        }
      }
      if (tamServerBackupEnabled() && tamIsLocalDevHost()) {
        if (await tamWriteBackupViaServer(pretty)) {
          await tamMaybeSecoursBackup(pretty);
          return;
        }
      }
    }

    await tamMaybeSecoursBackup(pretty);
  } catch (e) {
    // silencieux
  }
}

async function tamPickBackupFileHandle() {
  if (tamBackupFileApiAvailable()) {
    try {
      const picked = await tamPickBackupFileHandleViaPicker();
      tamCachedFileHandle = picked;
      await tamSetStoredHandle(picked);
      tamAutoBackupLastJson = "";
      await tamDoAutoBackup();
      tamAppAlert(
        "Fichier de sauvegarde lié. Les prochaines sauvegardes automatiques écraseront ce fichier.",
      );
      return true;
    } catch (e) {
      return false;
    }
  }
  return tamEnsureServerBackupForMaster();
}
window.tamPickBackupFileHandle = tamPickBackupFileHandle;

async function tamRestoreBackupFromServer() {
  try {
    const r = await fetch(TAM_BACKUP_SERVER_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      throw new Error("not_api");
    }
    if (r.status === 404) {
      tamAppAlert(
        "Aucun fichier tam_sauvegarde_simulateur.json à la racine du projet pour l’instant.",
      );
      return;
    }
    if (!r.ok) throw new Error("fetch");
    tamAutoBackupLastJson = "";
    tamApplyBackupFromObject(await r.json(), {
      skipFileBackup: true,
      replaceMissingKeys: true,
    });
  } catch (e) {
    tamAppAlert(
      "Impossible de lire la sauvegarde sur le serveur. Lancez python serve_tam.py puis rechargez la page.",
    );
  }
}
window.tamRestoreBackupFromServer = tamRestoreBackupFromServer;

function tamRestoreBackupMirror() {
  try {
    const raw = localStorage.getItem(LS_KEY_BACKUP_MIRROR);
    if (!raw) {
      tamAppAlert(
        "Aucune copie locale automatique dans ce navigateur pour l’instant.",
      );
      return;
    }
    tamAutoBackupLastJson = "";
    tamApplyBackupFromObject(JSON.parse(raw), {
      skipFileBackup: true,
      replaceMissingKeys: true,
    });
  } catch (e) {
    tamAppAlert("Impossible de lire la copie locale automatique.");
  }
}
window.tamRestoreBackupMirror = tamRestoreBackupMirror;

async function tamFetchServerBackupStatus() {
  try {
    const r = await fetch(TAM_BACKUP_SERVER_STATUS_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.includes("application/json")) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

/**
 * Restaurer (maître) : secours horaire, fichier projet, ou .json au choix.
 */
async function tamRestoreBackupPrimary() {
  if (tamSecoursBackupAvailableLocally()) {
    const useSecours = await showAppConfirmDialog(
      TAM_APP_DIALOG_TITLE,
      "Restaurer la sauvegarde de secours (environ la dernière heure de travail) ?\n\nOui = secours\nNon = autre fichier ou copie courante",
    );
    if (useSecours) {
      await tamRestoreSecoursBackup();
      return;
    }
  }
  if (tamServerBackupEnabled()) {
    const st = await tamFetchServerBackupStatus();
    if (st?.has_backup) {
      const useMain = await showAppConfirmDialog(
        TAM_APP_DIALOG_TITLE,
        "Restaurer la sauvegarde courante du projet (tam_sauvegarde_simulateur.json) ?\n\nOui = fichier courant\nNon = choisir un autre fichier .json",
      );
      if (useMain) {
        await tamRestoreBackupFromServer();
        return;
      }
    }
  }
  const fileInput = document.getElementById("appPlmBackupFileInput");
  if (fileInput) {
    fileInput.value = "";
    fileInput.click();
  }
}
window.tamRestoreBackupPrimary = tamRestoreBackupPrimary;

function tamExportBackupDownload() {
  try {
    const payload = tamCollectBackupPayload();
    tamDownloadBackupFile(JSON.stringify(payload, null, 2));
  } catch (e) {
    tamAppAlert("Impossible d’exporter la sauvegarde.");
  }
}
window.tamExportBackupDownload = tamExportBackupDownload;

/** Console / dépannage : sauvegarde principale immédiate (fichier si serve_tam.py). */
async function tamForceBackupNow() {
  if (!tamIsLocalDevHost()) {
    tamAppAlert("Disponible seulement en local (127.0.0.1:8000).");
    return { ok: false, reason: "not_local" };
  }
  if (!(await tamProbeServerBackup(true))) {
    tamAppAlert(tamBackupServerMissingMessage(404));
    return { ok: false, reason: "no_api", status: 404 };
  }
  if (!tamServerBackupEnabled()) tamSetServerBackupEnabled(true);
  tamAutoBackupLastJson = "";
  await tamDoAutoBackup();
  tamAppAlert(
    "Sauvegarde principale envoyée.\n\nVérifiez dans le dossier TaM : tam_sauvegarde_simulateur.json (date/heure récente).",
  );
  return { ok: true, file: TAM_BACKUP_FILENAME };
}

/** Console / dépannage : secours horaire tout de suite (ignore le délai d’1 h). */
async function tamForceSecoursBackupNow() {
  try {
    if (!tamIsLocalDevHost()) {
      tamAppAlert("Disponible seulement en local (127.0.0.1:8000).");
      return { ok: false, reason: "not_local" };
    }
    if (!(await tamProbeServerBackup(true))) {
      tamAppAlert(tamBackupServerMissingMessage(404));
      return { ok: false, reason: "no_api", status: 404 };
    }
    if (!tamServerBackupEnabled()) tamSetServerBackupEnabled(true);
    localStorage.removeItem(LS_KEY_LAST_SECOURS_AT);
    const pretty = JSON.stringify(tamCollectBackupPayload(), null, 2);
    const wr = await tamWriteSecoursBackupViaServer(pretty);
    if (!wr.ok) {
      tamAppAlert(tamBackupServerMissingMessage(wr.status));
      return { ok: false, reason: "write_failed", status: wr.status };
    }
    try {
      localStorage.setItem(LS_KEY_BACKUP_SECOURS_MIRROR, pretty);
      localStorage.setItem(LS_KEY_LAST_SECOURS_AT, String(Date.now()));
    } catch (e) {
      // ignore
    }
    tamAppAlert(
      "Secours OK.\n\nFichier : tam_sauvegarde_simulateur_secours.json à la racine du projet TaM.",
    );
    return { ok: true, file: TAM_BACKUP_SECOURS_FILENAME };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    tamAppAlert("Secours impossible : " + (msg || "erreur inconnue"));
    return { ok: false, reason: "error", detail: msg };
  }
}

window.tamForceBackupNow = tamForceBackupNow;
window.tamForceSecoursBackupNow = tamForceSecoursBackupNow;

function tamExportSecoursBackupDownload() {
  try {
    const raw = localStorage.getItem(LS_KEY_BACKUP_SECOURS_MIRROR);
    if (!raw) {
      tamAppAlert("Aucune sauvegarde de secours pour l’instant.");
      return;
    }
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = TAM_BACKUP_SECOURS_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    tamAppAlert("Impossible d’exporter la sauvegarde de secours.");
  }
}

let tamPickerPromise = null;

function plmScheduleAutoBackup(opts) {
  const backupOpts = opts || {};
  if (
    !tamCachedFileHandle &&
    !tamServerBackupEnabled() &&
    !tamPickerPromise &&
    tamHandleReady &&
    tamBackupFileApiAvailable()
  ) {
    tamPickerPromise = tamPickBackupFileHandleViaPicker()
      .then((picked) => {
        tamCachedFileHandle = picked;
        return tamSetStoredHandle(picked);
      })
      .catch(() => {})
      .finally(() => {
        tamPickerPromise = null;
      });
  }

  if (tamAutoBackupTimer) clearTimeout(tamAutoBackupTimer);
  tamAutoBackupTimer = setTimeout(() => {
    tamAutoBackupTimer = 0;
    const doIt = async () => {
      if (tamPickerPromise) await tamPickerPromise;
      await tamDoAutoBackup();
      if (
        !backupOpts.skipCloudPush &&
        typeof tamCloudSchedulePush === "function"
      ) {
        tamCloudSchedulePush();
      }
    };
    void doIt();
  }, 500);
}
window.plmScheduleAutoBackup = plmScheduleAutoBackup;

function closePlmLandmarkSettingsPopover() {
  const pop = document.getElementById("appPersonalLandmarkSettingsPopover");
  const btn = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
  if (pop) pop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function togglePlmLandmarkSettingsPopover() {
  const helpDlg = document.getElementById("appPersonalLandmarkHelpDialog");
  if (helpDlg && helpDlg.open) helpDlg.close();
  const pop = document.getElementById("appPersonalLandmarkSettingsPopover");
  const btn = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
  if (!pop || !btn) return;
  pop.hidden = !pop.hidden;
  btn.setAttribute("aria-expanded", pop.hidden ? "false" : "true");
}

function getPlmOrderedFavoriteIconIds(cap) {
  const icons = getPlmIconCatalog();
  const allowed = new Set(icons.map((x) => x.id));
  const recent = loadPlmIconRecentIds().filter((id) => allowed.has(id));
  const out = [];
  for (const id of recent) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  for (const { id } of icons) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, cap);
}

function plmEscapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&#39;");
}

/** Noir ou blanc pour le glyphe Material sur un fond `bgHex` (luminance relative sRGB). */
function plmContrastIconOnBackground(bgHex) {
  const raw = normalizePlmColorHex(bgHex);
  const hex = raw.slice(1);
  const r255 = parseInt(hex.slice(0, 2), 16);
  const g255 = parseInt(hex.slice(2, 4), 16);
  const b255 = parseInt(hex.slice(4, 6), 16);
  if (
    !Number.isFinite(r255) ||
    !Number.isFinite(g255) ||
    !Number.isFinite(b255)
  ) {
    return "#000000";
  }
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r255) + 0.7152 * lin(g255) + 0.0722 * lin(b255);
  return L > 0.52 ? "#000000" : "#ffffff";
}

function buildPlmMarkerBubbleHtml(item, centerPivot) {
  const iconId = normalizePlmIconId(item?.iconId);
  const bg = normalizePlmColorHex(item?.colorHex);
  const def =
    getPlmIconCatalog().find((x) => x.id === iconId) || getPlmIconCatalog()[0];
  const fg = plmContrastIconOnBackground(bg);
  const bgA = plmEscapeAttr(bg);
  const fgA = plmEscapeAttr(fg);
  const glyph = plmIconInnerHtml(def, true);
  const pivotCls = centerPivot
    ? " tam-personal-landmark-marker__bubble--group-pivot"
    : "";
  return `<div class="tam-personal-landmark-marker__bubble${pivotCls}"><div class="tam-plm-marker-chip" style="background-color:${bgA};color:${fgA};">${glyph}</div></div>`;
}

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
const burgerMenuBtn = document.getElementById("burgerMenuBtn");
const closeMenuBtn = document.getElementById("closeMenuBtn");
const missionTabBtn = document.getElementById("missionTabBtn");
const opsTabBtn = document.getElementById("opsTabBtn");
const helpTabBtn = document.getElementById("helpTabBtn");
const headerGearBtn = document.getElementById("headerGearBtn");
const headerGearPopover = document.getElementById("headerGearPopover");
/** Dernier onglet du menu pour rouvrir au même endroit (Ligne / Déviation / Aide). */
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
/** Dernière vitesse GPS (m/s), si fournie par l’appareil. */
let lastGpsSpeedMs = null;
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
  lastGpsSpeedMs = null;
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
  lastGpsSpeedMs =
    speedKnown && speedMs >= 0 ? speedMs : lastGpsSpeedMs;
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
  if (typeof refreshMapSpeedHud === "function") {
    refreshMapSpeedHud();
  }
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

/** Contrôles carte : fond plan/satellite puis repères (deux blocs = même écart qu’itinéraire). */
let tamBasemapExtrasControlsInstalled = false;
function tamInstallBasemapToggleControl() {
  if (tamBasemapExtrasControlsInstalled || typeof L === "undefined" || !map) return;

  const ctrlBasemap = L.control({ position: "topleft" });
  ctrlBasemap.onAdd = function onAddBasemapCtrl() {
    const wrap = L.DomUtil.create("div", "leaflet-bar tam-basemap-control");
    const a = L.DomUtil.create("a", "tam-basemap-toggle tam-basemap-toggle--preview-satellite", wrap);
    a.href = "#";
    a.setAttribute("role", "button");
    a.title = "Passer à la vue satellite";
    a.setAttribute("aria-label", "Passer à la vue satellite");
    L.DomUtil.create("span", "tam-basemap-toggle__thumb", a).setAttribute("aria-hidden", "true");
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
  ctrlBasemap.addTo(map);

  const ctrlPlm = L.control({ position: "topleft" });
  ctrlPlm.onAdd = function onAddPersonalLandmarksCtrl() {
    const wrap = L.DomUtil.create("div", "leaflet-bar tam-personal-landmarks-control");
    const aPlm = L.DomUtil.create("a", "tam-personal-landmarks-toggle", wrap);
    aPlm.href = "#";
    aPlm.setAttribute("role", "button");
    aPlm.title = "Repères personnels sur la carte";
    aPlm.setAttribute(
      "aria-label",
      "Repères personnels : activer le placement sur la carte ou toucher un repère existant pour le modifier.",
    );
    aPlm.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 2C8.7 2 6 4.5 6 7.6c0 3.1 4.2 10.9 5.5 13 .3.6 1.2.6 1.5 0C14.3 18.5 18 10.7 18 7.6 18 4.5 15.3 2 12 2zm0 9.2A2.4 2.4 0 0 1 9.6 9 2.4 2.4 0 0 1 12 6.6 2.4 2.4 0 0 1 14.4 9 2.4 2.4 0 0 1 12 11.2z"/>' +
      '<circle cx="18" cy="6" r="3.2" fill="#fff" stroke="currentColor" stroke-width="1.2"/>' +
      '<path stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M18 4.6v2.8M16.6 6h2.8"/>' +
      "</svg>";
    personalLandmarkPlacementToggleEl = aPlm;
    syncPersonalLandmarkPlacementToggleUi();
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.on(aPlm, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      setPersonalLandmarkPlacementActive(!personalLandmarkPlacementActive);
    });
    const aLabels = L.DomUtil.create("a", "tam-plm-labels-toggle", wrap);
    aLabels.href = "#";
    aLabels.setAttribute("role", "button");
    aLabels.title = "Afficher les libellés des repères (noms et descriptions)";
    aLabels.setAttribute(
      "aria-label",
      "Afficher les libellés des repères personnels sur la carte.",
    );
    aLabels.textContent = "Aa";
    personalLandmarkLabelsToggleEl = aLabels;
    syncPlmLabelsToggleUi();
    L.DomEvent.on(aLabels, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      setPlmLabelsVisible(!plmLabelsVisible);
    });
    const aLmLayer = L.DomUtil.create("a", "tam-plm-visibility-toggle", wrap);
    aLmLayer.href = "#";
    aLmLayer.setAttribute("role", "button");
    personalLandmarkLayerToggleEl = aLmLayer;
    plmWireLayerOnOffToggle(aLmLayer, {
      getVisible: () => plmLandmarksLayerVisible,
      setVisible: setPlmLandmarksLayerVisible,
      show: "Afficher les repères sur la carte",
      hide: "Masquer les repères sur la carte",
    });
    return wrap;
  };
  ctrlPlm.addTo(map);

  const ctrlZone = L.control({ position: "topleft" });
  ctrlZone.onAdd = function onAddPersonalZonesCtrl() {
    const wrap = L.DomUtil.create(
      "div",
      "leaflet-bar tam-personal-zones-control",
    );
    const aZone = L.DomUtil.create("a", "tam-personal-zones-toggle", wrap);
    aZone.href = "#";
    aZone.setAttribute("role", "button");
    aZone.title = "Nouvelle zone sur la carte";
    aZone.setAttribute(
      "aria-label",
      "Nouvelle zone : ouvrir la fenêtre de création. Clic droit sur une zone : modifier ou supprimer.",
    );
    aZone.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="4" y="6" width="16" height="12" fill="none" stroke="currentColor" stroke-width="2" rx="1"/>' +
      "</svg>";
    personalZoneToolToggleEl = aZone;
    L.DomEvent.on(aZone, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      setPersonalLandmarkPlacementActive(false);
      plmCloseZoneContextMenu();
      void openPersonalZoneDialog({ mode: "create" });
    });
    const aZoneLabels = L.DomUtil.create("a", "tam-plm-zone-labels-toggle", wrap);
    aZoneLabels.href = "#";
    aZoneLabels.setAttribute("role", "button");
    aZoneLabels.title = "Afficher les noms des zones";
    aZoneLabels.setAttribute(
      "aria-label",
      "Afficher les noms des zones au-dessus de chaque zone.",
    );
    aZoneLabels.textContent = "Aa";
    personalZoneLabelsToggleEl = aZoneLabels;
    syncPlmZoneLabelsToggleUi();
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.on(aZoneLabels, "click", (ev) => {
      L.DomEvent.preventDefault(ev);
      setPlmZoneLabelsVisible(!plmZoneLabelsVisible);
    });
    const aZoneLayer = L.DomUtil.create("a", "tam-plm-visibility-toggle", wrap);
    aZoneLayer.href = "#";
    aZoneLayer.setAttribute("role", "button");
    personalZoneLayerToggleEl = aZoneLayer;
    plmWireLayerOnOffToggle(aZoneLayer, {
      getVisible: () => plmZonesLayerVisible,
      setVisible: setPlmZonesLayerVisible,
      show: "Afficher les zones sur la carte",
      hide: "Masquer les zones sur la carte",
    });
    return wrap;
  };
  ctrlZone.addTo(map);

  if (typeof tamInstallTramNetworkOverviewControl === "function") {
    tamInstallTramNetworkOverviewControl();
  }

  tamBasemapExtrasControlsInstalled = true;
  if (typeof tamCloudApplyReaderUi === "function") tamCloudApplyReaderUi();
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
  opacity: 0.88,
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
/** Repères courts des autres lignes tram aux croisements (zones de manœuvre). */
const tamCrossingHintLayer = L.layerGroup().addTo(map);
const allStopsLayer = L.layerGroup().addTo(map);
const skippedStopsLayer = L.layerGroup().addTo(map);
const provisionalStopsLayer = L.layerGroup().addTo(map);
/** Libellé arrêt + correspondances (fenêtre d’approche, zoom max). */
const stopCorrespondenceLabelsLayer = L.layerGroup().addTo(map);
/** Repères personnels (carrefours, points d’intérêt) — persistance locale. */
const personalLandmarksLayer = L.layerGroup();
/** Zones carte (cercle / rectangle), indépendantes des repères. */
const personalZonesLayer = L.layerGroup();
/** Tracés tram réseau (vue carte d’accueil, indépendant des missions). */
const tramNetworkOverviewLayer = L.layerGroup();
const personalLandmarkLabelsLayer = L.layerGroup();
const personalZoneLabelsLayer = L.layerGroup();
const PLM_ZONE_DEFAULT_WEIGHT = 3;
const PLM_ZONE_MIN_RADIUS_M = 5;
let personalZonesList = [];
let plmZonePreviewLayer = null;
let plmZoneMapDrawSession = null;
/** { kind: 'zone', id: string } */
let plmSelectedZoneOwner = null;
let plmZoneDialogDepth = 0;
let personalZoneToolToggleEl = null;
let personalZoneLabelsToggleEl = null;
let personalLandmarkLayerToggleEl = null;
let personalZoneLayerToggleEl = null;
let plmLandmarksLayerVisible = false;
let plmZonesLayerVisible = true;
let plmZoneLabelsVisible = false;
let plmZoneEditHandlesLayer = null;
let plmContextMenuZoneId = null;
let plmZoneContextMenuWired = false;
let personalLandmarksList = [];
let personalLandmarkPlacementActive = false;
let personalLandmarkPlacementToggleEl = null;
let personalLandmarkLabelsToggleEl = null;
let plmLabelsVisible = false;
/** Libellé au survol (bouton texte désactivé) : même rendu que les libellés permanents. */
let plmHoverLabelLandmarkId = null;
let plmHoverLabelHideTimer = 0;
/** Modale repère ouverte : pas de recentrage caméra mission ni invalidateSize carte. */
let plmEditorDialogDepth = 0;
/** Après un glisser-déposer ou un appui long, ignorer le clic parasite qui ouvrirait l’éditeur. */
let plmSuppressLandmarkClickUntil = 0;
const PLM_LONG_PRESS_MS = 550;
let plmLongPressTimer = 0;
let plmContextMenuLandmarkId = null;
let plmContextMenuWired = false;
/** Déplacement le long du tracé (m) avant d’inverser le sens gauche/droite. */
const PLM_TRAVEL_SIGN_HYSTERESIS_M = 12;
/** +1 = sens départ→fin du tracé actif, -1 = retour. */
let plmPathTravelSign = 1;
let plmLastAlongForTravelSign = null;
let plmGroupCapFilterCache = new Map();
let plmCapFilterRefreshRaf = 0;
/** Au départ de mission (Cap) : montrer les repères proches des deux côtés pour les consignes. */
const PLM_DEPARTURE_PREVIEW_ALONG_M = 80;
let plmWasNearMissionDeparture = false;

function plmResetPathTravelSign() {
  plmPathTravelSign = 1;
  plmLastAlongForTravelSign = null;
  plmWasNearMissionDeparture = false;
  plmGroupCapFilterCache.clear();
  plmResetZoneMissionTracking();
}

function plmIsNearMissionDeparture() {
  if (!plmIsLiveMissionForLandmarkDisplay()) return false;
  const d = Number(distanceAlongPathMeters);
  if (!Number.isFinite(d)) return false;
  return d <= PLM_DEPARTURE_PREVIEW_ALONG_M;
}

function plmUpdateDepartureLandmarkFilter() {
  if (!plmIsCapSideFilterActive()) {
    plmWasNearMissionDeparture = false;
    return;
  }
  const near = plmIsNearMissionDeparture();
  if (near !== plmWasNearMissionDeparture) {
    plmWasNearMissionDeparture = near;
    plmScheduleLandmarkCapFilterRefresh();
  }
}

function getPlmZoneVoiceAnnounceEnabled() {
  return plmReadBoolPref(LS_KEY_PLM_ZONE_VOICE_ANNOUNCE, false);
}

function plmSyncZoneVoiceAnnounceCheckboxes() {
  const on = getPlmZoneVoiceAnnounceEnabled();
  const headerEl = document.getElementById("appPlmZoneVoiceAnnounce");
  if (headerEl) headerEl.checked = on;
}

function setPlmZoneVoiceAnnounceEnabled(on) {
  plmWriteBoolPref(LS_KEY_PLM_ZONE_VOICE_ANNOUNCE, !!on);
  plmSyncZoneVoiceAnnounceCheckboxes();
}

/** Mission + zoom serré : bandeau sous vitesse, pas de libellés globaux au-dessus des zones. */
function plmMapUsesMissionZoneHudMode() {
  if (!map || typeof map.getZoom !== "function") return false;
  const z = Math.floor(map.getZoom() + 1e-6);
  return z >= PLM_MAP_MAX_ZOOM - PLM_ZONE_MISSION_HUD_ZOOM_FROM_MAX;
}

function plmShouldShowGlobalZoneMapLabels() {
  if (!plmZoneLabelsVisible || !plmZonesLayerVisible) return false;
  if (plmIsLiveMissionForLandmarkDisplay() && plmMapUsesMissionZoneHudMode()) {
    return false;
  }
  return true;
}

function plmPointInPolygon(lat, lng, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const yi = corners[i][0];
    const xi = corners[i][1];
    const yj = corners[j][0];
    const xj = corners[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function plmPointInZone(lat, lng, zonePayload) {
  const z = zonePayload?.shape
    ? zonePayload
    : plmNormalizeZonePayload(zonePayload);
  if (!z || !plmIsValidPlmLatLng(lat, lng)) return false;
  if (z.shape === "circle") {
    return (
      L.latLng(z.centerLat, z.centerLng).distanceTo(L.latLng(lat, lng)) <=
      z.radiusM + 0.35
    );
  }
  if (z.shape === "ellipse") {
    const center = L.latLng(z.centerLat, z.centerLng);
    const pt = L.latLng(lat, lng);
    const distM = center.distanceTo(pt);
    const maxR = Math.max(z.radiusMajorM, z.radiusMinorM);
    if (distM > maxR + 0.5) return false;
    const dLat = ((pt.lat - center.lat) * Math.PI) / 180;
    const dLng = ((pt.lng - center.lng) * Math.PI) / 180;
    const latMid = ((center.lat + pt.lat) / 2) * (Math.PI / 180);
    const y = dLat * 6371000;
    const x = dLng * 6371000 * Math.cos(latMid);
    const br = (z.bearingDeg * Math.PI) / 180;
    const cos = Math.cos(br);
    const sin = Math.sin(br);
    const lx = x * cos + y * sin;
    const ly = -x * sin + y * cos;
    const a = Math.max(z.radiusMajorM, 1);
    const b = Math.max(z.radiusMinorM, 1);
    return (lx / a) ** 2 + (ly / b) ** 2 <= 1.02;
  }
  if (!z.corners?.length) return false;
  return plmPointInPolygon(lat, lng, z.corners);
}

function plmZoneVisibleOnMapScreen(zone) {
  if (!map || !zone) return false;
  const pts = plmZoneLatLngsFromShape(zone);
  if (!pts.length) return false;
  const view = map.getBounds();
  if (pts.some((ll) => view.contains(ll))) return true;
  try {
    return view.intersects(L.latLngBounds(pts));
  } catch (e) {
    return false;
  }
}

let plmZoneMissionLastAlong = null;
let plmZoneMissionInsideById = new Map();
let plmZoneMissionHudRaf = 0;

function plmResetZoneMissionTracking() {
  plmZoneMissionLastAlong = null;
  plmZoneMissionInsideById.clear();
  plmRefreshZoneMissionHud(true);
  plmRefreshZoneLabels();
}

function plmRefreshZoneMissionHud(forceHide) {
  const root = document.getElementById("mapZoneMissionHud");
  const panel = document.getElementById("mapZoneMissionHudPanel");
  if (!root || !panel) return;
  if (
    forceHide ||
    !plmIsLiveMissionForLandmarkDisplay() ||
    !plmMapUsesMissionZoneHudMode()
  ) {
    root.hidden = true;
    panel.textContent = "";
    return;
  }
  const names = [];
  const seen = new Set();
  for (const row of personalZonesList) {
    const name = String(row.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    const zone = plmZoneRowToPayload(row);
    if (!zone || !plmZoneVisibleOnMapScreen(zone)) continue;
    seen.add(name);
    names.push(name);
  }
  if (!names.length) {
    root.hidden = true;
    panel.textContent = "";
    return;
  }
  panel.textContent = names.join(" · ");
  root.hidden = false;
}

function plmScheduleZoneMissionHudRefresh() {
  if (plmZoneMissionHudRaf) cancelAnimationFrame(plmZoneMissionHudRaf);
  plmZoneMissionHudRaf = requestAnimationFrame(() => {
    plmZoneMissionHudRaf = 0;
    plmRefreshZoneMissionHud(false);
    if (plmZoneLabelsVisible) plmRefreshZoneLabels();
  });
}

function plmOnMissionPositionUpdate(alongM, lat, lng) {
  if (!plmIsLiveMissionForLandmarkDisplay()) {
    plmRefreshZoneMissionHud(true);
    return;
  }
  if (!Number.isFinite(alongM) || !plmIsValidPlmLatLng(lat, lng)) return;
  if (
    plmZoneMissionLastAlong != null &&
    alongM < plmZoneMissionLastAlong - PLM_ZONE_MISSION_BACKTRACK_RESET_M
  ) {
    plmZoneMissionInsideById.clear();
  }
  plmZoneMissionLastAlong = alongM;
  for (const row of personalZonesList) {
    const zoneId = String(row.id ?? "").trim();
    if (!zoneId) continue;
    const name = String(row.name ?? "").trim();
    const zone = plmZoneRowToPayload(row);
    if (!zone || !name) continue;
    const inside = plmPointInZone(lat, lng, zone);
    const hadPrior = plmZoneMissionInsideById.has(zoneId);
    const wasInside = !!plmZoneMissionInsideById.get(zoneId);
    if (hadPrior) {
      if (!wasInside && inside) {
        if (typeof speakPlmZoneBorderCross === "function") {
          speakPlmZoneBorderCross("enter", name);
        }
      } else if (wasInside && !inside) {
        if (typeof speakPlmZoneBorderCross === "function") {
          speakPlmZoneBorderCross("exit", name);
        }
      }
    }
    plmZoneMissionInsideById.set(zoneId, inside);
  }
  plmScheduleZoneMissionHudRefresh();
}

function plmNotifyAlongPathMeters(along) {
  if (!Number.isFinite(along)) return;
  plmUpdateDepartureLandmarkFilter();
  if (plmLastAlongForTravelSign == null) {
    plmLastAlongForTravelSign = along;
    plmScheduleLandmarkCapFilterRefresh();
    return;
  }
  const delta = along - plmLastAlongForTravelSign;
  if (Math.abs(delta) >= PLM_TRAVEL_SIGN_HYSTERESIS_M) {
    plmPathTravelSign = delta > 0 ? 1 : -1;
    plmLastAlongForTravelSign = along;
    plmScheduleLandmarkCapFilterRefresh();
  }
}

function plmScheduleLandmarkCapFilterRefresh() {
  if (!plmIsCapSideFilterActive()) return;
  if (plmCapFilterRefreshRaf) cancelAnimationFrame(plmCapFilterRefreshRaf);
  plmCapFilterRefreshRaf = requestAnimationFrame(() => {
    plmCapFilterRefreshRaf = 0;
    redrawPersonalLandmarksLayer();
  });
}

function plmIsLiveMissionForLandmarkDisplay() {
  return (
    !!currentPattern &&
    pathTotalMeters > 0 &&
    Array.isArray(activeCoordinates) &&
    activeCoordinates.length >= 2 &&
    !previewOnlyMode
  );
}

function plmIsCapSideFilterActive() {
  return plmIsLiveMissionForLandmarkDisplay() && !!headingUpEl?.checked;
}

function plmProjectLandmarkForCapFilter(item) {
  const disp = plmDisplayLatLngForLandmark(item);
  if (
    typeof projectLatLngOntoActivePathSigned !== "function" ||
    !plmIsValidPlmLatLng(disp.lat, disp.lng)
  ) {
    return { crossTrackMeters: Infinity, signedCrossTrackMeters: 0 };
  }
  return projectLatLngOntoActivePathSigned(disp.lat, disp.lng);
}

function plmIsGroupVisibleCapFilter(groupId) {
  if (plmGroupCapFilterCache.has(groupId)) {
    return plmGroupCapFilterCache.get(groupId);
  }
  let bestCross = Infinity;
  let bestSigned = 0;
  for (const mem of plmMembersOfGroup(groupId)) {
    const pr = plmProjectLandmarkForCapFilter(mem);
    if (pr.crossTrackMeters < bestCross) {
      bestCross = pr.crossTrackMeters;
      bestSigned = pr.signedCrossTrackMeters;
    }
  }
  const vis =
    bestCross <= getPlmCapFilterBandM() && bestSigned > 0;
  plmGroupCapFilterCache.set(groupId, vis);
  return vis;
}

/**
 * Affichage uniquement (stockage inchangé) :
 * mission en Nord = pas de repères ; en Cap = tous les repères (droite et gauche du tracé).
 */
function plmIsLandmarkVisibleOnMap(item) {
  if (plmIsLiveMissionForLandmarkDisplay() && !plmMapHeadingUpActive()) {
    return false;
  }
  return true;
}

function plmIsEditorDialogOpen() {
  return plmEditorDialogDepth > 0;
}

function plmClearLongPressTimer() {
  if (plmLongPressTimer) {
    clearTimeout(plmLongPressTimer);
    plmLongPressTimer = 0;
  }
}

function plmCloseLandmarkContextMenu() {
  const menu = document.getElementById("tamPlmContextMenu");
  if (menu) menu.hidden = true;
  plmContextMenuLandmarkId = null;
}

function plmScreenOffsetToLatLng(lat, lng, dxPx, dyPx) {
  const p = map.latLngToContainerPoint(L.latLng(lat, lng));
  return map.containerPointToLatLng(L.point(p.x + dxPx, p.y + dyPx));
}

function plmDuplicateLandmarkFromId(sourceId) {
  const src = personalLandmarksList.find((x) => x.id === sourceId);
  if (!src) return null;
  const dest = plmScreenOffsetToLatLng(src.lat, src.lng, PLM_DUPLICATE_OFFSET_PX, 0);
  if (!plmIsValidPlmLatLng(dest.lat, dest.lng)) return null;
  const row = {
    id: plmNewLandmarkId(),
    lat: dest.lat,
    lng: dest.lng,
    name: src.name,
    description: src.groupId ? "" : String(src.description ?? ""),
    iconId: normalizePlmIconId(src.iconId),
    colorHex: normalizePlmColorHex(src.colorHex),
  };
  const dupTitleColor = normalizePlmTitleColorHex(src.titleColorHex);
  if (dupTitleColor) row.titleColorHex = dupTitleColor;
  if (plmLandmarkHasIconBearing(src)) {
    row.iconBearingDeg = plmNormalizeBearingDeg(Number(src.iconBearingDeg));
  }
  personalLandmarksList.push(row);
  return row.id;
}

function plmDuplicateGroupFromId(sourceGroupId) {
  const members = plmMembersOfGroup(sourceGroupId);
  if (!members.length) return null;
  const newGroupId = plmGenerateGroupId();
  const desc = plmGetGroupDescription(sourceGroupId);
  if (desc) plmSetGroupDescription(newGroupId, desc);
  let srcZone = null;
  for (const m of plmMembersOfGroup(sourceGroupId)) {
    srcZone = plmGetZoneOnLandmarkRow(m);
    if (srcZone) break;
  }
  if (!srcZone) {
    srcZone = plmNormalizeZonePayload(plmGroupsById[sourceGroupId]?.zone);
  }
  const idMap = new Map();
  for (const mem of members) {
    const newId = plmNewLandmarkId();
    idMap.set(mem.id, newId);
    const dest = plmScreenOffsetToLatLng(mem.lat, mem.lng, PLM_DUPLICATE_OFFSET_PX, 0);
    const dupRow = {
      id: newId,
      lat: dest.lat,
      lng: dest.lng,
      name: mem.name,
      description: "",
      iconId: normalizePlmIconId(mem.iconId),
      colorHex: normalizePlmColorHex(mem.colorHex),
      groupId: newGroupId,
    };
    const memTitleColor = normalizePlmTitleColorHex(mem.titleColorHex);
    if (memTitleColor) dupRow.titleColorHex = memTitleColor;
    if (plmLandmarkHasIconBearing(mem)) {
      dupRow.iconBearingDeg = plmNormalizeBearingDeg(Number(mem.iconBearingDeg));
    }
    personalLandmarksList.push(dupRow);
  }
  for (const mem of members) {
    const newId = idMap.get(mem.id);
    if (!newId) continue;
    const idx = personalLandmarksList.findIndex((x) => x.id === newId);
    if (idx < 0) continue;
    const parentNew = mem.parentId ? idMap.get(mem.parentId) : null;
    if (parentNew && mem.slot) {
      const next = {
        ...personalLandmarksList[idx],
        parentId: parentNew,
        slot: mem.slot,
      };
      if (Number.isFinite(Number(mem.gridQx)) && Number.isFinite(Number(mem.gridQy))) {
        next.gridQx = mem.gridQx;
        next.gridQy = mem.gridQy;
      }
      personalLandmarksList[idx] = next;
    }
  }
  const refName =
    members.find((m) => String(m.name ?? "").trim())?.name || members[0].name;
  plmSyncGroupMemberNames(newGroupId, refName);
  if (plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForGroup(newGroupId);
  }
  if (srcZone) {
    personalZonesList.push({ id: plmNewZoneId(), ...srcZone });
    savePersonalZonesToStorage(true);
    plmRedrawZonesLayer();
  }
  return newGroupId;
}

function plmCloseZoneContextMenu() {
  const menu = document.getElementById("tamPlmZoneContextMenu");
  if (menu) menu.hidden = true;
  plmContextMenuZoneId = null;
}

function plmShowZoneContextMenu(clientX, clientY, zoneId) {
  if (
    typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
    tamCloudBlocksLandmarkZoneEdits()
  ) {
    return;
  }
  if (!personalZonesList.some((x) => x.id === zoneId)) return;
  plmInitZoneContextMenu();
  const menu = document.getElementById("tamPlmZoneContextMenu");
  if (!menu) return;
  plmCloseLandmarkContextMenu();
  plmContextMenuZoneId = zoneId;
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    let x = Number(clientX) || 0;
    let y = Number(clientY) || 0;
    if (x + rect.width > window.innerWidth - 8) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  });
}

function plmInitZoneContextMenu() {
  if (plmZoneContextMenuWired) return;
  const menu = document.getElementById("tamPlmZoneContextMenu");
  if (!menu) return;
  plmZoneContextMenuWired = true;
  menu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-plm-zone-ctx]");
    if (!btn || !plmContextMenuZoneId) return;
    ev.stopPropagation();
    const zoneId = plmContextMenuZoneId;
    const action = btn.getAttribute("data-plm-zone-ctx");
    plmCloseZoneContextMenu();
    if (action === "edit-zone") {
      void openPersonalZoneDialog({ mode: "edit", id: zoneId });
      return;
    }
    if (action === "del-zone") {
      void plmDeleteZoneFromContext(zoneId);
    }
  });
  document.addEventListener("click", (ev) => {
    if (menu.hidden) return;
    if (menu.contains(ev.target)) return;
    plmCloseZoneContextMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") plmCloseZoneContextMenu();
  });
  if (map) {
    map.on("click", () => plmCloseZoneContextMenu());
  }
}

async function plmDeleteZoneFromContext(zoneId) {
  const ok = await showAppConfirmDialog(
    TAM_APP_DIALOG_TITLE,
    "Supprimer cette zone sur la carte ?",
  );
  if (!ok) return;
  plmDeleteZoneForOwner(plmZoneRecordOwner(zoneId));
  plmClearZoneSelection();
  plmZoneDrawSetHint("Zone supprimée.");
}

async function plmDeleteLandmarkFromContext(landmarkId) {
  const ok = await showAppConfirmDialog(
    TAM_APP_DIALOG_TITLE,
    "Supprimer ce repère personnel ?",
  );
  if (!ok) return;
  const removed = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!removed) return;
  personalLandmarksList = personalLandmarksList.filter(
    (x) => x.id !== landmarkId,
  );
  plmRemoveGroupIfEmpty(removed.groupId);
  savePersonalLandmarksToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus("Repère personnel supprimé.");
}

async function plmDeleteGroupFromContext(groupId) {
  const members = plmMembersOfGroup(groupId);
  if (!members.length) return;
  const ok = await showAppConfirmDialog(
    TAM_APP_DIALOG_TITLE,
    "Supprimer tout le groupe de repères ?",
  );
  if (!ok) return;
  const ids = new Set(members.map((m) => m.id));
  personalLandmarksList = personalLandmarksList.filter((x) => !ids.has(x.id));
  delete plmGroupsById[groupId];
  savePlmGroupsToStorage();
  savePersonalLandmarksToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus("Groupe de repères supprimé.");
}

async function plmDetachLandmarkFromGroup(landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item?.groupId) return;
  const ok = await showAppConfirmDialog(
    TAM_APP_DIALOG_TITLE,
    "Détacher ce repère du groupe ? Il restera à sa position actuelle sur la carte.",
  );
  if (!ok) return;
  const idx = personalLandmarksList.findIndex((x) => x.id === landmarkId);
  if (idx < 0) return;
  const row = personalLandmarksList[idx];
  const groupId = row.groupId;
  const disp = plmDisplayLatLngForLandmark(row);
  const groupDesc = plmGetGroupDescription(groupId);
  const next = { ...row };
  if (plmIsValidPlmLatLng(disp.lat, disp.lng)) {
    next.lat = disp.lat;
    next.lng = disp.lng;
  }
  delete next.groupId;
  delete next.parentId;
  delete next.slot;
  delete next.gridQx;
  delete next.gridQy;
  if (groupDesc && !String(next.description ?? "").trim()) {
    next.description = groupDesc;
  }
  personalLandmarksList[idx] = next;
  for (let i = 0; i < personalLandmarksList.length; i++) {
    const child = personalLandmarksList[i];
    if (child.groupId !== groupId || child.parentId !== landmarkId) continue;
    const childNext = { ...child };
    delete childNext.parentId;
    delete childNext.slot;
    personalLandmarksList[i] = childNext;
  }
  if (plmMembersOfGroup(groupId).length > 0 && plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForGroup(groupId);
  }
  plmRemoveGroupIfEmpty(groupId);
  if (plmMapUsesMagneticLayout()) {
    plmBakeSoloLandmarksMagneticClusters();
  }
  savePersonalLandmarksToStorage();
  savePlmGroupsToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus("Repère détaché du groupe.");
}

function plmShowLandmarkContextMenu(clientX, clientY, landmarkId) {
  if (
    typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
    tamCloudBlocksLandmarkZoneEdits()
  ) {
    return;
  }
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item) return;
  plmClearLandmarkHoverLabel();
  plmInitLandmarkContextMenu();
  const menu = document.getElementById("tamPlmContextMenu");
  if (!menu) return;
  plmContextMenuLandmarkId = landmarkId;
  const dupGroupBtn = menu.querySelector('[data-plm-ctx="dup-group"]');
  if (dupGroupBtn) dupGroupBtn.hidden = !item.groupId;
  const detachGroupBtn = menu.querySelector('[data-plm-ctx="detach-group"]');
  if (detachGroupBtn) detachGroupBtn.hidden = !item.groupId;
  const mergeGroupBtn = menu.querySelector('[data-plm-ctx="merge-group"]');
  if (mergeGroupBtn) {
    mergeGroupBtn.hidden = !!item.groupId || !plmFindNearestGroupId(landmarkId);
  }
  const delGroupBtn = menu.querySelector('[data-plm-ctx="del-group"]');
  if (delGroupBtn) delGroupBtn.hidden = !item.groupId;
  const rotateBtn = menu.querySelector('[data-plm-ctx="rotate-landmark"]');
  if (rotateBtn) {
    rotateBtn.textContent = item.groupId
      ? "Rotation du groupe…"
      : "Rotation…";
  }
  menu.hidden = false;
  menu.style.left = "0px";
  menu.style.top = "0px";
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    let x = Number(clientX) || 0;
    let y = Number(clientY) || 0;
    if (x + rect.width > window.innerWidth - 8) {
      x = window.innerWidth - rect.width - 8;
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = window.innerHeight - rect.height - 8;
    }
    menu.style.left = `${Math.max(8, x)}px`;
    menu.style.top = `${Math.max(8, y)}px`;
  });
}

function plmInitLandmarkContextMenu() {
  if (plmContextMenuWired) return;
  const menu = document.getElementById("tamPlmContextMenu");
  if (!menu) return;
  plmContextMenuWired = true;
  menu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-plm-ctx]");
    if (!btn || !plmContextMenuLandmarkId) return;
    ev.stopPropagation();
    const id = plmContextMenuLandmarkId;
    const action = btn.getAttribute("data-plm-ctx");
    plmCloseLandmarkContextMenu();
    if (action === "dup-landmark") {
      if (!plmDuplicateLandmarkFromId(id)) return;
      savePersonalLandmarksToStorage();
      redrawPersonalLandmarksLayer();
      setGpsStatus(
        "Repère dupliqué : déplacez-le sur la carte si besoin.",
      );
      return;
    }
    if (action === "merge-group") {
      void openPlmMergeIntoGroupDialog(id);
      return;
    }
    if (action === "dup-group") {
      const item = personalLandmarksList.find((x) => x.id === id);
      if (!item?.groupId) return;
      if (!plmDuplicateGroupFromId(item.groupId)) return;
      savePersonalLandmarksToStorage();
      savePlmGroupsToStorage();
      redrawPersonalLandmarksLayer();
      setGpsStatus(
        "Groupe dupliqué : déplacez-le sur la carte si besoin.",
      );
      return;
    }
    if (action === "detach-group") {
      void plmDetachLandmarkFromGroup(id);
      return;
    }
    if (action === "rotate-landmark") {
      plmStartLandmarkRotation(id);
      return;
    }
    if (action === "clear-landmark") {
      void plmClearLandmarkContentFromContext(id);
      return;
    }
    if (action === "del-landmark") {
      void plmDeleteLandmarkFromContext(id);
      return;
    }
    if (action === "del-group") {
      const item = personalLandmarksList.find((x) => x.id === id);
      if (!item?.groupId) return;
      void plmDeleteGroupFromContext(item.groupId);
    }
  });
  document.addEventListener("click", (ev) => {
    if (menu.hidden) return;
    if (menu.contains(ev.target)) return;
    plmCloseLandmarkContextMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") plmCloseLandmarkContextMenu();
  });
  if (map) {
    map.on("click", () => plmCloseLandmarkContextMenu());
  }
}

function plmBindLandmarkContextMenu(marker, landmarkId) {
  marker.on("contextmenu", (e) => {
    L.DomEvent.stop(e);
    if (e.originalEvent) e.originalEvent.preventDefault();
    const ev = e.originalEvent || e;
    plmShowLandmarkContextMenu(ev.clientX, ev.clientY, landmarkId);
  });
  marker.on("touchstart", (e) => {
    if (!e.originalEvent || e.originalEvent.touches.length !== 1) return;
    plmClearLongPressTimer();
    if (marker.dragging) marker.dragging.disable();
    const touch = e.originalEvent.touches[0];
    plmLongPressTimer = setTimeout(() => {
      plmLongPressTimer = 0;
      plmSuppressLandmarkClickUntil = Date.now() + 800;
      plmShowLandmarkContextMenu(touch.clientX, touch.clientY, landmarkId);
    }, PLM_LONG_PRESS_MS);
  });
  marker.on("touchmove touchend touchcancel", () => {
    plmClearLongPressTimer();
    if (marker.dragging) marker.dragging.enable();
  });
}

function plmOnLandmarkOpenClick(e, landmarkId) {
  if (Date.now() < plmSuppressLandmarkClickUntil) {
    return;
  }
  if (e && typeof L.DomEvent.stop === "function") {
    L.DomEvent.stop(e);
  }
  void openPersonalLandmarkMarkerEditor(landmarkId);
}

/** Données d’affichage libellé (nom / description) ou null si rien à montrer. */
function plmResolveLandmarkLabelDisplay(landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item || !plmIsLandmarkVisibleOnMap(item)) return null;
  if (item.groupId) {
    const ref = plmLandmarkForGroupLabel(item.groupId);
    if (!ref) return null;
    if (!plmLandmarkHasMapLabelContent(ref)) return null;
    const html = plmBuildMapLabelHtml(ref);
    if (!html) return null;
    return {
      attach: ref,
      html,
      landmarkId: ref.id,
    };
  }
  if (!plmLandmarkHasMapLabelContent(item)) return null;
  const html = plmBuildMapLabelHtml(item);
  if (!html) return null;
  return {
    attach: item,
    html,
    landmarkId: item.id,
  };
}

function plmClearLandmarkHoverLabel() {
  if (plmHoverLabelHideTimer) {
    clearTimeout(plmHoverLabelHideTimer);
    plmHoverLabelHideTimer = 0;
  }
  plmHoverLabelLandmarkId = null;
  if (plmLabelsVisible) return;
  personalLandmarkLabelsLayer.clearLayers();
  if (map?.hasLayer(personalLandmarkLabelsLayer)) {
    map.removeLayer(personalLandmarkLabelsLayer);
  }
}

function plmScheduleClearLandmarkHoverLabel() {
  if (plmLabelsVisible) return;
  if (plmHoverLabelHideTimer) clearTimeout(plmHoverLabelHideTimer);
  plmHoverLabelHideTimer = setTimeout(() => {
    plmHoverLabelHideTimer = 0;
    plmClearLandmarkHoverLabel();
  }, 100);
}

function plmShowLandmarkHoverLabel(landmarkId) {
  if (plmLabelsVisible || !plmLandmarksLayerVisible) return;
  const spec = plmResolveLandmarkLabelDisplay(landmarkId);
  if (!spec) {
    plmClearLandmarkHoverLabel();
    return;
  }
  if (plmHoverLabelHideTimer) {
    clearTimeout(plmHoverLabelHideTimer);
    plmHoverLabelHideTimer = 0;
  }
  if (plmHoverLabelLandmarkId === spec.landmarkId) {
    return;
  }
  plmHoverLabelLandmarkId = spec.landmarkId;
  personalLandmarkLabelsLayer.clearLayers();
  if (!map.hasLayer(personalLandmarkLabelsLayer)) {
    personalLandmarkLabelsLayer.addTo(map);
  }
  plmAddMapLabelMarker(spec.attach, spec.html, spec.landmarkId, {
    hoverOnly: true,
  });
}

function plmBindLandmarkHoverLabel(marker, landmarkId) {
  marker.on("mouseover", () => {
    plmShowLandmarkHoverLabel(landmarkId);
  });
  marker.on("mouseout", () => {
    plmScheduleClearLandmarkHoverLabel();
  });
}

function plmAddMapLabelMarker(item, html, landmarkId, opts) {
  const o = opts || {};
  const attach = plmLandmarkLabelAttachItem(item) || item;
  if (!attach) return;
  const marker = plmMarkerById?.get(attach.id);
  const disp = plmDisplayLatLngForLandmark(attach);
  const lat = marker ? marker.getLatLng().lat : disp.lat;
  const lng = marker ? marker.getLatLng().lng : disp.lng;
  if (!plmIsValidPlmLatLng(lat, lng)) return;
  const icon = plmCreateMapLabelIcon(html, attach);
  const lm = L.marker([lat, lng], {
    icon,
    interactive: true,
    bubblingMouseEvents: false,
    zIndexOffset: 420,
    rotateWithView: plmMapHeadingUpActive(),
    rotation: plmLandmarkIconRotationRad(attach),
  });
  lm.__tamPlmLandmarkId = landmarkId;
  lm.on("mousedown touchstart", (e) => {
    L.DomEvent.stopPropagation(e);
  });
  lm.on("click", (e) => {
    plmOnLandmarkOpenClick(e, landmarkId);
  });
  plmBindLandmarkContextMenu(lm, landmarkId);
  if (o.hoverOnly) {
    lm.on("mouseover", () => {
      if (plmHoverLabelHideTimer) {
        clearTimeout(plmHoverLabelHideTimer);
        plmHoverLabelHideTimer = 0;
      }
      plmHoverLabelLandmarkId = landmarkId;
    });
    lm.on("mouseout", () => {
      plmScheduleClearLandmarkHoverLabel();
    });
  }
  lm.addTo(personalLandmarkLabelsLayer);
}

/** Si aucune MRU enregistrée : initialiser à partir des repères sur la carte (du plus récent au plus ancien). */
function seedPlmIconRecentFromLandmarksIfEmpty() {
  if (loadPlmIconRecentIds().length > 0) return;
  const seen = new Set();
  const list = [];
  for (let i = personalLandmarksList.length - 1; i >= 0; i--) {
    const id = normalizePlmIconId(personalLandmarksList[i]?.iconId);
    if (seen.has(id)) continue;
    seen.add(id);
    list.push(id);
  }
  if (list.length) savePlmIconRecentIds(list);
}

function loadPersonalLandmarksFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY_PERSONAL_LANDMARKS);
    if (!raw) {
      personalLandmarksList = [];
    } else {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        personalLandmarksList = [];
      } else {
        personalLandmarksList = parsed
          .map((x) => {
            const hadLegacyVisual =
              !Object.prototype.hasOwnProperty.call(x || {}, "colorHex") &&
              !Object.prototype.hasOwnProperty.call(x || {}, "iconId");
            const iconId = normalizePlmIconId(x?.iconId);
            let colorHex = normalizePlmColorHex(x?.colorHex);
            if (hadLegacyVisual) {
              colorHex = PLM_DEFAULT_COLOR_LEGACY;
            }
            const groupIdRaw = String(x?.groupId ?? "").trim();
            const parentIdRaw = String(x?.parentId ?? "").trim();
            const slotRaw = String(x?.slot ?? "").trim();
            const row = {
              id: String(x?.id || "").trim(),
              lat: Number(x?.lat),
              lng: Number(x?.lng),
              name: String(x?.name || "").trim(),
              description: String(x?.description ?? "").trim(),
              iconId,
              colorHex,
            };
            const titleColorHex = normalizePlmTitleColorHex(x?.titleColorHex);
            if (titleColorHex) row.titleColorHex = titleColorHex;
            if (groupIdRaw) row.groupId = groupIdRaw;
            if (parentIdRaw) row.parentId = parentIdRaw;
            if (slotRaw) row.slot = slotRaw;
            const gridQxRaw = Number(x?.gridQx);
            const gridQyRaw = Number(x?.gridQy);
            if (Number.isFinite(gridQxRaw) && Number.isFinite(gridQyRaw)) {
              row.gridQx = gridQxRaw;
              row.gridQy = gridQyRaw;
            }
            const iconBearingRaw = x?.iconBearingDeg;
            if (
              iconBearingRaw != null &&
              iconBearingRaw !== "" &&
              Number.isFinite(Number(iconBearingRaw))
            ) {
              row.iconBearingDeg = plmNormalizeBearingDeg(
                Number(iconBearingRaw),
              );
            }
            return row;
          })
          .filter(
            (x) =>
              x.id && Number.isFinite(x.lat) && Number.isFinite(x.lng),
          );
      }
    }
  } catch (e) {
    personalLandmarksList = [];
  }
  seedPlmIconRecentFromLandmarksIfEmpty();
}

function savePersonalLandmarksToStorage(skipFileBackup) {
  try {
    localStorage.setItem(
      LS_KEY_PERSONAL_LANDMARKS,
      JSON.stringify(personalLandmarksList),
    );
  } catch (e) {
    // ignore
  }
  if (!skipFileBackup) plmScheduleAutoBackup();
}

function makePersonalLandmarkDivIcon(item) {
  const inGroup = !!String(item?.groupId ?? "").trim();
  return L.divIcon({
    className: "tam-personal-landmark-marker",
    html: buildPlmMarkerBubbleHtml(item, inGroup),
    iconSize: [30, 30],
    iconAnchor: inGroup ? [15, 15] : [15, 30],
  });
}

function plmIsValidPlmLatLng(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

function plmOnMarkerDragEnd(m, landmarkId, wasGroupDrag) {
  if (wasGroupDrag) {
    const row = personalLandmarksList.find((x) => x.id === landmarkId);
    if (row?.groupId && plmMapUsesMagneticLayout()) {
      plmBakeGroupLatLngFromGrid(row.groupId);
    } else if (row?.groupId) {
      plmRefreshGroupGridOffsets(row.groupId, true);
    }
    savePersonalLandmarksToStorage();
    redrawPersonalLandmarksLayer();
    setGpsStatus("Groupe de repères déplacé.");
    return;
  }
  const ll = m.getLatLng();
  if (!plmIsValidPlmLatLng(ll.lat, ll.lng)) {
    redrawPersonalLandmarksLayer();
    return;
  }
  const idx = personalLandmarksList.findIndex((x) => x.id === landmarkId);
  if (idx < 0) return;
  const row = personalLandmarksList[idx];
  const snapped = plmSnapLandmarkLatLngNearNeighbors(
    ll.lat,
    ll.lng,
    landmarkId,
  );
  let next = { ...row, lat: snapped.lat, lng: snapped.lng };
  if (row.parentId) {
    delete next.parentId;
    delete next.slot;
  }
  if (snapped.snapped && snapped.anchorLandmarkId) {
    next = plmApplySnapAlignBearingToAnchor(next, snapped.anchorLandmarkId);
  }
  personalLandmarksList[idx] = next;
  if (plmMapUsesMagneticLayout()) {
    plmBakeSoloLandmarksMagneticClusters();
  }
  savePersonalLandmarksToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus(
    snapped.snapped
      ? "Repère déplacé (aimanté et aligné)."
      : "Repère déplacé.",
  );
}

/**
 * Repères personnels : drag Leaflet natif + suspension du pan de carte pendant le glisser.
 * (L’ancien « maintien avant drag » + désactivation du drag du marqueur créait des courses
 * souris / tactile / carte et un comportement alterné.)
 */
function plmSyncGroupsLayoutToZoom() {
  /*
   * Au zoom : uniquement rafraîchir l’affichage (grille 30 px via plmDisplayLatLngForLandmark).
   * Ne jamais recalculer ni sauvegarder lat/lng ici : le même gridQx/gridQy donne des
   * coordonnées géo différentes selon le zoom si on « bake » depuis les pixels écran,
   * ce qui déformait tous les repères au premier zoom arrière puis enregistrait le bazar.
   */
  redrawPersonalLandmarksLayer();
}

function plmScheduleMagneticRedraw() {
  if (plmZoomLayoutRaf) cancelAnimationFrame(plmZoomLayoutRaf);
  plmZoomLayoutRaf = requestAnimationFrame(() => {
    plmZoomLayoutRaf = 0;
    if (plmMapUsesMagneticLayout() || plmMapHeadingUpActive()) {
      redrawPersonalLandmarksLayer();
    } else {
      plmScheduleLabelsRefresh();
    }
  });
}

function plmReadBoolPref(key, defaultVal) {
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch (e) {
    /* ignore */
  }
  return !!defaultVal;
}

function plmWriteBoolPref(key, val) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch (e) {
    /* ignore */
  }
}

function plmSyncLayerOnOffToggleUi(el, visible, showLabel, hideLabel) {
  if (!el) return;
  const on = !!visible;
  el.textContent = on ? "On" : "Off";
  el.classList.toggle("is-on", on);
  el.classList.toggle("is-off", !on);
  el.title = on ? hideLabel : showLabel;
  el.setAttribute("aria-label", on ? hideLabel : showLabel);
  el.setAttribute("aria-pressed", on ? "true" : "false");
}

function plmWireLayerOnOffToggle(el, spec) {
  const sync = () => {
    plmSyncLayerOnOffToggleUi(
      el,
      spec.getVisible(),
      spec.show,
      spec.hide,
    );
  };
  L.DomEvent.on(el, "click", (ev) => {
    L.DomEvent.preventDefault(ev);
    spec.setVisible(!spec.getVisible());
    sync();
  });
  sync();
}

function syncPlmLandmarksLayerToggleUi() {
  plmSyncLayerOnOffToggleUi(
    personalLandmarkLayerToggleEl,
    plmLandmarksLayerVisible,
    "Afficher les repères sur la carte",
    "Masquer les repères sur la carte",
  );
}

function syncPlmZonesLayerToggleUi() {
  plmSyncLayerOnOffToggleUi(
    personalZoneLayerToggleEl,
    plmZonesLayerVisible,
    "Afficher les zones sur la carte",
    "Masquer les zones sur la carte",
  );
}

function setPlmLandmarksLayerVisible(on) {
  plmLandmarksLayerVisible = !!on;
  plmWriteBoolPref(LS_KEY_PLM_LANDMARKS_LAYER_VISIBLE, plmLandmarksLayerVisible);
  if (plmLandmarksLayerVisible) {
    if (!map.hasLayer(personalLandmarksLayer)) {
      personalLandmarksLayer.addTo(map);
    }
    redrawPersonalLandmarksLayer();
  } else {
    setPlmLabelsVisible(false);
    personalLandmarksLayer.clearLayers();
    plmMarkerById = new Map();
    if (map.hasLayer(personalLandmarksLayer)) {
      map.removeLayer(personalLandmarksLayer);
    }
    setPersonalLandmarkPlacementActive(false);
  }
  syncPlmLandmarksLayerToggleUi();
}

function setPlmZonesLayerVisible(on) {
  plmZonesLayerVisible = !!on;
  plmWriteBoolPref(LS_KEY_PLM_ZONES_LAYER_VISIBLE, plmZonesLayerVisible);
  if (plmZonesLayerVisible) {
    if (!map.hasLayer(personalZonesLayer)) {
      personalZonesLayer.addTo(map);
    }
    plmRedrawZonesLayer();
  } else {
    setPlmZoneLabelsVisible(false);
    plmClearZoneSelection();
    plmClearZoneEditHandles();
    personalZonesLayer.clearLayers();
    if (map.hasLayer(personalZonesLayer)) {
      map.removeLayer(personalZonesLayer);
    }
  }
  syncPlmZonesLayerToggleUi();
}

function plmApplyMapLayersVisibilityFromPrefs() {
  setPlmLandmarksLayerVisible(
    plmReadBoolPref(LS_KEY_PLM_LANDMARKS_LAYER_VISIBLE, false),
  );
  setPlmZonesLayerVisible(plmReadBoolPref(LS_KEY_PLM_ZONES_LAYER_VISIBLE, true));
}

function redrawPersonalLandmarksLayer() {
  personalLandmarksLayer.clearLayers();
  plmMarkerById = new Map();
  plmGroupDragSnapshot = null;
  plmGroupCapFilterCache.clear();
  if (!plmLandmarksLayerVisible) return;
  for (const item of personalLandmarksList) {
    if (!plmIsValidPlmLatLng(item.lat, item.lng)) {
      continue;
    }
    if (!plmIsLandmarkVisibleOnMap(item)) {
      continue;
    }
    const disp = plmDisplayLatLngForLandmark(item);
    const m = L.marker([disp.lat, disp.lng], plmLandmarkMarkerOptions(item));
    plmMarkerById.set(item.id, m);
    let plmPausedMapDrag = false;
    m.on("mousedown touchstart", (e) => {
      L.DomEvent.stopPropagation(e);
    });
    m.on("dragstart", () => {
      plmClearLandmarkHoverLabel();
      if (typeof m.closeTooltip === "function") {
        m.closeTooltip();
      }
      plmPausedMapDrag =
        map &&
        map.dragging &&
        typeof map.dragging.enabled === "function" &&
        map.dragging.enabled();
      if (plmPausedMapDrag && map.dragging) {
        map.dragging.disable();
      }
      const row = personalLandmarksList.find((x) => x.id === item.id);
      if (row?.groupId) {
        const ll0 = m.getLatLng();
        const positions = new Map();
        for (const mem of plmMembersOfGroup(row.groupId)) {
          const md = plmDisplayLatLngForLandmark(mem);
          positions.set(mem.id, { lat: md.lat, lng: md.lng });
        }
        plmGroupDragSnapshot = {
          groupId: row.groupId,
          draggedId: item.id,
          startLat: ll0.lat,
          startLng: ll0.lng,
          positions,
        };
      } else {
        plmGroupDragSnapshot = null;
      }
    });
    m.on("drag", () => {
      const snap = plmGroupDragSnapshot;
      if (snap && snap.draggedId === item.id) {
        const ll = m.getLatLng();
        const dLat = ll.lat - snap.startLat;
        const dLng = ll.lng - snap.startLng;
        for (const [mid, pos] of snap.positions) {
          if (mid === item.id) continue;
          const other = plmMarkerById.get(mid);
          if (other) {
            other.setLatLng([pos.lat + dLat, pos.lng + dLng]);
          }
        }
        plmScheduleLabelsRefresh();
        return;
      }
      const row = personalLandmarksList.find((x) => x.id === item.id);
      if (row?.groupId) return;
      const ll = m.getLatLng();
      const magnetic = plmSnapLandmarkLatLngNearNeighbors(
        ll.lat,
        ll.lng,
        item.id,
      );
      if (!magnetic.snapped) {
        if (typeof m.setRotation === "function") {
          m.setRotation(plmLandmarkIconRotationRad(row));
          m.update();
        }
        return;
      }
      m.setLatLng([magnetic.lat, magnetic.lng]);
      if (magnetic.anchorLandmarkId) {
        const preview = plmApplySnapAlignBearingToAnchor(
          row,
          magnetic.anchorLandmarkId,
        );
        if (typeof m.setRotation === "function") {
          m.setRotation(plmLandmarkIconRotationRad(preview));
          m.update();
        }
      }
    });
    m.on("dragend", () => {
      plmSuppressLandmarkClickUntil = Date.now() + 450;
      const ll = m.getLatLng();
      const disp = plmDisplayLatLngForLandmark(item);
      const pOrig = map.latLngToContainerPoint(L.latLng(disp.lat, disp.lng));
      const pNow = map.latLngToContainerPoint(ll);
      const pxDist = Math.hypot(pNow.x - pOrig.x, pNow.y - pOrig.y);
      if (pxDist < 10) {
        m.setLatLng([disp.lat, disp.lng]);
        plmGroupDragSnapshot = null;
        if (plmPausedMapDrag && map?.dragging && !map.dragging.enabled()) {
          map.dragging.enable();
        }
        plmPausedMapDrag = false;
        return;
      }
      const snap = plmGroupDragSnapshot;
      try {
        if (snap && snap.draggedId === item.id) {
          if (!plmIsValidPlmLatLng(ll.lat, ll.lng)) {
            redrawPersonalLandmarksLayer();
            return;
          }
          const dLat = ll.lat - snap.startLat;
          const dLng = ll.lng - snap.startLng;
          for (const mem of plmMembersOfGroup(snap.groupId)) {
            const orig = snap.positions.get(mem.id);
            if (!orig) continue;
            const idx = personalLandmarksList.findIndex((x) => x.id === mem.id);
            if (idx < 0) continue;
            personalLandmarksList[idx] = {
              ...personalLandmarksList[idx],
              lat: orig.lat + dLat,
              lng: orig.lng + dLng,
            };
          }
          plmOnMarkerDragEnd(m, item.id, true);
        } else {
          plmOnMarkerDragEnd(m, item.id, false);
        }
      } finally {
        plmGroupDragSnapshot = null;
        if (plmPausedMapDrag && map?.dragging && !map.dragging.enabled()) {
          map.dragging.enable();
        }
        plmPausedMapDrag = false;
      }
    });
    m.on("click", (e) => {
      plmOnLandmarkOpenClick(e, item.id);
    });
    plmBindLandmarkContextMenu(m, item.id);
    m.once("remove", () => {
      if (plmPausedMapDrag && map?.dragging && !map.dragging.enabled()) {
        map.dragging.enable();
      }
      plmPausedMapDrag = false;
    });
    if (!plmLabelsVisible) {
      plmBindLandmarkHoverLabel(m, item.id);
    }
    m.addTo(personalLandmarksLayer);
  }
  plmRefreshLabelsLayer();
  if (plmRotationSession) {
    plmSetRotationTargetsDraggable(false);
    plmRefreshRotationHandlePosition();
  }
  plmRedrawZonesLayer();
}

function plmScheduleLabelsRefresh() {
  if (!plmLabelsVisible && !plmZoneLabelsVisible && !plmHoverLabelLandmarkId) {
    return;
  }
  if (plmLabelsLayoutRaf) cancelAnimationFrame(plmLabelsLayoutRaf);
  plmLabelsLayoutRaf = requestAnimationFrame(() => {
    plmLabelsLayoutRaf = 0;
    if (plmLabelsVisible) plmRefreshLabelsLayer();
    else if (plmHoverLabelLandmarkId) {
      plmShowLandmarkHoverLabel(plmHoverLabelLandmarkId);
    }
    if (plmZoneLabelsVisible) plmRefreshZoneLabels();
  });
}

function plmRefreshLabelsLayer() {
  if (!plmLabelsVisible || !plmLandmarksLayerVisible) return;
  plmClearLandmarkHoverLabel();
  personalLandmarkLabelsLayer.clearLayers();
  plmGroupCapFilterCache.clear();
  const labeledGroups = new Set();
  for (const item of personalLandmarksList) {
    if (!plmIsValidPlmLatLng(item.lat, item.lng)) continue;
    if (!plmIsLandmarkVisibleOnMap(item)) continue;
    if (item.groupId) {
      if (labeledGroups.has(item.groupId)) continue;
      labeledGroups.add(item.groupId);
      const spec = plmResolveLandmarkLabelDisplay(item.id);
      if (!spec) continue;
      plmAddMapLabelMarker(spec.attach, spec.html, spec.landmarkId);
      continue;
    }
    const spec = plmResolveLandmarkLabelDisplay(item.id);
    if (!spec) continue;
    plmAddMapLabelMarker(spec.attach, spec.html, spec.landmarkId);
  }
}

function syncPlmLabelsToggleUi() {
  const el = personalLandmarkLabelsToggleEl;
  if (!el) return;
  if (plmLabelsVisible) {
    el.classList.add("is-on");
    el.classList.remove("is-off");
    el.title = "Masquer les libellés des repères (noms et descriptions)";
    el.setAttribute(
      "aria-label",
      "Masquer les libellés des repères personnels sur la carte.",
    );
  } else {
    el.classList.remove("is-on");
    el.classList.add("is-off");
    el.title = "Afficher les libellés des repères (noms et descriptions)";
    el.setAttribute(
      "aria-label",
      "Afficher les libellés des repères personnels sur la carte.",
    );
  }
}

function setPlmLabelsVisible(on) {
  const want = !!on;
  if (want && !plmLandmarksLayerVisible) return;
  plmLabelsVisible = want;
  if (plmLabelsVisible) {
    plmClearLandmarkHoverLabel();
    if (!map.hasLayer(personalLandmarkLabelsLayer)) {
      personalLandmarkLabelsLayer.addTo(map);
    }
    plmRefreshLabelsLayer();
  } else {
    plmClearLandmarkHoverLabel();
    if (map.hasLayer(personalLandmarkLabelsLayer)) {
      map.removeLayer(personalLandmarkLabelsLayer);
    }
    personalLandmarkLabelsLayer.clearLayers();
  }
  syncPlmLabelsToggleUi();
  redrawPersonalLandmarksLayer();
}

function plmRefreshZoneLabels() {
  if (!personalZoneLabelsLayer) return;
  personalZoneLabelsLayer.clearLayers();
  if (!plmShouldShowGlobalZoneMapLabels()) return;

  const items = [];
  for (const row of personalZonesList) {
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const zone = plmZoneRowToPayload(row);
    if (!zone) continue;
    const layout = plmZoneLabelLayout(zone, name);
    if (!layout) continue;
    items.push({ name, zone, ...layout });
  }
  items.sort((a, b) => b.baseAnchorY - a.baseAnchorY);

  const placedRects = [];
  for (const item of items) {
    const anchorY = plmResolveZoneLabelStackAnchorY(item, placedRects);
    const rect = plmZoneLabelBarScreenRect(item.centerX, anchorY, item.widthPx);
    placedRects.push(rect);
    const anchorLatLng = map.containerPointToLatLng(
      L.point(item.centerX, anchorY),
    );
    if (!plmIsValidPlmLatLng(anchorLatLng.lat, anchorLatLng.lng)) continue;
    L.marker([anchorLatLng.lat, anchorLatLng.lng], {
      icon: plmCreateZoneMapLabelIcon(
        item.name,
        item.widthPx,
        item.zone.strokeColor,
      ),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(personalZoneLabelsLayer);
  }
}

function syncPlmZoneLabelsToggleUi() {
  const el = personalZoneLabelsToggleEl;
  if (!el) return;
  if (plmZoneLabelsVisible) {
    el.classList.add("is-on");
    el.classList.remove("is-off");
    el.title = "Masquer les noms des zones";
    el.setAttribute("aria-label", "Masquer les noms des zones sur la carte.");
  } else {
    el.classList.remove("is-on");
    el.classList.add("is-off");
    el.title = "Afficher les noms des zones";
    el.setAttribute(
      "aria-label",
      "Afficher les noms des zones au-dessus de chaque zone.",
    );
  }
}

function setPlmZoneLabelsVisible(on) {
  const want = !!on;
  if (want && !plmZonesLayerVisible) return;
  plmZoneLabelsVisible = want;
  if (plmZoneLabelsVisible) {
    if (!map.hasLayer(personalZoneLabelsLayer)) {
      personalZoneLabelsLayer.addTo(map);
    }
    plmRefreshZoneLabels();
  } else if (map.hasLayer(personalZoneLabelsLayer)) {
    map.removeLayer(personalZoneLabelsLayer);
    personalZoneLabelsLayer.clearLayers();
  }
  syncPlmZoneLabelsToggleUi();
  plmRedrawZonesLayer();
}

function syncPersonalLandmarkPlacementToggleUi() {
  const el = personalLandmarkPlacementToggleEl;
  if (!el) return;
  if (personalLandmarkPlacementActive) {
    el.classList.add("tam-personal-landmarks-toggle--placing");
    el.title =
      "Cliquez sur la carte pour placer un repère (nouveau clic ici pour quitter le mode placement).";
    el.setAttribute(
      "aria-label",
      "Mode placement : cliquez sur la carte pour placer un repère. Nouveau clic sur le bouton pour quitter le mode.",
    );
  } else {
    el.classList.remove("tam-personal-landmarks-toggle--placing");
    el.title = "Repères personnels sur la carte";
    el.setAttribute(
      "aria-label",
      "Repères personnels : activer le placement sur la carte ou toucher un repère existant pour le modifier.",
    );
  }
}

function setPersonalLandmarkPlacementActive(on) {
  if (
    on &&
    typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
    tamCloudBlocksLandmarkZoneEdits()
  ) {
    return;
  }
  personalLandmarkPlacementActive = !!on;
  const c = map?.getContainer?.();
  if (c) {
    c.classList.toggle("tam-map-placing-landmark", personalLandmarkPlacementActive);
    if (c.style) {
      c.style.cursor = personalLandmarkPlacementActive ? "crosshair" : "";
    }
  }
  plmSyncZonesPassThroughForLandmarkPlacement();
  syncPersonalLandmarkPlacementToggleUi();
}

/**
 * Modale zones carte (indépendante des repères).
 * @param {{ mode: 'create'|'edit', id?: string }} spec
 */
function openPersonalZoneDialog(spec) {
  return new Promise((resolve) => {
    if (
      typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
      tamCloudBlocksLandmarkZoneEdits()
    ) {
      resolve({ action: "cancel" });
      return;
    }
    const dlg = document.getElementById("appPersonalZoneDialog");
    if (!dlg || typeof dlg.showModal !== "function") {
      resolve({ action: "cancel" });
      return;
    }
    plmZoneDialogDepth += 1;
    setPersonalLandmarkPlacementActive(false);
    plmCloseZoneContextMenu();
    const titleEl = document.getElementById("appPersonalZoneDialogTitle");
    const nameIn = document.getElementById("appPersonalZoneDialogName");
    const namePanel = document.getElementById("appPersonalZoneDialogNamePanel");
    const colorsEl = document.getElementById("appPersonalZoneDialogColors");
    const weightEl = document.getElementById("appPersonalZoneDialogWeight");
    const weightValEl = document.getElementById("appPersonalZoneDialogWeightVal");
    const drawBtn = document.getElementById("appPersonalZoneDialogDraw");
    const statusEl = document.getElementById("appPersonalZoneDialogStatus");
    const saveBtn = document.getElementById("appPersonalZoneDialogSave");
    const cancelBtn = document.getElementById("appPersonalZoneDialogCancel");
    if (
      !titleEl ||
      !nameIn ||
      !namePanel ||
      !colorsEl ||
      !weightEl ||
      !weightValEl ||
      !drawBtn ||
      !statusEl ||
      !saveBtn ||
      !cancelBtn
    ) {
      plmZoneDialogDepth = Math.max(0, plmZoneDialogDepth - 1);
      resolve({ action: "cancel" });
      return;
    }
    const mode = spec.mode === "edit" ? "edit" : "create";
    const editId = mode === "edit" ? spec.id : null;
    const existingRow =
      editId != null
        ? personalZonesList.find((x) => x.id === editId)
        : null;
    const existing = plmZoneRowToPayload(existingRow);
    let zoneDraft = existing ? { ...existing } : null;
    let zoneShape = existing
      ? plmNormalizeZoneShape(existing.shape)
      : "rectangle";
    let zoneWeight = existing
      ? existing.strokeWeight
      : PLM_ZONE_DEFAULT_WEIGHT;
    let colorHex = existing
      ? existing.strokeColor
      : PLM_DEFAULT_COLOR_NEW;
    let plmDialogCloseSuspended = false;
    nameIn.value =
      existingRow && existingRow.name != null ? String(existingRow.name) : "";
    let plmZoneNameUi = null;
    if (typeof window.plmCreateZoneNamePickerUi === "function") {
      plmZoneNameUi = window.plmCreateZoneNamePickerUi({
        nameEl: nameIn,
        panelEl: namePanel,
        prompt: (message, defaultValue) =>
          showAppPromptDialog(TAM_APP_DIALOG_TITLE, message, defaultValue ?? ""),
        confirm: (message) =>
          showAppConfirmDialog(TAM_APP_DIALOG_TITLE, message),
        alert: (message) => tamAppAlert(message),
      });
      plmZoneNameUi.setInitial(nameIn.value);
    }
    titleEl.textContent =
      mode === "edit" ? "Modifier la zone" : "Nouvelle zone";

    function plmReopenZoneDialogAfterDraw() {
      plmDialogCloseSuspended = false;
      if (!dlg.open && typeof dlg.showModal === "function") {
        dlg.showModal();
      }
      syncZoneDialogUi();
    }

    function plmGetZoneShapeFromUi() {
      const picked = dlg.querySelector(
        'input[name="appPersonalZoneDialogShape"]:checked',
      );
      return plmNormalizeZoneShape(picked?.value);
    }

    function syncZoneDialogUi() {
      weightEl.value = String(zoneWeight);
      weightValEl.textContent = String(zoneWeight);
      for (const inp of dlg.querySelectorAll(
        'input[name="appPersonalZoneDialogShape"]',
      )) {
        inp.checked = inp.value === zoneShape;
      }
      dlg.querySelectorAll(".tam-plm-color-btn[data-plm-color]").forEach(
        (btn) => {
          btn.classList.toggle(
            "selected",
            btn.getAttribute("data-plm-color") === colorHex,
          );
        },
      );
      drawBtn.textContent = "Tracer sur la carte…";
      drawBtn.hidden = false;
      statusEl.textContent = zoneDraft
        ? `${plmZoneStatusLabel(zoneDraft)} — changez la forme puis Enregistrer (sans re-tracer).`
        : "2 clics : cercle, rectangle ou ovale. 4 clics : quadrilatère.";
      saveBtn.disabled = !zoneDraft;
      plmClearZonePreviewLayer();
    }

    function renderZoneColorButtons() {
      colorsEl.innerHTML = "";
      for (const c of getPlmColorCatalog()) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tam-plm-color-btn";
        btn.dataset.plmColor = c.hex;
        btn.title = c.label;
        btn.setAttribute("aria-label", c.label);
        btn.style.backgroundColor = c.hex;
        colorsEl.appendChild(btn);
      }
    }

    function onDlgClick(ev) {
      const cb = ev.target.closest(".tam-plm-color-btn[data-plm-color]");
      if (cb) {
        colorHex = normalizePlmColorHex(cb.getAttribute("data-plm-color"));
        syncZoneDialogUi();
      }
    }

    function onWeightInput() {
      zoneWeight = Math.min(
        12,
        Math.max(
          1,
          Math.round(Number(weightEl.value) || PLM_ZONE_DEFAULT_WEIGHT),
        ),
      );
      syncZoneDialogUi();
    }

    function onShapeChange() {
      zoneShape = plmGetZoneShapeFromUi();
      syncZoneDialogUi();
    }

    function onDrawClick() {
      zoneShape = plmGetZoneShapeFromUi();
      zoneWeight = Math.min(
        12,
        Math.max(
          1,
          Math.round(Number(weightEl.value) || PLM_ZONE_DEFAULT_WEIGHT),
        ),
      );
      zoneDraft = null;
      plmClearZonePreviewLayer();
      plmDialogCloseSuspended = true;
      if (dlg.open) dlg.close();
      plmStartZoneMapDraw({
        shape: zoneShape,
        strokeColor: colorHex,
        strokeWeight: zoneWeight,
        onComplete: (normalized) => {
          zoneDraft = normalized;
          zoneShape = normalized.shape;
          zoneWeight = normalized.strokeWeight;
          colorHex = normalized.strokeColor;
          plmReopenZoneDialogAfterDraw();
          plmZoneDrawSetHint("Zone tracée sur la carte.");
        },
        onCancel: () => {
          plmReopenZoneDialogAfterDraw();
          plmZoneDrawSetHint("Tracé annulé.");
        },
      });
    }

    let settled = false;
    function cleanup() {
      plmDialogCloseSuspended = false;
      plmStopZoneMapDraw({ clearPreview: true });
      dlg.removeEventListener("click", onDlgClick);
      weightEl.removeEventListener("input", onWeightInput);
      drawBtn.removeEventListener("click", onDrawClick);
      cancelBtn.removeEventListener("click", onCancel);
      saveBtn.removeEventListener("click", onSave);
      dlg.removeEventListener("close", onClose);
      for (const inp of dlg.querySelectorAll(
        'input[name="appPersonalZoneDialogShape"]',
      )) {
        inp.removeEventListener("change", onShapeChange);
      }
      if (plmZoneNameUi) plmZoneNameUi.destroy();
    }

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dlg.open) dlg.close();
      plmZoneDialogDepth = Math.max(0, plmZoneDialogDepth - 1);
      resolve(payload);
    };

    function onClose() {
      if (plmDialogCloseSuspended) return;
      finish({ action: "cancel" });
    }

    function plmZonePayloadForSave() {
      if (!zoneDraft) return null;
      const converted = plmZoneConvertShape(
        {
          ...zoneDraft,
          strokeColor: colorHex,
          strokeWeight: zoneWeight,
        },
        zoneShape,
      );
      if (!converted) {
        tamAppAlert("Impossible de convertir cette forme : tracez une nouvelle zone.");
        return null;
      }
      return plmNormalizeZonePayload(converted);
    }

    function onSave() {
      if (!zoneDraft) {
        tamAppAlert("Tracez d’abord la zone sur la carte.");
        return;
      }
      if (plmZoneNameUi) plmZoneNameUi.flush();
      const payload = plmZonePayloadForSave();
      if (!payload) return;
      const zoneName = String(nameIn.value || "").trim();
      const row = { id: editId || plmNewZoneId(), ...payload };
      if (zoneName) row.name = zoneName;
      if (mode === "edit" && editId) {
        const idx = personalZonesList.findIndex((x) => x.id === editId);
        if (idx >= 0) personalZonesList[idx] = row;
      } else {
        personalZonesList.push(row);
      }
      savePersonalZonesToStorage();
      plmRedrawZonesLayer();
      finish({ action: "save", id: row.id });
    }

    function onCancel() {
      finish({ action: "cancel" });
    }

    renderZoneColorButtons();
    syncZoneDialogUi();
    dlg.addEventListener("click", onDlgClick);
    weightEl.addEventListener("input", onWeightInput);
    drawBtn.addEventListener("click", onDrawClick);
    for (const inp of dlg.querySelectorAll(
      'input[name="appPersonalZoneDialogShape"]',
    )) {
      inp.addEventListener("change", onShapeChange);
    }
    dlg.addEventListener("close", onClose, { once: true });
    saveBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    if (!dlg.dataset.tamZoneBackdropWired) {
      dlg.dataset.tamZoneBackdropWired = "1";
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) dlg.close();
      });
    }
    dlg.showModal();
  });
}

/**
 * Modale création / édition d’un repère personnel (icône, couleur, textes).
 * @param {{ mode: 'create'|'edit', id?: string, groupId?: string, lat: number, lng: number, name?: string, description?: string, iconId?: string, colorHex?: string }} spec
 * @returns {Promise<{ action: 'save'|'cancel', id?: string, groupId?: string, lat?: number, lng?: number, name?: string, description?: string, iconId?: string, colorHex?: string, slots?: string[] }>}
 */
function openPersonalLandmarkDialog(spec) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("appPersonalLandmarkDialog");
    if (!dlg || typeof dlg.showModal !== "function") {
      resolve({ action: "cancel" });
      return;
    }
    const favIconsEl = document.getElementById("appPersonalLandmarkDialogFavIcons");
    const allIconsEl = document.getElementById("appPersonalLandmarkDialogAllIcons");
    const colorsEl = document.getElementById("appPersonalLandmarkDialogColors");
    const titleColorsEl = document.getElementById(
      "appPersonalLandmarkDialogTitleColors",
    );
    const favCapEl = document.getElementById("appPersonalLandmarkDialogFavCap");
    const capBandEl = document.getElementById("appPersonalLandmarkDialogCapBand");
    const settingsBtn = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
    const settingsPop = document.getElementById("appPersonalLandmarkSettingsPopover");
    const helpBtn = document.getElementById("appPersonalLandmarkDialogHelpBtn");
    const nameIn = document.getElementById("appPersonalLandmarkDialogName");
    const descIn = document.getElementById("appPersonalLandmarkDialogDesc");
    const namePanel = document.getElementById("appPersonalLandmarkDialogNamePanel");
    const speedPanel = document.getElementById(
      "appPersonalLandmarkDialogSpeedPanel",
    );
    const cmrPanel = document.getElementById(
      "appPersonalLandmarkDialogCmrPanel",
    );
    const indesPanel = document.getElementById(
      "appPersonalLandmarkDialogIndesPanel",
    );
    const indirPanel = document.getElementById(
      "appPersonalLandmarkDialogIndirPanel",
    );
    const descPreview = document.getElementById(
      "appPersonalLandmarkDialogDescPreview",
    );
    const saveBtn = document.getElementById("appPersonalLandmarkDialogSave");
    const cancelBtn = document.getElementById("appPersonalLandmarkDialogCancel");
    const tabBodyEl = document.getElementById("appPersonalLandmarkDialogTabBody");
    const allDetailsEl = document.getElementById(
      "appPersonalLandmarkDialogAllDetails",
    );
    if (
      !nameIn ||
      !descIn ||
      !namePanel ||
      !speedPanel ||
      !cmrPanel ||
      !indesPanel ||
      !indirPanel ||
      !descPreview ||
      !saveBtn ||
      !cancelBtn ||
      !settingsBtn ||
      !settingsPop ||
      !helpBtn ||
      !favIconsEl ||
      !allIconsEl ||
      !colorsEl ||
      !favCapEl ||
      !capBandEl ||
      !tabBodyEl
    ) {
      resolve({ action: "cancel" });
      return;
    }
    plmEditorDialogDepth += 1;
    let dialogOpened = false;
    try {
    closePlmLandmarkSettingsPopover();
    const mode = spec.mode === "edit" ? "edit" : "create";
    const editItemEarly =
      mode === "edit" && spec.id
        ? personalLandmarksList.find((x) => x.id === spec.id)
        : null;
    const plmPick = {
      iconId: normalizePlmIconId(
        spec.iconId != null ? spec.iconId : PLM_DEFAULT_ICON_ID,
      ),
      colorHex: normalizePlmColorHex(
        spec.colorHex != null ? spec.colorHex : PLM_DEFAULT_COLOR_NEW,
      ),
      titleColorHex: normalizePlmTitleColorHex(
        spec.titleColorHex != null
          ? spec.titleColorHex
          : editItemEarly?.titleColorHex,
      ),
    };
    let activePlmTab = "icon";
    let plmTextUi = null;

    function syncPlmPickerSelectionUi() {
      dlg.querySelectorAll(".tam-plm-icon-btn[data-plm-icon]").forEach((btn) => {
        const id = btn.getAttribute("data-plm-icon");
        btn.classList.toggle("selected", id === plmPick.iconId);
      });
      dlg.querySelectorAll(".tam-plm-color-btn[data-plm-color]").forEach((btn) => {
        const hx = btn.getAttribute("data-plm-color");
        btn.classList.toggle("selected", hx === plmPick.colorHex);
      });
    }

    function syncPlmTitleColorSelectionUi() {
      if (!titleColorsEl) return;
      titleColorsEl
        .querySelectorAll(".tam-plm-color-btn[data-plm-title-color]")
        .forEach((btn) => {
          const hx = btn.getAttribute("data-plm-title-color");
          btn.classList.toggle("selected", hx === plmPick.titleColorHex);
        });
    }

    function renderIconButtons(container, ids) {
      container.innerHTML = "";
      for (const id of ids) {
        const meta = getPlmIconCatalog().find((x) => x.id === id);
        if (!meta) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tam-plm-icon-btn";
        btn.dataset.plmIcon = id;
        btn.title = meta.label;
        btn.setAttribute("aria-label", meta.label);
        btn.innerHTML = plmIconInnerHtml(meta, false);
        container.appendChild(btn);
      }
    }

    function renderColorButtons() {
      colorsEl.innerHTML = "";
      for (const c of getPlmColorCatalog()) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tam-plm-color-btn";
        btn.dataset.plmColor = c.hex;
        btn.title = c.label;
        btn.setAttribute("aria-label", c.label);
        btn.style.backgroundColor = c.hex;
        colorsEl.appendChild(btn);
      }
    }

    function renderTitleColorButtons() {
      if (!titleColorsEl) return;
      titleColorsEl.innerHTML = "";
      for (const c of getPlmColorCatalog()) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tam-plm-color-btn";
        btn.dataset.plmTitleColor = c.hex;
        btn.title = c.label;
        btn.setAttribute("aria-label", c.label);
        btn.style.backgroundColor = c.hex;
        titleColorsEl.appendChild(btn);
      }
      syncPlmTitleColorSelectionUi();
    }

    function rebuildPlmIconGrids() {
      const cap = getPlmFavoritesCap();
      const favIds = getPlmOrderedFavoriteIconIds(cap);
      const favSet = new Set(favIds);
      const allIds = [...getPlmIconCatalog()]
        .sort((a, b) =>
          (a.label || "").localeCompare(b.label || "", "fr"),
        )
        .map((x) => x.id)
        .filter((id) => !favSet.has(id));
      renderIconButtons(favIconsEl, favIds);
      renderIconButtons(allIconsEl, allIds);
      renderColorButtons();
      syncPlmPickerSelectionUi();
    }

    function onPlmDlgClick(ev) {
      const ib = ev.target.closest(".tam-plm-icon-btn[data-plm-icon]");
      if (ib) {
        plmPick.iconId = normalizePlmIconId(ib.getAttribute("data-plm-icon"));
        touchPlmIconRecent(plmPick.iconId);
        rebuildPlmIconGrids();
        return;
      }
      const cb = ev.target.closest(".tam-plm-color-btn[data-plm-color]");
      if (cb) {
        plmPick.colorHex = normalizePlmColorHex(
          cb.getAttribute("data-plm-color"),
        );
        syncPlmPickerSelectionUi();
        return;
      }
      const tcb = ev.target.closest(".tam-plm-color-btn[data-plm-title-color]");
      if (tcb) {
        plmPick.titleColorHex = normalizePlmTitleColorHex(
          tcb.getAttribute("data-plm-title-color"),
        );
        syncPlmTitleColorSelectionUi();
        if (plmTextUi?.syncTitleColorHex) {
          plmTextUi.syncTitleColorHex(plmPick.titleColorHex);
        }
      }
    }

    function onPlmTabClick(ev) {
      const tabBtn = ev.target.closest(".tam-plm-tabs__btn[data-plm-tab]");
      if (!tabBtn) return;
      activePlmTab = tabBtn.getAttribute("data-plm-tab") || "icon";
      plmActivatePersonalLandmarkDialogTab(dlg, activePlmTab);
      requestAnimationFrame(() => plmSyncPersonalLandmarkDialogTabHeights(dlg));
      if (activePlmTab === "name") {
        requestAnimationFrame(() => {
          try {
            nameIn.focus({ preventScroll: true });
          } catch (err) {
            nameIn.focus();
          }
        });
      }
    }

    function onAllDetailsToggle() {
      plmSyncPersonalLandmarkDialogTabHeights(dlg);
    }

    function onFavCapChange() {
      if (!favCapEl) return;
      savePlmFavoritesCap(favCapEl.value);
      rebuildPlmIconGrids();
      requestAnimationFrame(() => plmSyncPersonalLandmarkDialogTabHeights(dlg));
    }

    function onCapBandChange() {
      if (!capBandEl) return;
      capBandEl.value = String(savePlmCapFilterBandM(capBandEl.value));
      redrawPersonalLandmarksLayer();
    }

    if (!dlg.dataset.tamPlmGearWired) {
      dlg.dataset.tamPlmGearWired = "1";
      const gear = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
      if (gear) {
        gear.addEventListener("click", (ev) => {
          ev.stopPropagation();
          togglePlmLandmarkSettingsPopover();
        });
      }
      const helpBtnEl = document.getElementById("appPersonalLandmarkDialogHelpBtn");
      const helpDlgEl = document.getElementById("appPersonalLandmarkHelpDialog");
      const helpOkEl = document.getElementById("appPersonalLandmarkHelpDialogOk");
      if (
        helpBtnEl &&
        helpDlgEl &&
        helpOkEl &&
        typeof helpDlgEl.showModal === "function"
      ) {
        helpBtnEl.addEventListener("click", (ev) => {
          ev.stopPropagation();
          closePlmLandmarkSettingsPopover();
          helpDlgEl.showModal();
        });
        helpOkEl.addEventListener("click", () => {
          if (helpDlgEl.open) helpDlgEl.close();
        });
        helpDlgEl.addEventListener("click", (ev) => {
          if (ev.target === helpDlgEl) helpDlgEl.close();
        });
      }
      dlg.addEventListener("click", (ev) => {
        const pop = document.getElementById("appPersonalLandmarkSettingsPopover");
        const g = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
        const hb = document.getElementById("appPersonalLandmarkDialogHelpBtn");
        if (!pop || pop.hidden) return;
        if (
          pop.contains(ev.target) ||
          g?.contains(ev.target) ||
          hb?.contains(ev.target)
        ) {
          return;
        }
        closePlmLandmarkSettingsPopover();
      });
    }

    if (!dlg.dataset.tamBackdropCloseWired) {
      dlg.dataset.tamBackdropCloseWired = "1";
      dlg.addEventListener("click", (ev) => {
        if (ev.target === dlg) dlg.close();
      });
    }
    if (favCapEl) {
      favCapEl.value = String(getPlmFavoritesCap());
    }
    if (capBandEl) {
      capBandEl.value = String(getPlmCapFilterBandM());
    }
    rebuildPlmIconGrids();
    renderTitleColorButtons();
    plmActivatePersonalLandmarkDialogTab(dlg, activePlmTab);
    dlg.addEventListener("click", onPlmDlgClick);
    dlg.addEventListener("click", onPlmTabClick);
    if (favCapEl) {
      favCapEl.addEventListener("change", onFavCapChange);
    }
    if (capBandEl) {
      capBandEl.addEventListener("change", onCapBandChange);
    }
    if (allDetailsEl) {
      allDetailsEl.addEventListener("toggle", onAllDetailsToggle);
    }

    const editGroupId = spec.groupId || null;
    const editItem =
      mode === "edit" && spec.id
        ? personalLandmarksList.find((x) => x.id === spec.id)
        : null;
    let initialName = spec.name != null ? String(spec.name) : "";
    if (editItem && plmLandmarkHideName(editItem)) {
      initialName = "";
    } else if (editItem) {
      initialName = String(editItem.name ?? "").trim();
    }
    const initialDesc = editGroupId
      ? plmGetGroupDescription(editGroupId)
      : spec.description != null
        ? String(spec.description)
        : "";
    nameIn.value = initialName;
    descIn.value = initialDesc;

    if (typeof window.plmCreateStructuredTextUi === "function") {
      plmTextUi = window.plmCreateStructuredTextUi({
        nameEl: nameIn,
        descEl: descIn,
        namePanel,
        speedPanel,
        cmrPanel,
        indesPanel,
        indirPanel,
        descPreview,
        getTitleColorHex: () => plmPick.titleColorHex,
        setTitleColorHex: (hex) => {
          plmPick.titleColorHex = normalizePlmTitleColorHex(hex);
          syncPlmTitleColorSelectionUi();
        },
        prompt: (message, defaultValue) =>
          showAppPromptDialog(TAM_APP_DIALOG_TITLE, message, defaultValue ?? ""),
        confirm: (message) =>
          showAppConfirmDialog(TAM_APP_DIALOG_TITLE, message),
        alert: (message) => tamAppAlert(message),
      });
      plmTextUi.setInitial(initialName, initialDesc);
    }
    let settled = false;
    function cleanupListeners() {
      saveBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      nameIn.removeEventListener("keydown", onNameKeydown);
      dlg.removeEventListener("close", onClose);
      dlg.removeEventListener("click", onPlmDlgClick);
      dlg.removeEventListener("click", onPlmTabClick);
      if (favCapEl) {
        favCapEl.removeEventListener("change", onFavCapChange);
      }
      if (capBandEl) {
        capBandEl.removeEventListener("change", onCapBandChange);
      }
      if (allDetailsEl) {
        allDetailsEl.removeEventListener("toggle", onAllDetailsToggle);
      }
      if (tabBodyEl) {
        tabBodyEl.style.height = "";
        tabBodyEl.style.minHeight = "";
        tabBodyEl.style.maxHeight = "";
      }
      if (plmTextUi) plmTextUi.destroy();
    }
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      closePlmLandmarkSettingsPopover();
      const helpDlgFin = document.getElementById("appPersonalLandmarkHelpDialog");
      if (helpDlgFin && helpDlgFin.open) helpDlgFin.close();
      if (dlg.open) dlg.close();
      plmEditorDialogDepth = Math.max(0, plmEditorDialogDepth - 1);
      resolve(payload);
    };
    function onClose() {
      if (settled) return;
      finish({ action: "cancel" });
    }
    function onSave() {
      if (plmTextUi) plmTextUi.flush();
      const name = plmTextUi
        ? plmTextUi.getCommittedTitle()
        : String(nameIn.value || "").trim();
      const description = plmTextUi
        ? plmTextUi.getCommittedDescription()
        : String(descIn.value || "").trim();
      touchPlmIconRecent(plmPick.iconId);
      finish({
        action: "save",
        id: mode === "edit" ? spec.id : undefined,
        groupId: editGroupId || undefined,
        lat: spec.lat,
        lng: spec.lng,
        name,
        description,
        iconId: plmPick.iconId,
        colorHex: plmPick.colorHex,
        titleColorHex: plmPick.titleColorHex,
        slots: [],
      });
    }
    function onCancel() {
      finish({ action: "cancel" });
    }
    function onNameKeydown(ev) {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        onSave();
      }
    }
    dlg.addEventListener("close", onClose, { once: true });
    saveBtn.addEventListener("click", onSave);
    cancelBtn.addEventListener("click", onCancel);
    nameIn.addEventListener("keydown", onNameKeydown);
    dlg.showModal();
    dialogOpened = true;
    requestAnimationFrame(() => {
      plmSyncPersonalLandmarkDialogTabHeights(dlg);
    });
    if (!dlg.dataset.tamPlmTabResizeWired) {
      dlg.dataset.tamPlmTabResizeWired = "1";
      window.addEventListener("resize", () => {
        if (dlg.open) plmSyncPersonalLandmarkDialogTabHeights(dlg);
      });
    }
    } catch (err) {
      console.error("openPersonalLandmarkDialog", err);
      if (dlg.open) dlg.close();
      tamAppAlert(
        "Impossible d’ouvrir la fenêtre du repère. Rechargez la page (F5).",
      );
      resolve({ action: "cancel" });
    } finally {
      if (!dialogOpened) {
        plmEditorDialogDepth = Math.max(0, plmEditorDialogDepth - 1);
      }
    }
  });
}

async function openPersonalLandmarkMarkerEditor(id) {
  if (
    typeof tamCloudBlocksLandmarkZoneEdits === "function" &&
    tamCloudBlocksLandmarkZoneEdits()
  ) {
    tamAppAlert(
      "Modification des repères désactivée en mode lecture (cloud). Connectez-vous en maître pour modifier.",
    );
    return;
  }
  setPersonalLandmarkPlacementActive(false);
  const item = personalLandmarksList.find((x) => x.id === id);
  if (!item) return;
  const r = await openPersonalLandmarkDialog({
    mode: "edit",
    id: item.id,
    groupId: item.groupId,
    lat: item.lat,
    lng: item.lng,
    name: plmLandmarkDisplayName(item),
    description: plmLandmarkDescriptionText(item),
    iconId: item.iconId,
    colorHex: item.colorHex,
    titleColorHex: item.titleColorHex,
  });
  if (r.action === "cancel") return;
  if (r.action === "save" && r.id) {
    const result = plmCommitDialogSave({ ...r, action: "save" });
    if (result.ok) {
      savePersonalLandmarksToStorage();
      redrawPersonalLandmarksLayer();
      const label = r.name || "Repère";
      setGpsStatus(
        result.added > 0
          ? `Repère mis à jour : ${label} (${result.added} repère(s) ajouté(s)).`
          : `Repère mis à jour : ${label}`,
      );
    }
  }
}
loadPlmGroupsFromStorage();
loadPersonalLandmarksFromStorage();
if (plmSanitizeParentLinks()) {
  savePersonalLandmarksToStorage(true);
}
loadPersonalZonesFromStorage();
plmMigrateAllZonesToIndependentList();
plmSyncGroupsLayoutToZoom();
plmInstallZoneSelectionHandlers();
plmApplyMapLayersVisibilityFromPrefs();

let marker = L.marker([43.61, 3.88], {
  icon: navIcon,
  zIndexOffset: 800,
}).addTo(map);
map.on("zoom", () => {
  plmScheduleMagneticRedraw();
  plmScheduleLabelsRefresh();
  plmScheduleZoneMissionHudRefresh();
});
map.on("rotate", () => {
  plmSyncLandmarkMarkerRotations();
  if (typeof syncStopCorrespondenceMapLabelView === "function") {
    syncStopCorrespondenceMapLabelView();
  }
  plmScheduleMagneticRedraw();
  plmScheduleLabelsRefresh();
});
map.on("zoomend", () => {
  applyMapVisualProfile();
  if (plmZoomLayoutRaf) {
    cancelAnimationFrame(plmZoomLayoutRaf);
    plmZoomLayoutRaf = 0;
  }
  plmSyncGroupsLayoutToZoom();
});
map.on("moveend", () => {
  plmScheduleLabelsRefresh();
  plmScheduleZoneMissionHudRefresh();
  if (typeof syncStopCorrespondenceMapLabelView === "function") {
    syncStopCorrespondenceMapLabelView();
  }
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
  if (personalLandmarkPlacementActive && ev?.latlng) {
    setPersonalLandmarkPlacementActive(false);
    const snapped = plmSnapLandmarkLatLngNearNeighbors(
      ev.latlng.lat,
      ev.latlng.lng,
    );
    const r = await openPersonalLandmarkDialog({
      mode: "create",
      lat: snapped.lat,
      lng: snapped.lng,
      name: "",
      description: "",
    });
    if (
      r.action === "save" &&
      Number.isFinite(r.lat) &&
      Number.isFinite(r.lng)
    ) {
      const result = plmCommitDialogSave({
        action: "save",
        lat: r.lat,
        lng: r.lng,
        name: r.name,
        description: r.description,
        iconId: r.iconId,
        colorHex: r.colorHex,
        titleColorHex: r.titleColorHex,
        groupId: r.groupId,
        slots: r.slots || [],
      });
      if (result.ok) {
        savePersonalLandmarksToStorage();
        redrawPersonalLandmarksLayer();
        const label = r.name || "Repère";
        setGpsStatus(
          result.snapped
            ? `Repère ajouté : ${label} (aimanté et aligné).`
            : `Repère ajouté : ${label}`,
        );
      }
    } else if (r.action === "cancel") {
      setGpsStatus("Placement de repère annulé.");
    }
    return;
  }
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
  if (!mapRecapEl) return;
  mapRecapEl.classList.toggle("show", !!on);
  try {
    localStorage.setItem(LS_KEY_RECAP, on ? "1" : "0");
  } catch (e) {
    // ignore
  }
  refreshMapLayout();
}

function flattenPolylineCoordsForDistance(latlngs) {
  if (!latlngs?.length) return [];
  let arr = latlngs;
  while (arr.length && !(arr[0] && typeof arr[0].lat === "number")) {
    arr = arr.flat();
    if (!arr.length) return [];
  }
  return arr.map((x) => [Number(x.lat), Number(x.lng)]);
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
  if (typeof updateStopCorrespondenceMapLabels === "function") {
    updateStopCorrespondenceMapLabels(distanceAlongPathMeters || 0);
  }
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
  if (panelName === "voice") panelName = "mission";
  const sections = controlPanelEl.querySelectorAll(".panel-section");
  sections.forEach((s) => s.classList.remove("show"));
  [missionTabBtn, opsTabBtn, helpTabBtn].forEach(
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
  if (plmEditorDialogDepth > 0) {
    return;
  }
  const run = () => {
    if (plmEditorDialogDepth > 0) {
      return;
    }
    if (map && typeof map.invalidateSize === "function") {
      map.invalidateSize({ pan: false, animate: false });
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

