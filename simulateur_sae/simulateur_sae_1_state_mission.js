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
const PLM_DUPLICATE_OFFSET_LAT = -0.00022;
const PLM_DUPLICATE_OFFSET_LNG = 0.00032;
const LS_KEY_PLM_GROUPS = "tam_personal_landmark_groups_v1";
const PLM_SLOT_SPACING_LAT = 0.00022;
const PLM_SLOT_SPACING_LNG = 0.00032;
const PLM_SLOT_MATCH_THRESHOLD = 8e-11;
const PLM_MAP_MAX_ZOOM = 19;
const PLM_MAGNETIC_ZOOM_FROM_MAX = 2;
const PLM_MAGNETIC_SPACING_PX = 30;
const PLM_MARKER_ICON_W = 30;
const PLM_MARKER_ICON_H = 30;
const PLM_MARKER_ICON_ANCHOR_X = 15;
const PLM_MARKER_ICON_ANCHOR_Y = 30;
const PLM_LABEL_GAP_BELOW_PX = 4;
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

function plmEscapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plmMarkerScreenBoundsFromLatLng(lat, lng) {
  if (!map) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  const p = map.latLngToContainerPoint(L.latLng(lat, lng));
  return {
    left: p.x - PLM_MARKER_ICON_ANCHOR_X,
    top: p.y - PLM_MARKER_ICON_ANCHOR_Y,
    right: p.x - PLM_MARKER_ICON_ANCHOR_X + PLM_MARKER_ICON_W,
    bottom: p.y - PLM_MARKER_ICON_ANCHOR_Y + PLM_MARKER_ICON_H,
  };
}

/** Point d’ancrage du libellé : sous le repère, aligné à gauche de l’icône. */
function plmLabelTopLeftLatLngBelowMarker(lat, lng) {
  if (!map) return null;
  const b = plmMarkerScreenBoundsFromLatLng(lat, lng);
  const pt = L.point(b.left, b.bottom + PLM_LABEL_GAP_BELOW_PX);
  const ll = map.containerPointToLatLng(pt);
  return { lat: ll.lat, lng: ll.lng };
}

/** Libellé de groupe : sous le repère le plus bas, aligné à gauche du groupe. */
function plmGroupLabelTopLeftLatLng(groupId) {
  const members = plmMembersOfGroup(groupId).filter((m) =>
    plmIsValidPlmLatLng(m.lat, m.lng),
  );
  if (!members.length || !map) return null;
  let minLeft = Infinity;
  let maxBottom = -Infinity;
  for (const m of members) {
    const d = plmDisplayLatLngForLandmark(m);
    const b = plmMarkerScreenBoundsFromLatLng(d.lat, d.lng);
    if (b.left < minLeft) minLeft = b.left;
    if (b.bottom > maxBottom) maxBottom = b.bottom;
  }
  if (!Number.isFinite(minLeft) || !Number.isFinite(maxBottom)) return null;
  const pt = L.point(minLeft, maxBottom + PLM_LABEL_GAP_BELOW_PX);
  const ll = map.containerPointToLatLng(pt);
  return { lat: ll.lat, lng: ll.lng };
}

function plmLandmarkForGroupLabel(groupId) {
  const members = plmMembersOfGroup(groupId);
  const named = members.find((m) => String(m.name ?? "").trim());
  return named || members[0] || null;
}

function plmBuildMapLabelHtml(item) {
  const desc = plmLandmarkDescriptionText(item);
  let html = '<div class="tam-plm-map-label__card">';
  html += `<strong>${plmEscapeHtml(item.name)}</strong>`;
  if (desc) {
    html += `<p>${plmEscapeHtml(desc)}</p>`;
  }
  html += "</div>";
  return html;
}

function plmCreateMapLabelIcon(html) {
  return L.divIcon({
    className: "tam-plm-map-label",
    html,
    iconAnchor: [0, 0],
  });
}

function plmMapUsesMagneticLayout() {
  if (!map || typeof map.getZoom !== "function") return false;
  const z = Math.floor(map.getZoom() + 1e-6);
  return z >= PLM_MAP_MAX_ZOOM - PLM_MAGNETIC_ZOOM_FROM_MAX;
}

function plmSlotFromPositions(originLat, originLng, memLat, memLng) {
  if (!map) return null;
  const p0 = map.latLngToContainerPoint(L.latLng(originLat, originLng));
  const p1 = map.latLngToContainerPoint(L.latLng(memLat, memLng));
  return (
    plmNeighborSlotFromPixelDelta(p1.x - p0.x, p1.y - p0.y) ||
    plmFindSlotKeyForDelta(memLat - originLat, memLng - originLng)
  );
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

/**
 * Position affichée : grille 30 px locale — chaque repère est à une case
 * du parent dont il a été ajouté (parentId + direction), chaîne récursive.
 */
function plmDisplayLatLngForLandmark(item, visiting) {
  if (!item || !plmIsValidPlmLatLng(item.lat, item.lng)) {
    return { lat: item?.lat, lng: item?.lng };
  }
  const parentId = String(item.parentId ?? "").trim();
  const slot = String(item.slot ?? "").trim();
  if (!plmMapUsesMagneticLayout() || !parentId || !slot) {
    return { lat: item.lat, lng: item.lng };
  }
  const seen = visiting || new Set();
  if (seen.has(item.id)) {
    return { lat: item.lat, lng: item.lng };
  }
  seen.add(item.id);
  const parent = personalLandmarksList.find((x) => x.id === parentId);
  if (!parent) {
    return { lat: item.lat, lng: item.lng };
  }
  const pp = plmDisplayLatLngForLandmark(parent, seen);
  const pos = plmLatLngFromSlot(pp.lat, pp.lng, slot);
  if (!pos || !plmIsValidPlmLatLng(pos[0], pos[1])) {
    return { lat: item.lat, lng: item.lng };
  }
  return { lat: pos[0], lng: pos[1] };
}

function plmApplyMagneticLayoutForGroup(groupId) {
  if (!plmMapUsesMagneticLayout()) return false;
  let changed = false;
  for (const mem of plmMembersOfGroup(groupId)) {
    const disp = plmDisplayLatLngForLandmark(mem);
    const idx = personalLandmarksList.findIndex((x) => x.id === mem.id);
    if (idx < 0) continue;
    const cur = personalLandmarksList[idx];
    if (
      Math.abs(cur.lat - disp.lat) > 1e-9 ||
      Math.abs(cur.lng - disp.lng) > 1e-9
    ) {
      personalLandmarksList[idx] = { ...cur, lat: disp.lat, lng: disp.lng };
      changed = true;
    }
  }
  return changed;
}

function plmApplyMagneticLayoutForAllGroups() {
  if (!plmMapUsesMagneticLayout()) return false;
  const seen = new Set();
  let changed = false;
  for (const item of personalLandmarksList) {
    if (!item.groupId || seen.has(item.groupId)) continue;
    seen.add(item.groupId);
    if (plmApplyMagneticLayoutForGroup(item.groupId)) changed = true;
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
  personalLandmarksList[idx] = {
    ...item,
    lat: pos[0],
    lng: pos[1],
    groupId,
    parentId: selection.parentId,
    slot: selection.slot,
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
  if (r.action !== "save" || !r.name) return { ok: false, added: 0 };
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
      name: r.name,
      description: finalGroupId ? "" : String(r.description ?? "").trim(),
      iconId: adding
        ? normalizePlmIconId(prev.iconId)
        : normalizePlmIconId(r.iconId),
      colorHex: adding
        ? normalizePlmColorHex(prev.colorHex)
        : normalizePlmColorHex(r.colorHex),
    };
    if (finalGroupId) row.groupId = finalGroupId;
    if (prev.parentId) {
      row.parentId = prev.parentId;
      row.slot = prev.slot;
    }
    personalLandmarksList[idx] = row;
    if (finalGroupId) {
      plmSetGroupDescription(finalGroupId, r.description);
      plmSyncGroupMemberNames(finalGroupId, r.name);
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
    if (finalGroupId && plmMapUsesMagneticLayout()) {
      plmApplyMagneticLayoutForGroup(finalGroupId);
    }
    if (!finalGroupId && !slots.length) {
      plmRemoveGroupIfEmpty(prev.groupId);
    }
    return { ok: true, added };
  }

  const newId = plmNewLandmarkId();
  const row = {
    id: newId,
    lat: Number(r.lat),
    lng: Number(r.lng),
    name: r.name,
    description: groupId ? "" : String(r.description ?? "").trim(),
    iconId: normalizePlmIconId(r.iconId),
    colorHex: normalizePlmColorHex(r.colorHex),
  };
  if (groupId) row.groupId = groupId;
  personalLandmarksList.push(row);
  if (groupId) {
    plmSetGroupDescription(groupId, r.description);
    plmSyncGroupMemberNames(groupId, r.name);
  }
  const cpos = plmDisplayLatLngForLandmark(row);
  const added = plmAddChildrenFromSlots(
    newId,
    cpos.lat,
    cpos.lng,
    groupId,
    slots,
    r.name,
    r.iconId,
    r.colorHex,
  );
  if (groupId && plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForGroup(groupId);
  }
  return { ok: true, added };
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

function normalizePlmColorHex(raw) {
  const t = String(raw ?? "").trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  return PLM_DEFAULT_COLOR_NEW;
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
const TAM_BACKUP_ALL_KEYS = [
  LS_KEY_PERSONAL_LANDMARKS,
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
  "tam_plm_structured_text_config_v1",
];
let tamAutoBackupTimer = 0;
let tamAutoBackupLastJson = "";
/** File System Access API : handle fichier persistant (null = pas encore accordé). */
let tamBackupFileHandle = null;
/** Promesse en cours d'acquisition du handle (évite les doublons). */
let tamBackupFileHandlePromise = null;

function tamCollectBackupPayload() {
  const data = {};
  for (const key of TAM_BACKUP_ALL_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) data[key] = JSON.parse(raw);
    } catch (e) {
      const raw = localStorage.getItem(key);
      if (raw != null) data[key] = raw;
    }
  }
  data._meta = {
    version: 2,
    date: new Date().toISOString(),
    landmarks: personalLandmarksList.length,
  };
  return data;
}

async function tamWriteToFileHandle(json) {
  if (!tamBackupFileHandle) return false;
  try {
    const writable = await tamBackupFileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    return true;
  } catch (e) {
    tamBackupFileHandle = null;
    return false;
  }
}

function tamTriggerFileDownload(json, filename) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

async function tamAcquireFileHandle() {
  if (typeof window.showSaveFilePicker !== "function") return null;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: TAM_BACKUP_FILENAME,
      types: [
        {
          description: "Sauvegarde simulateur TAM",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    return handle;
  } catch (e) {
    return null;
  }
}

function tamImportBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== "object") throw new Error("format");
      for (const key of TAM_BACKUP_ALL_KEYS) {
        if (data[key] != null) {
          localStorage.setItem(key, JSON.stringify(data[key]));
        }
      }
      loadPlmGroupsFromStorage();
      loadPersonalLandmarksFromStorage();
      if (plmSanitizeParentLinks()) {
        savePersonalLandmarksToStorage();
      }
      const count = personalLandmarksList.length;
      redrawPersonalLandmarksLayer();
      tamAppAlert(
        `Restauration terminée : ${count} repère(s), déviations et réglages rechargés.`,
      );
      setGpsStatus(`Sauvegarde restaurée.`);
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
    if (tamBackupFileHandlePromise) {
      await tamBackupFileHandlePromise;
    }
    const payload = tamCollectBackupPayload();
    const json = JSON.stringify(payload);
    if (json === tamAutoBackupLastJson) return;
    tamAutoBackupLastJson = json;
    const pretty = JSON.stringify(payload, null, 2);
    if (tamBackupFileHandle) {
      if (await tamWriteToFileHandle(pretty)) return;
    }
    tamTriggerFileDownload(pretty, TAM_BACKUP_FILENAME);
  } catch (e) {
    // silencieux
  }
}

function plmScheduleAutoBackup() {
  if (
    !tamBackupFileHandle &&
    !tamBackupFileHandlePromise &&
    typeof window.showSaveFilePicker === "function"
  ) {
    tamBackupFileHandlePromise = tamAcquireFileHandle()
      .then((handle) => {
        tamBackupFileHandlePromise = null;
        if (handle) tamBackupFileHandle = handle;
      })
      .catch(() => {
        tamBackupFileHandlePromise = null;
      });
  }
  if (tamAutoBackupTimer) clearTimeout(tamAutoBackupTimer);
  tamAutoBackupTimer = setTimeout(() => {
    tamAutoBackupTimer = 0;
    void tamDoAutoBackup();
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

function buildPlmMarkerBubbleHtml(item) {
  const iconId = normalizePlmIconId(item?.iconId);
  const bg = normalizePlmColorHex(item?.colorHex);
  const def =
    getPlmIconCatalog().find((x) => x.id === iconId) || getPlmIconCatalog()[0];
  const fg = plmContrastIconOnBackground(bg);
  const bgA = plmEscapeAttr(bg);
  const fgA = plmEscapeAttr(fg);
  const glyph = plmIconInnerHtml(def, true);
  return `<div class="tam-personal-landmark-marker__bubble"><div class="tam-plm-marker-chip" style="background-color:${bgA};color:${fgA};">${glyph}</div></div>`;
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
    return wrap;
  };
  ctrlPlm.addTo(map);

  tamBasemapExtrasControlsInstalled = true;
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
/** Repères personnels (carrefours, points d’intérêt) — persistance locale. */
const personalLandmarksLayer = L.layerGroup().addTo(map);
const personalLandmarkLabelsLayer = L.layerGroup();
let personalLandmarksList = [];
let personalLandmarkPlacementActive = false;
let personalLandmarkPlacementToggleEl = null;
let personalLandmarkLabelsToggleEl = null;
let plmLabelsVisible = false;
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

function plmResetPathTravelSign() {
  plmPathTravelSign = 1;
  plmLastAlongForTravelSign = null;
  plmGroupCapFilterCache.clear();
}

function plmNotifyAlongPathMeters(along) {
  if (!Number.isFinite(along)) return;
  if (plmLastAlongForTravelSign == null) {
    plmLastAlongForTravelSign = along;
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

function plmIsCapSideFilterActive() {
  return (
    !!headingUpEl?.checked &&
    !!currentPattern &&
    pathTotalMeters > 0 &&
    Array.isArray(activeCoordinates) &&
    activeCoordinates.length >= 2
  );
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

/** Masquage affichage (stockage inchangé) : mode Cap + à droite du tracé, proche du tracé. */
function plmIsLandmarkVisibleOnMap(item) {
  if (!plmIsCapSideFilterActive()) return true;
  if (item.groupId) {
    return plmIsGroupVisibleCapFilter(item.groupId);
  }
  const pr = plmProjectLandmarkForCapFilter(item);
  if (pr.crossTrackMeters > getPlmCapFilterBandM()) return false;
  return pr.signedCrossTrackMeters > 0;
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

function plmDuplicateLandmarkFromId(sourceId) {
  const src = personalLandmarksList.find((x) => x.id === sourceId);
  if (!src) return null;
  const lat = src.lat + PLM_DUPLICATE_OFFSET_LAT;
  const lng = src.lng + PLM_DUPLICATE_OFFSET_LNG;
  if (!plmIsValidPlmLatLng(lat, lng)) return null;
  const row = {
    id: plmNewLandmarkId(),
    lat,
    lng,
    name: src.name,
    description: src.groupId ? "" : String(src.description ?? ""),
    iconId: normalizePlmIconId(src.iconId),
    colorHex: normalizePlmColorHex(src.colorHex),
  };
  personalLandmarksList.push(row);
  return row.id;
}

function plmDuplicateGroupFromId(sourceGroupId) {
  const members = plmMembersOfGroup(sourceGroupId);
  if (!members.length) return null;
  const newGroupId = plmGenerateGroupId();
  const desc = plmGetGroupDescription(sourceGroupId);
  if (desc) plmSetGroupDescription(newGroupId, desc);
  const idMap = new Map();
  for (const mem of members) {
    const newId = plmNewLandmarkId();
    idMap.set(mem.id, newId);
    personalLandmarksList.push({
      id: newId,
      lat: mem.lat + PLM_DUPLICATE_OFFSET_LAT,
      lng: mem.lng + PLM_DUPLICATE_OFFSET_LNG,
      name: mem.name,
      description: "",
      iconId: normalizePlmIconId(mem.iconId),
      colorHex: normalizePlmColorHex(mem.colorHex),
      groupId: newGroupId,
    });
  }
  for (const mem of members) {
    const newId = idMap.get(mem.id);
    if (!newId) continue;
    const idx = personalLandmarksList.findIndex((x) => x.id === newId);
    if (idx < 0) continue;
    const parentNew = mem.parentId ? idMap.get(mem.parentId) : null;
    if (parentNew && mem.slot) {
      personalLandmarksList[idx] = {
        ...personalLandmarksList[idx],
        parentId: parentNew,
        slot: mem.slot,
      };
    }
  }
  const refName =
    members.find((m) => String(m.name ?? "").trim())?.name || members[0].name;
  plmSyncGroupMemberNames(newGroupId, refName);
  if (plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForGroup(newGroupId);
  }
  return newGroupId;
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
  savePersonalLandmarksToStorage();
  savePlmGroupsToStorage();
  redrawPersonalLandmarksLayer();
  setGpsStatus("Repère détaché du groupe.");
}

function plmShowLandmarkContextMenu(clientX, clientY, landmarkId) {
  const item = personalLandmarksList.find((x) => x.id === landmarkId);
  if (!item) return;
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
    if (action === "edit") {
      void openPersonalLandmarkMarkerEditor(id);
      return;
    }
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
    const touch = e.originalEvent.touches[0];
    plmLongPressTimer = setTimeout(() => {
      plmLongPressTimer = 0;
      plmSuppressLandmarkClickUntil = Date.now() + 800;
      plmShowLandmarkContextMenu(touch.clientX, touch.clientY, landmarkId);
    }, PLM_LONG_PRESS_MS);
  });
  marker.on("touchmove touchend touchcancel", () => {
    plmClearLongPressTimer();
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

function plmAddMapLabelMarker(anchor, html, landmarkId) {
  const icon = plmCreateMapLabelIcon(html);
  const lm = L.marker([anchor.lat, anchor.lng], {
    icon,
    interactive: true,
    bubblingMouseEvents: false,
    zIndexOffset: 420,
  });
  lm.on("mousedown touchstart", (e) => {
    L.DomEvent.stopPropagation(e);
  });
  lm.on("click", (e) => {
    plmOnLandmarkOpenClick(e, landmarkId);
  });
  plmBindLandmarkContextMenu(lm, landmarkId);
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
            if (groupIdRaw) row.groupId = groupIdRaw;
            if (parentIdRaw) row.parentId = parentIdRaw;
            if (slotRaw) row.slot = slotRaw;
            return row;
          })
          .filter(
            (x) =>
              x.id &&
              Number.isFinite(x.lat) &&
              Number.isFinite(x.lng) &&
              x.name.length > 0,
          );
      }
    }
  } catch (e) {
    personalLandmarksList = [];
  }
  seedPlmIconRecentFromLandmarksIfEmpty();
}

function savePersonalLandmarksToStorage() {
  try {
    localStorage.setItem(
      LS_KEY_PERSONAL_LANDMARKS,
      JSON.stringify(personalLandmarksList),
    );
  } catch (e) {
    // ignore
  }
  plmScheduleAutoBackup();
}

function makePersonalLandmarkDivIcon(item) {
  return L.divIcon({
    className: "tam-personal-landmark-marker",
    html: buildPlmMarkerBubbleHtml(item),
    iconSize: [30, 30],
    iconAnchor: [15, 30],
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
  const next = { ...row, lat: ll.lat, lng: ll.lng };
  if (row.parentId) {
    delete next.parentId;
    delete next.slot;
  }
  personalLandmarksList[idx] = next;
  savePersonalLandmarksToStorage();
  if (!plmLabelsVisible) {
    m.unbindTooltip();
    m.bindTooltip(personalLandmarksList[idx].name, {
      sticky: false,
      direction: "top",
      offset: [0, -34],
    });
  }
  plmRefreshLabelsLayer();
  setGpsStatus("Repère déplacé.");
}

/**
 * Repères personnels : drag Leaflet natif + suspension du pan de carte pendant le glisser.
 * (L’ancien « maintien avant drag » + désactivation du drag du marqueur créait des courses
 * souris / tactile / carte et un comportement alterné.)
 */
function plmSyncGroupsLayoutToZoom(persist) {
  if (plmMapUsesMagneticLayout()) {
    plmApplyMagneticLayoutForAllGroups();
    if (persist !== false) {
      savePersonalLandmarksToStorage();
    }
  }
  redrawPersonalLandmarksLayer();
}

function plmScheduleMagneticRedraw() {
  if (plmZoomLayoutRaf) cancelAnimationFrame(plmZoomLayoutRaf);
  plmZoomLayoutRaf = requestAnimationFrame(() => {
    plmZoomLayoutRaf = 0;
    if (plmMapUsesMagneticLayout()) {
      redrawPersonalLandmarksLayer();
    } else {
      plmScheduleLabelsRefresh();
    }
  });
}

function redrawPersonalLandmarksLayer() {
  personalLandmarksLayer.clearLayers();
  plmMarkerById = new Map();
  plmGroupDragSnapshot = null;
  plmGroupCapFilterCache.clear();
  for (const item of personalLandmarksList) {
    if (!plmIsValidPlmLatLng(item.lat, item.lng)) {
      continue;
    }
    if (!plmIsLandmarkVisibleOnMap(item)) {
      continue;
    }
    const disp = plmDisplayLatLngForLandmark(item);
    const m = L.marker([disp.lat, disp.lng], {
      icon: makePersonalLandmarkDivIcon(item),
      zIndexOffset: 450,
      draggable: true,
    });
    plmMarkerById.set(item.id, m);
    let plmPausedMapDrag = false;
    m.on("mousedown touchstart", (e) => {
      L.DomEvent.stopPropagation(e);
    });
    m.on("dragstart", () => {
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
      if (!snap || snap.draggedId !== item.id) return;
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
    });
    m.on("dragend", () => {
      plmSuppressLandmarkClickUntil = Date.now() + 450;
      const snap = plmGroupDragSnapshot;
      try {
        if (snap && snap.draggedId === item.id) {
          const ll = m.getLatLng();
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
      m.bindTooltip(item.name, {
        sticky: false,
        direction: "top",
        offset: [0, -34],
      });
    }
    m.addTo(personalLandmarksLayer);
  }
  plmRefreshLabelsLayer();
}

function plmScheduleLabelsRefresh() {
  if (!plmLabelsVisible) return;
  if (plmLabelsLayoutRaf) cancelAnimationFrame(plmLabelsLayoutRaf);
  plmLabelsLayoutRaf = requestAnimationFrame(() => {
    plmLabelsLayoutRaf = 0;
    plmRefreshLabelsLayer();
  });
}

function plmRefreshLabelsLayer() {
  if (!plmLabelsVisible) return;
  personalLandmarkLabelsLayer.clearLayers();
  plmGroupCapFilterCache.clear();
  const labeledGroups = new Set();
  for (const item of personalLandmarksList) {
    if (!plmIsValidPlmLatLng(item.lat, item.lng)) continue;
    if (!plmIsLandmarkVisibleOnMap(item)) continue;
    if (item.groupId) {
      if (labeledGroups.has(item.groupId)) continue;
      labeledGroups.add(item.groupId);
      const ref = plmLandmarkForGroupLabel(item.groupId);
      if (!ref) continue;
      const descText = plmLandmarkDescriptionText(ref);
      if (!String(ref.name ?? "").trim() && !descText) continue;
      const anchor = plmGroupLabelTopLeftLatLng(item.groupId);
      if (!anchor) continue;
      plmAddMapLabelMarker(anchor, plmBuildMapLabelHtml(ref), ref.id);
      continue;
    }
    const descText = plmLandmarkDescriptionText(item);
    if (!String(item.name ?? "").trim() && !descText) continue;
    const disp = plmDisplayLatLngForLandmark(item);
    const anchor = plmLabelTopLeftLatLngBelowMarker(disp.lat, disp.lng);
    if (!anchor) continue;
    plmAddMapLabelMarker(anchor, plmBuildMapLabelHtml(item), item.id);
  }
}

function syncPlmLabelsToggleUi() {
  const el = personalLandmarkLabelsToggleEl;
  if (!el) return;
  if (plmLabelsVisible) {
    el.classList.add("is-on");
    el.title = "Masquer les libellés des repères (noms et descriptions)";
    el.setAttribute(
      "aria-label",
      "Masquer les libellés des repères personnels sur la carte.",
    );
  } else {
    el.classList.remove("is-on");
    el.title = "Afficher les libellés des repères (noms et descriptions)";
    el.setAttribute(
      "aria-label",
      "Afficher les libellés des repères personnels sur la carte.",
    );
  }
}

function setPlmLabelsVisible(on) {
  plmLabelsVisible = !!on;
  if (plmLabelsVisible) {
    if (!map.hasLayer(personalLandmarkLabelsLayer)) {
      personalLandmarkLabelsLayer.addTo(map);
    }
    plmRefreshLabelsLayer();
  } else if (map.hasLayer(personalLandmarkLabelsLayer)) {
    map.removeLayer(personalLandmarkLabelsLayer);
    personalLandmarkLabelsLayer.clearLayers();
  }
  syncPlmLabelsToggleUi();
  redrawPersonalLandmarksLayer();
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
  personalLandmarkPlacementActive = !!on;
  const c = map?.getContainer?.();
  if (c && c.style) {
    c.style.cursor = personalLandmarkPlacementActive ? "crosshair" : "";
  }
  syncPersonalLandmarkPlacementToggleUi();
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
    plmEditorDialogDepth += 1;
    const favIconsEl = document.getElementById("appPersonalLandmarkDialogFavIcons");
    const allIconsEl = document.getElementById("appPersonalLandmarkDialogAllIcons");
    const colorsEl = document.getElementById("appPersonalLandmarkDialogColors");
    const favCapEl = document.getElementById("appPersonalLandmarkDialogFavCap");
    const capBandEl = document.getElementById("appPersonalLandmarkDialogCapBand");
    const settingsBtn = document.getElementById("appPersonalLandmarkDialogSettingsBtn");
    const settingsPop = document.getElementById("appPersonalLandmarkSettingsPopover");
    const helpBtn = document.getElementById("appPersonalLandmarkDialogHelpBtn");
    const nameIn = document.getElementById("appPersonalLandmarkDialogName");
    const descIn = document.getElementById("appPersonalLandmarkDialogDesc");
    const namePanel = document.getElementById("appPersonalLandmarkDialogNamePanel");
    const descPanel = document.getElementById("appPersonalLandmarkDialogDescPanel");
    const descPreview = document.getElementById(
      "appPersonalLandmarkDialogDescPreview",
    );
    const saveBtn = document.getElementById("appPersonalLandmarkDialogSave");
    const cancelBtn = document.getElementById("appPersonalLandmarkDialogCancel");
    const slotGridEl = document.getElementById("appPersonalLandmarkDialogSlotGrid");
    if (
      !nameIn ||
      !descIn ||
      !namePanel ||
      !descPanel ||
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
      !slotGridEl
    ) {
      plmEditorDialogDepth = Math.max(0, plmEditorDialogDepth - 1);
      resolve({ action: "cancel" });
      return;
    }
    closePlmLandmarkSettingsPopover();
    const mode = spec.mode === "edit" ? "edit" : "create";
    const plmPick = {
      iconId: normalizePlmIconId(
        spec.iconId != null ? spec.iconId : PLM_DEFAULT_ICON_ID,
      ),
      colorHex: normalizePlmColorHex(
        spec.colorHex != null ? spec.colorHex : PLM_DEFAULT_COLOR_NEW,
      ),
    };

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

    function rebuildPlmIconGrids() {
      const cap = getPlmFavoritesCap();
      const favIds = getPlmOrderedFavoriteIconIds(cap);
      const allIds = [...getPlmIconCatalog()]
        .sort((a, b) =>
          (a.label || "").localeCompare(b.label || "", "fr"),
        )
        .map((x) => x.id);
      renderIconButtons(favIconsEl, favIds);
      renderIconButtons(allIconsEl, allIds);
      renderColorButtons();
      syncPlmPickerSelectionUi();
    }

    function onPlmDlgClick(ev) {
      const ib = ev.target.closest(".tam-plm-icon-btn[data-plm-icon]");
      if (ib) {
        plmPick.iconId = normalizePlmIconId(ib.getAttribute("data-plm-icon"));
        syncPlmPickerSelectionUi();
        return;
      }
      const cb = ev.target.closest(".tam-plm-color-btn[data-plm-color]");
      if (cb) {
        plmPick.colorHex = normalizePlmColorHex(
          cb.getAttribute("data-plm-color"),
        );
        syncPlmPickerSelectionUi();
      }
    }

    function onFavCapChange() {
      if (!favCapEl) return;
      savePlmFavoritesCap(favCapEl.value);
      rebuildPlmIconGrids();
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
      const importBtn = document.getElementById("appPlmBackupImportBtn");
      const fileInput = document.getElementById("appPlmBackupFileInput");
      if (importBtn && fileInput) {
        importBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          fileInput.value = "";
          fileInput.click();
        });
        fileInput.addEventListener("change", () => {
          if (fileInput.files && fileInput.files[0]) {
            tamImportBackup(fileInput.files[0]);
          }
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
    dlg.addEventListener("click", onPlmDlgClick);
    if (favCapEl) {
      favCapEl.addEventListener("change", onFavCapChange);
    }
    if (capBandEl) {
      capBandEl.addEventListener("change", onCapBandChange);
    }

    const editGroupId = spec.groupId || null;
    let initialName = spec.name != null ? String(spec.name) : "";
    if (mode === "create" && !String(initialName).trim()) {
      initialName = "G";
    }
    const initialDesc = editGroupId
      ? plmGetGroupDescription(editGroupId)
      : spec.description != null
        ? String(spec.description)
        : "";
    nameIn.value = initialName;
    descIn.value = initialDesc;
    let plmTextUi = null;
    if (typeof window.plmCreateStructuredTextUi === "function") {
      plmTextUi = window.plmCreateStructuredTextUi({
        nameEl: nameIn,
        descEl: descIn,
        namePanel,
        descPanel,
        descPreview,
        prompt: (message, defaultValue) =>
          showAppPromptDialog(TAM_APP_DIALOG_TITLE, message, defaultValue ?? ""),
        confirm: (message) =>
          showAppConfirmDialog(TAM_APP_DIALOG_TITLE, message),
        alert: (message) => tamAppAlert(message),
      });
      plmTextUi.setInitial(initialName, initialDesc);
    }
    let gridLat = Number(spec.lat);
    let gridLng = Number(spec.lng);
    if (mode === "edit" && spec.id) {
      const pivotItem = personalLandmarksList.find((x) => x.id === spec.id);
      if (pivotItem) {
        const gp = plmDisplayLatLngForLandmark(pivotItem);
        gridLat = gp.lat;
        gridLng = gp.lng;
      }
    }
    if (plmIsValidPlmLatLng(gridLat, gridLng)) {
      plmRenderSlotGrid(
        slotGridEl,
        gridLat,
        gridLng,
        editGroupId,
        mode === "edit" ? spec.id : null,
      );
    }
    let settled = false;
    function cleanupListeners() {
      saveBtn.removeEventListener("click", onSave);
      cancelBtn.removeEventListener("click", onCancel);
      nameIn.removeEventListener("keydown", onNameKeydown);
      dlg.removeEventListener("close", onClose);
      dlg.removeEventListener("click", onPlmDlgClick);
      if (favCapEl) {
        favCapEl.removeEventListener("change", onFavCapChange);
      }
      if (capBandEl) {
        capBandEl.removeEventListener("change", onCapBandChange);
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
      const name = String(nameIn.value || "").trim();
      if (!name) {
        tamAppAlert("Indiquez un nom pour le repère.");
        return;
      }
      touchPlmIconRecent(plmPick.iconId);
      const slots =
        typeof slotGridEl._plmGetSlots === "function"
          ? slotGridEl._plmGetSlots()
          : [];
      let outGroupId = editGroupId;
      if (slots.length > 0 && !outGroupId) {
        outGroupId = plmGenerateGroupId();
      }
      finish({
        action: "save",
        id: mode === "edit" ? spec.id : undefined,
        groupId: outGroupId || undefined,
        lat: spec.lat,
        lng: spec.lng,
        name,
        description: String(descIn.value || "").trim(),
        iconId: plmPick.iconId,
        colorHex: plmPick.colorHex,
        slots,
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
    requestAnimationFrame(() => {
      try {
        nameIn.focus({ preventScroll: true });
      } catch (err) {
        nameIn.focus();
      }
      nameIn.select();
    });
  });
}

async function openPersonalLandmarkMarkerEditor(id) {
  setPersonalLandmarkPlacementActive(false);
  const item = personalLandmarksList.find((x) => x.id === id);
  if (!item) return;
  const r = await openPersonalLandmarkDialog({
    mode: "edit",
    id: item.id,
    groupId: item.groupId,
    lat: item.lat,
    lng: item.lng,
    name: item.name,
    description: plmLandmarkDescriptionText(item),
    iconId: item.iconId,
    colorHex: item.colorHex,
  });
  if (r.action === "cancel") return;
  if (r.action === "save" && r.id && r.name) {
    const result = plmCommitDialogSave({ ...r, action: "save" });
    if (result.ok) {
      savePersonalLandmarksToStorage();
      redrawPersonalLandmarksLayer();
      setGpsStatus(
        result.added > 0
          ? `Repère mis à jour : ${r.name} (${result.added} repère(s) ajouté(s)).`
          : `Repère mis à jour : ${r.name}`,
      );
    }
  }
}
loadPlmGroupsFromStorage();
loadPersonalLandmarksFromStorage();
if (plmSanitizeParentLinks()) {
  savePersonalLandmarksToStorage();
}
plmSyncGroupsLayoutToZoom(true);

let marker = L.marker([43.61, 3.88], {
  icon: navIcon,
  zIndexOffset: 800,
}).addTo(map);
map.on("zoom", () => {
  plmScheduleMagneticRedraw();
  plmScheduleLabelsRefresh();
});
map.on("rotate", () => {
  plmScheduleMagneticRedraw();
  plmScheduleLabelsRefresh();
});
map.on("zoomend", () => {
  applyMapVisualProfile();
  plmSyncGroupsLayoutToZoom(true);
});
map.on("moveend", () => {
  plmScheduleLabelsRefresh();
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
    const r = await openPersonalLandmarkDialog({
      mode: "create",
      lat: ev.latlng.lat,
      lng: ev.latlng.lng,
      name: "",
      description: "",
    });
    if (r.action === "save" && r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng)) {
      const result = plmCommitDialogSave({
        action: "save",
        lat: r.lat,
        lng: r.lng,
        name: r.name,
        description: r.description,
        iconId: r.iconId,
        colorHex: r.colorHex,
        groupId: r.groupId,
        slots: r.slots || [],
      });
      if (result.ok) {
        savePersonalLandmarksToStorage();
        redrawPersonalLandmarksLayer();
        setGpsStatus(
          result.added > 0
            ? `Repère ajouté : ${r.name} (${result.added} voisin(s)).`
            : `Repère ajouté : ${r.name}`,
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

