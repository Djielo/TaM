/* simulateur SAE — fichier 3/3 : aperçu mission, simulation, carte, événements, chargement JSON.
 * S’appuie sur les fichiers 1 et 2. */

let previewMissionToken = 0;
/** Signature `pattern_id:nbArrêts` pour éviter de reconstruire le rail à chaque frame. */
let tamStopRailBuiltFor = "";
/** Dernier indice guidage pour lequel on a appliqué l’auto-scroll (mode compact uniquement). */
let tamStopRailLastAutoSnapK = null;
let tamStopRailSnapRaf = 0;
/** Après fermeture tactile par `touchend`, évite le double effet du `click` synthétique. */
let tamStopRailSuppressInnerClickUntil = 0;
/** Un seul `map.on('click')` pour réduire la liste au clic sur la carte. */
let tamStopRailMapCloseWired = false;
/** Cache des correspondances par arrêt (clé stop_id et nom normalisé). */
let tamStopRailCorrespondenceByStop = null;
/** Temps de parcours issus du GTFS (voyage représentatif du pattern) pour le rail. */
let tamStopRailGtfsSchedule = { ok: false, legSec: [], cumArriveSec: [] };
/** Cache court des ETA temps réel (popups correspondances sur le rail, etc.). */
const TAM_REALTIME_API_BASE = "https://tam-sae-jielo.duckdns.org";
const TAM_STOP_RAIL_ARRIVALS_CACHE_MS = 20_000;
const tamStopRailArrivalCache = new Map();
/** Temps réel pour la ligne courante (route_short_name) aux arrêts à venir. */
let tamStopRailCurrentLineRtCandidatesByStopIdx = new Map();
let tamStopRailCurrentLineRtRefreshGen = 0;
let tamStopRailCurrentLineRtScheduleTid = 0;
let tamStopRailCurrentLineRtPeriodicAt = 0;

/** Au-delà : le geste n’est pas un « tap » (défilement, etc.). */
const TAM_STOP_RAIL_TAP_MOVE_MAX_SQ = 28 * 28;

async function previewSelectedMission() {
  const p = selectedPattern();
  if (!p) return;
  if (missionViolatesTemporaryDeviationLock(p)) {
    alertAndRevertMissionSelectorsForTemporaryLock(
      "Une déviation temporaire est en cours. Rétablissez le mode d'exploitation du début de mission avant de changer de ligne ou de variante.",
    );
    return;
  }
  const token = ++previewMissionToken;
  running = false;
  await setMission(p, {
    previewOnly: true,
    preserveTemporarySnapshot: restoringTemporarySnapshot,
  });
  if (token !== previewMissionToken) return;
  // Un aperçu ne doit jamais lancer la simulation.
  running = false;
  lastRafTime = 0;
}

function finalizeInitialOpsMode() {
  opsState.mode = recomputeOpsMode();
  opsState.initialMode = opsState.mode;
  opsState.returnMode = opsState.mode;
  applyOpsStateUi();
  appendOpsLog("mission_start", "Mode initial enregistre");
}

function applyModeFlags(mode) {
  const m = coerceOpsMode(mode);
  opsState.manualActive = m === OPS_MODE.MANUEL;
}

function normalizeText(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeStopName(s) {
  return normalizeText(s).replace(/['’]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Corrections de prononciation locales pour le TTS navigateur.
 * Clé = nom d'arrêt normalisé (`normalizeStopName`), valeur = texte à prononcer.
 */
const STOP_TTS_OVERRIDES = Object.freeze({
  [normalizeStopName("Le Grand M")]: "Le Grand t'aime",
  [normalizeStopName("CNRS - Zoo de Lunaret")]: "C N R S - Zoo de Lunaret",
});

/**
 * Corrections génériques de lecture (abréviations / formes courantes GTFS).
 * Appliquées après les overrides spécifiques.
 */
const STOP_TTS_REGEX_OVERRIDES = Object.freeze([
  [/\bMas\b/gi, "Masse"],
  [/\bSt\b/gi, "Saint"],
  [/\bSte\b/gi, "Sainte"],
  [/\b1er\b/gi, "premier"],
]);

function getStopSpeechName(stopName) {
  const raw = String(stopName || "").trim();
  if (!raw) return raw;
  const key = normalizeStopName(raw);
  let out = STOP_TTS_OVERRIDES[key] || raw;
  for (const [rx, repl] of STOP_TTS_REGEX_OVERRIDES) {
    out = out.replace(rx, repl);
  }
  return out;
}

function recomputeSkippedStopsForCurrentMission() {
  skippedStopIdSet = new Set();
  if (!currentPattern?.stops) return;

  if (
    opsState.manualActive &&
    opsState.manualProfile &&
    opsState.baseCoordinates
  ) {
    const base = opsState.baseCoordinates;
    const cum = buildCumMetersForCoords(base);
    const ranges = normalizeBypassRangesOnBase(opsState.manualProfile);
    const edgeMarginMeters = 8;
    for (const st of currentPattern.stops) {
      const lat = Number(st?.lat);
      const lon = Number(st?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const d = distanceAlongCoordsForLatLng(base, cum, lat, lon);
      for (const rg of ranges) {
        const lo = rg[0];
        const hi = rg[1];
        if (d > lo + edgeMarginMeters && d < hi - edgeMarginMeters) {
          skippedStopIdSet.add(String(st.stop_id || ""));
        }
      }
    }
  }

  const overrides = opsState.manualStopOverrides || {};
  for (const st of currentPattern.stops) {
    const sid = String(st?.stop_id || "");
    if (!sid || !Object.prototype.hasOwnProperty.call(overrides, sid)) continue;
    if (overrides[sid]) skippedStopIdSet.add(sid);
    else skippedStopIdSet.delete(sid);
  }
}

function getServedStopIndices() {
  const stops = currentPattern?.stops || [];
  if (!stops.length) return [];
  const hasSkipped = skippedStopIdSet.size > 0;
  const skipModeActive = opsState.manualActive || hasSkipped;
  const arr = [];
  for (let i = 0; i < stops.length; i++) {
    const sid = String(stops[i]?.stop_id || "");
    const skipped = skipModeActive && skippedStopIdSet.has(sid);
    if (!skipped) arr.push(i);
  }
  return arr.length >= 2 ? arr : stops.map((_, i) => i);
}

/** Libellé affiché et annoncé pour un arrêt provisoire (stocké : suffixe seul après normalisation de la boîte de saisie). */
function provisionalStopPublicLabel(stop_name) {
  const bare = String(stop_name ?? "").trim() || "Arrêt provisoire";
  if (/^arrêt provisoire\s*:\s*/i.test(bare)) return bare;
  return `Arrêt provisoire : ${bare}`;
}

function collectMergedGuideEntriesRaw() {
  const stops = currentPattern?.stops || [];
  const list = [];
  for (let i = 0; i < stops.length; i++) {
    const lat = Number(stops[i]?.lat);
    const lon = Number(stops[i]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    list.push({
      kind: "gtfs",
      patternIdx: i,
      stop_id: String(stops[i]?.stop_id || ""),
      name: stops[i]?.stop_name || "-",
      // Important : on part des mètres "bruts" (projection sur la polyligne) et on normalise
      // une seule fois dans `buildServedGuideSnapshotNormalized()`. Si on réutilise `stopMetersAlong`
      // ici (déjà normalisé), on finit par normaliser deux fois et on désynchronise l'UI
      // ("prochain arrêt" / pastilles vertes / remplissage).
      metersRaw: distanceAlongPathForLatLng(lat, lon),
      lat,
      lon,
    });
  }
  for (const ps of opsState.provisionalStops || []) {
    const lat = Number(ps.lat);
    const lon = Number(ps.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    list.push({
      kind: "prov",
      id: ps.id,
      name: provisionalStopPublicLabel(ps.stop_name),
      metersRaw: distanceAlongPathForLatLng(lat, lon),
      lat,
      lon,
    });
  }
  list.sort((a, b) => {
    if (a.metersRaw !== b.metersRaw) return a.metersRaw - b.metersRaw;
    if (a.kind !== b.kind) return a.kind === "gtfs" ? -1 : 1;
    const ai = a.kind === "gtfs" ? a.patternIdx : 999999;
    const bi = b.kind === "gtfs" ? b.patternIdx : 999999;
    return ai - bi;
  });
  return list;
}

function mergedEntryIsServedForGuide(e) {
  if (e.kind === "prov") return true;
  const hasSkipped = skippedStopIdSet.size > 0;
  const skipModeActive = opsState.manualActive || hasSkipped;
  if (!skipModeActive) return true;
  return !skippedStopIdSet.has(e.stop_id);
}

function getServedMergedEntriesRaw() {
  return collectMergedGuideEntriesRaw().filter(mergedEntryIsServedForGuide);
}

function buildServedGuideSnapshotNormalized() {
  const served = getServedMergedEntriesRaw();
  if (served.length < 2) return [];
  const raw = served.map((e) => e.metersRaw);
  const norm = normalizeStopMeters(raw, pathTotalMeters);
  return served.map((e, i) => ({
    kind: e.kind,
    patternIdx: e.patternIdx,
    stop_id: e.stop_id,
    id: e.id,
    name: e.name,
    lat: e.lat,
    lon: e.lon,
    meters: norm[i],
  }));
}

function rebuildActiveGuideStops() {
  servedGuideSnapshot = buildServedGuideSnapshotNormalized();
  if (servedGuideSnapshot.length >= 2) {
    activeStopMetersForGuide = servedGuideSnapshot.map((e) => e.meters);
    return;
  }
  servedGuideSnapshot = [];
  const served = getServedStopIndices();
  activeStopMetersForGuide = served
    .map((i) => stopMetersAlong[i])
    .filter((x) => Number.isFinite(x));
  if (activeStopMetersForGuide.length < 2) {
    activeStopMetersForGuide = [...stopMetersAlong];
  }
}

function mkGtfsGuideSlot(idx) {
  const stops = currentPattern?.stops || [];
  const st = stops[idx];
  if (!st) return null;
  return {
    kind: "gtfs",
    patternIdx: idx,
    stop_id: String(st.stop_id || ""),
    name: st.stop_name || "-",
    meters: stopMetersAlong[idx] || 0,
    lat: Number(st.lat),
    lon: Number(st.lon),
  };
}

/** Courant / suivant dans la liste guidage (GTFS + arrêts provisoires). */
function getCurrentAndNextServedGuideSlots(d) {
  const stops = currentPattern?.stops || [];
  if (!stops.length || !stopMetersAlong.length) {
    return { curr: null, next: null };
  }
  if (servedGuideSnapshot.length >= 2) {
    let pos = 0;
    for (let p = 0; p < servedGuideSnapshot.length; p++) {
      if ((servedGuideSnapshot[p].meters || 0) <= d + 0.5) pos = p;
    }
    const curr = servedGuideSnapshot[pos];
    const next =
      servedGuideSnapshot[Math.min(pos + 1, servedGuideSnapshot.length - 1)];
    return { curr, next };
  }
  const served = getServedStopIndices();
  let pos = 0;
  for (let p = 0; p < served.length; p++) {
    const idx = served[p];
    if ((stopMetersAlong[idx] || 0) <= d + 0.5) pos = p;
  }
  const currIdx = served[pos] ?? 0;
  const nextIdx = served[Math.min(pos + 1, served.length - 1)] ?? currIdx;
  return {
    curr: mkGtfsGuideSlot(currIdx),
    next: mkGtfsGuideSlot(nextIdx),
  };
}

function drawSkippedStopsOverlay() {
  skippedStopsLayer.clearLayers();
  const hasSkipped = skippedStopIdSet.size > 0;
  const skipModeActive = opsState.manualActive || hasSkipped;
  if (!currentPattern?.stops || !skipModeActive) return;
  const p = getMapVisualProfile();
  for (const st of currentPattern.stops) {
    const sid = String(st?.stop_id || "");
    if (!skippedStopIdSet.has(sid)) continue;
    const mk = L.circleMarker([st.lat, st.lon], {
      radius: p.skippedRadius,
      color: "#c62828",
      fillColor: "#ef5350",
      fillOpacity: 0.95,
      weight: p.skippedStroke,
      interactive: false,
      bubblingMouseEvents: false,
    });
    /* En saisie arrêt non desservi, une seule infobulle ouverte sur la pastille focalisée (#allStopsLayer). */
    if (!opsState.nonServedEditActive) {
      mk.bindTooltip(`Arrêt non desservi: ${st.stop_name}`, {
        direction: "top",
        opacity: 0.95,
      });
    }
    mk.addTo(skippedStopsLayer);
  }
}

function drawProvisionalStopsOverlay() {
  provisionalStopsLayer.clearLayers();
  if (!opsState.provisionalStops?.length || !currentPattern) {
    return;
  }
  const p = getMapVisualProfile();
  const r = Math.max(p.stopRadius + 1, (p.stopRadius + p.skippedRadius) / 2);
  for (const ps of opsState.provisionalStops) {
    const lat = Number(ps.lat);
    const lon = Number(ps.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const mk = L.circleMarker([lat, lon], {
      radius: r,
      color: "#e65100",
      fillColor: "#ffb74d",
      fillOpacity: 0.92,
      weight: p.stopStroke + 0.35,
    });
    mk.bindTooltip(`Arrêt provisoire : ${ps.stop_name || "-"}`, {
      direction: "top",
      opacity: 0.95,
    });
    mk.on("click", async (ev) => {
      if (!opsState.provisionalEditActive) return;
      if (typeof L !== "undefined" && L.DomEvent?.stopPropagation) {
        L.DomEvent.stopPropagation(ev);
      } else if (ev?.originalEvent?.stopPropagation) {
        ev.originalEvent.stopPropagation();
      }
      if (
        !(await showAppConfirmDialog(
          TAM_APP_DIALOG_TITLE,
          `Retirer l’arrêt provisoire « ${ps.stop_name || "-"} » ?`,
        ))
      ) {
        return;
      }
      opsState.provisionalStops = opsState.provisionalStops.filter(
        (x) => x.id !== ps.id,
      );
      rebuildActiveGuideStops();
      drawProvisionalStopsOverlay();
      updateStopToStopOverlay();
      updateStats();
      resyncVoixForPosition(distanceAlongPathMeters);
      refreshProvisionalUi();
      refreshTemporaryDeviationUi();
      setGpsStatus("Arrêt provisoire retiré.");
    });
    mk.addTo(provisionalStopsLayer);
  }
}

function drawAllStopsOverlay() {
  allStopsLayer.clearLayers();
  if (!currentPattern?.stops) return;
  const p = getMapVisualProfile();
  for (const st of currentPattern.stops) {
    const lat = Number(st?.lat);
    const lon = Number(st?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const sid = String(st?.stop_id || "");
    const isSkipped = skippedStopIdSet.has(sid);
    const marker = L.circleMarker([lat, lon], {
      radius: p.stopRadius,
      color: isSkipped ? "#c62828" : "#b71c1c",
      fillColor: isSkipped ? "#ef5350" : "#e53935",
      fillOpacity: 0.9,
      weight: p.stopStroke,
    });
    const nonServedPickMode =
      opsState.manualActive && opsState.nonServedEditActive;
    const focusThisStop = nonServedPickMode && nonServedEditFocusStopId === sid;
    marker
      .bindTooltip(
        isSkipped
          ? `Arrêt non desservi : ${st.stop_name || "-"}`
          : `Arrêt : ${st.stop_name || "-"}`,
        {
          direction: "top",
          opacity: 0.95,
          permanent: !!focusThisStop,
          sticky: !focusThisStop,
          interactive: !!focusThisStop,
          className: focusThisStop ? "tam-stop-edit-tooltip" : "",
        },
      )
      .addTo(allStopsLayer);
    if (focusThisStop && typeof marker.openTooltip === "function") {
      requestAnimationFrame(() => {
        try {
          marker.openTooltip();
        } catch (e) {
          /* ignore */
        }
      });
    }
    marker.on("click", (ev) => {
      if (!(opsState.manualActive && opsState.nonServedEditActive)) return;
      if (typeof L !== "undefined" && L.DomEvent?.stopPropagation) {
        L.DomEvent.stopPropagation(ev);
      } else if (ev?.originalEvent?.stopPropagation) {
        ev.originalEvent.stopPropagation();
      }
      if (typeof performance !== "undefined") {
        nonServedEditSuppressMapClearUntil = performance.now() + 650;
      }
      nonServedEditFocusStopId = sid;
      const current = skippedStopIdSet.has(sid);
      const next = !current;
      opsState.manualStopOverrides[sid] = next;
      refreshMissionStopVisualsAndStats();
      setGpsStatus(
        next
          ? `Arrêt non desservi activé: ${st.stop_name || "-"}`
          : `Arrêt desservi réactivé: ${st.stop_name || "-"}`,
      );
    });
  }
}

async function applyTraceForOpsMode(mode, opts) {
  if (!currentPattern) return;
  const o = opts || {};
  const oldTotal = pathTotalMeters || 1;
  const oldD = distanceAlongPathMeters || 0;
  const ratio = Math.max(0, Math.min(1, oldD / oldTotal));
  let coords =
    mode === OPS_MODE.MANUEL
      ? opsState.modeCoordinates[OPS_MODE.MANUEL] || opsState.baseCoordinates
      : opsState.baseCoordinates;
  if (!coords || coords.length < 2) return;
  activeCoordinates = coords;
  rebuildPathMetrics(activeCoordinates);
  trimActivePathToPatternStops(currentPattern);
  stopMetersAlong = buildStopMetersAlong(currentPattern);
  rebuildActiveGuideStops();
  fullLine.setLatLngs(activeCoordinates);
  const newD = Math.min(pathTotalMeters, Math.max(0, ratio * pathTotalMeters));
  distanceAlongPathMeters = newD;
  redrawDoneLineAtDistance(distanceAlongPathMeters);
  updateMapNavigation({
    centerCamera: o.centerCamera !== false,
    zoom: map.getZoom(),
  });
  updateStopToStopOverlay();
  drawProvisionalStopsOverlay();
  updateManualDeviationVisual(mode);
  updateStats();
}

function fillSelect(selectEl, values, labelFn) {
  selectEl.innerHTML = "";
  values.forEach((item, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = labelFn(item, index);
    selectEl.appendChild(opt);
  });
}

function lineColorHex(raw) {
  const v = String(raw || "")
    .trim()
    .replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(v)) {
    return null;
  }
  return `#${v}`;
}

/**
 * Lignes au fond souvent très clair (données GTFS) : libellé en foncé pour le contraste.
 * T3 (tram) + bus listés.
 */
const LINE_LABEL_DARK_TEXT_NUMERIC = new Set([
  "8",
  "10",
  "11",
  "14",
  "17",
  "19",
  "21",
  "22",
  "30",
  "33",
  "40",
  "43",
  "52",
  "53",
]);

function lineLabelPrefersDarkText(item) {
  if (!item) {
    return false;
  }
  const code = String(item.route_short_name || "").trim();
  if (String(item.route_type) === "0" && code === "3") {
    return true;
  }
  return LINE_LABEL_DARK_TEXT_NUMERIC.has(code);
}

function lineLabelContrastTextColor(item) {
  if (lineLabelPrefersDarkText(item)) {
    return "#1b1f24";
  }
  return "#ffffff";
}

/**
 * Même logique de couleurs qu’en bureau : option native (PC) + pastilles
 * (mobile, sélecteur custom).
 * @param {"option"|"row"|"trigger"|"missionSelect"|"contextPill"|"routePlannerPill"} context
 */
function applyLineColorStyling(el, item, context) {
  const bg =
    forcedLineColor(item?.route_short_name) || lineColorHex(item?.route_color);
  if (bg) {
    const tx = lineLabelContrastTextColor(item);
    el.style.backgroundColor = bg;
    el.style.color = tx;
    el.style.setProperty("-webkit-text-fill-color", tx);
    if (context === "routePlannerPill") {
      el.style.fontWeight = "";
    } else {
      el.style.fontWeight = "700";
    }
    if (context === "missionSelect") {
      el.style.border = "1px solid rgba(0, 0, 0, 0.2)";
      /* Bande couleur ligne uniquement sur le menu, pas sur le label (évite le « rose » à côté du 2 / 3). */
      el.style.borderLeft = `4px solid ${bg}`;
      el.classList.add("line-themed-select");
    } else if (context === "routePlannerPill") {
      el.style.border = "1px solid rgba(0, 0, 0, 0.2)";
      el.style.boxSizing = "border-box";
    } else if (context === "contextPill") {
      el.style.padding = "3px 10px";
      el.style.borderRadius = "6px";
      el.style.display = "inline-block";
      el.style.verticalAlign = "baseline";
      el.style.flexShrink = "0";
      el.style.lineHeight = "1.2";
      el.style.border = "1px solid rgba(0, 0, 0, 0.12)";
      el.style.boxSizing = "border-box";
    }
    return;
  }
  el.style.backgroundColor = "";
  el.style.color = "";
  el.style.fontWeight = "";
  el.style.removeProperty("-webkit-text-fill-color");
  if (context === "missionSelect") {
    el.style.border = "";
    el.style.borderLeft = "";
    el.classList.remove("line-themed-select");
  }
  if (context === "contextPill") {
    el.style.padding = "";
    el.style.borderRadius = "";
    el.style.display = "";
    el.style.verticalAlign = "";
    el.style.flexShrink = "";
    el.style.lineHeight = "";
    el.style.border = "";
    el.style.boxSizing = "";
  }
  if (context === "routePlannerPill") {
    el.style.border = "";
    el.style.boxSizing = "";
  }
  if (context === "row") {
    el.style.backgroundColor = "#e8ecf1";
    el.style.color = "#1b1f24";
    el.style.fontWeight = "600";
  } else if (context === "trigger") {
    el.style.backgroundColor = "#ffffff";
    el.style.color = "#1b1f24";
    el.style.fontWeight = "600";
  } else if (context === "missionSelect") {
    el.style.backgroundColor = "#ffffff";
    el.style.color = "#1b1f24";
  } else if (context === "routePlannerPill") {
    el.style.backgroundColor = "#e8ecf1";
    el.style.color = "#1b1f24";
    el.style.fontWeight = "";
    el.style.setProperty("-webkit-text-fill-color", "#1b1f24");
    el.style.border = "1px solid #ccd3db";
    el.style.boxSizing = "border-box";
  } else if (context === "contextPill") {
    el.style.backgroundColor = "#e8ecf1";
    el.style.color = "#1b1f24";
    el.style.fontWeight = "600";
    el.style.padding = "3px 10px";
    el.style.borderRadius = "6px";
    el.style.display = "inline-block";
    el.style.verticalAlign = "baseline";
    el.style.flexShrink = "0";
    el.style.lineHeight = "1.2";
    el.style.border = "1px solid #ccd3db";
    el.style.boxSizing = "border-box";
  }
}

function applyLineThemeToMissionSubselects(item) {
  if (!headsignSelect || !variantSelect) {
    return;
  }
  const payload =
    item && item.route_short_name != null ? item : { route_short_name: "" };
  applyLineColorStyling(headsignSelect, payload, "missionSelect");
  applyLineColorStyling(variantSelect, payload, "missionSelect");
  const hf = document.getElementById("headsignField");
  const vf = document.getElementById("variantField");
  if (hf) {
    hf.style.boxShadow = "";
  }
  if (vf) {
    vf.style.boxShadow = "";
  }
}

function forcedLineColor(code) {
  const key = String(code || "")
    .trim()
    .toUpperCase();
  if (key === "A") return "#931731";
  if (key === "5") return "#277232";
  return null;
}

function isTramDisplayLine(item) {
  const code = String(item.route_short_name || "");
  const n = Number(code);
  return item.route_type === "0" && Number.isInteger(n) && n >= 1 && n <= 5;
}

function linePriority(item) {
  if (isTramDisplayLine(item)) return 0; // T1..T5
  if (String(item.route_short_name) === "A") return 1; // Navette A
  if (/^\d+$/.test(String(item.route_short_name))) return 2; // bus numeriques
  return 3; // reste
}

function displayLineLabel(item) {
  const code = String(item.route_short_name);
  if (isTramDisplayLine(item)) return `T${code}`;
  return code;
}

/** Libellé pour les phrases « Prenez … » dans le résumé d’itinéraire carte.
 * @param {string|null|undefined} branchLetter « A » ou « B » (boucle T4 / même base de headsign), sinon omis. */
function routePlannerTakeLinePhrase(routeCode, branchLetter) {
  const code = String(routeCode || "").trim();
  const br = branchLetter == null ? "" : String(branchLetter).trim().toUpperCase().slice(0, 1);
  const suffix = br === "A" || br === "B" ? br : "";
  const items = Array.isArray(lineOptions) ? lineOptions : [];
  const item = items.find((x) => String(x?.route_short_name || "").trim() === code);
  const lab = item ? displayLineLabel(item) : code;
  if (item && isTramDisplayLine(item)) {
    return suffix ? `le ${lab}${suffix}` : `le ${lab}`;
  }
  return suffix ? `la ligne ${lab}${suffix}` : `la ligne ${lab}`;
}

/** Normalise la base d’un headsign pour repérer une même destination (A vs B). */
function routePlannerNormHeadsignBranchBase(base) {
  return String(base || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/** Extrait « … A » / « … B » en fin de trip_headsign (une lettre seule). */
function headsignAbBranchSplit(headsign) {
  const s = String(headsign || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!s) return null;
  const m = /\s([AB])\s*$/i.exec(s);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const base = s.slice(0, m.index).trim();
  if (!base) return null;
  return { base, letter };
}

/**
 * T4 en boucle : selon la TaM, branche A = Corum puis Les Aubes ; branche B = l’inverse.
 * Déduction uniquement sur l’ordre des arrêts du pattern GTFS (pas sur trip_headsign).
 */
function t4BranchLetterFromPatternStops(p) {
  const route = String(p?.route_short_name || "").trim();
  if (route !== "4") return "";
  const stops = Array.isArray(p?.stops) ? p.stops : [];
  let iCorum = -1;
  let iLesAubes = -1;
  for (let i = 0; i < stops.length; i++) {
    const nk = normalizeStopName(stops[i]?.stop_name || stops[i]?.name || "");
    if (iCorum < 0 && nk.includes("corum")) iCorum = i;
    if (iLesAubes < 0 && nk.includes("les aubes")) iLesAubes = i;
  }
  if (iCorum < 0 || iLesAubes < 0) return "";
  if (iCorum < iLesAubes) return "A";
  if (iLesAubes < iCorum) return "B";
  return "";
}

function routePlannerHeadsignBranchPairMeta(routeCode, headsign) {
  const code = String(routeCode || "").trim();
  const cur = headsignAbBranchSplit(headsign);
  if (!code || !cur) return null;
  const baseKey = routePlannerNormHeadsignBranchBase(cur.base);
  const otherLetter = cur.letter === "A" ? "B" : "A";
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  for (const p of patterns) {
    if (String(p?.route_short_name || "").trim() !== code) continue;
    const sp = headsignAbBranchSplit(p?.headsign || "");
    if (!sp) continue;
    if (sp.letter !== otherLetter) continue;
    if (routePlannerNormHeadsignBranchBase(sp.base) !== baseKey) continue;
    return { base: cur.base, letter: cur.letter };
  }
  return null;
}

function sortLineItemsForDisplay(items) {
  return [...items].sort((a, b) => {
    const pa = linePriority(a);
    const pb = linePriority(b);
    if (pa !== pb) return pa - pb;
    const aCode = String(a.route_short_name || "");
    const bCode = String(b.route_short_name || "");
    if (/^\d+$/.test(aCode) && /^\d+$/.test(bCode)) {
      return Number(aCode) - Number(bCode);
    }
    return aCode.localeCompare(bCode, "fr");
  });
}

/** Tram T1–T5 + navette A : première rangée du panneau itinéraire (carte). */
function isRoutePlannerTramNavetteFirstRowItem(item) {
  return (
    isTramDisplayLine(item) ||
    String(item.route_short_name || "").trim().toUpperCase() === "A"
  );
}

function addStopCorrespondenceEntry(store, key, routeItem) {
  if (!key) return;
  if (!store.has(key)) {
    store.set(key, new Map());
  }
  const byCode = store.get(key);
  const code = String(routeItem.route_short_name || "").trim();
  if (!code) return;
  const existing = byCode.get(code);
  if (!existing) {
    byCode.set(code, routeItem);
    return;
  }
  if (!existing.route_color && routeItem.route_color) {
    byCode.set(code, routeItem);
  }
}

function ensureTamStopRailCorrespondenceCache() {
  if (tamStopRailCorrespondenceByStop) {
    return tamStopRailCorrespondenceByStop;
  }
  const store = new Map();
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  for (const p of patterns) {
    const routeCode = String(p?.route_short_name || "").trim();
    if (!routeCode) continue;
    const routeItem = {
      route_short_name: routeCode,
      route_type: String(p?.route_type || ""),
      route_color: String(p?.route_color || ""),
    };
    const stops = Array.isArray(p?.stops) ? p.stops : [];
    for (const st of stops) {
      const stopId = String(st?.stop_id || "").trim();
      const stopNameKey = normalizeStopName(st?.stop_name || st?.name || "");
      if (stopId) {
        addStopCorrespondenceEntry(store, `id:${stopId}`, routeItem);
      }
      if (stopNameKey) {
        addStopCorrespondenceEntry(store, `name:${stopNameKey}`, routeItem);
      }
    }
  }

  const out = new Map();
  for (const [key, byCode] of store.entries()) {
    out.set(key, sortLineItemsForDisplay([...byCode.values()]));
  }
  tamStopRailCorrespondenceByStop = out;
  return tamStopRailCorrespondenceByStop;
}

function getStopCorrespondenceLines(stopObj) {
  const cache = ensureTamStopRailCorrespondenceCache();
  const currentRouteCode = String(
    currentPattern?.route_short_name || "",
  ).trim();
  const stopId = String(stopObj?.stop_id || "").trim();
  const stopNameKey = normalizeStopName(
    stopObj?.stop_name || stopObj?.name || "",
  );
  const merged = new Map();
  if (stopId) {
    const byId = cache.get(`id:${stopId}`) || [];
    for (const item of byId) {
      merged.set(String(item.route_short_name || ""), item);
    }
  }
  if (stopNameKey) {
    const byName = cache.get(`name:${stopNameKey}`) || [];
    for (const item of byName) {
      const code = String(item.route_short_name || "");
      if (!merged.has(code)) {
        merged.set(code, item);
      }
    }
  }
  const filtered = [...merged.values()].filter((item) => {
    const code = String(item?.route_short_name || "").trim();
    return code && code !== currentRouteCode;
  });
  return sortLineItemsForDisplay(filtered);
}

function styleStopCorrespondenceBadge(el, routeItem) {
  applyLineColorStyling(el, routeItem, "contextPill");
  el.style.padding = "1px 5px";
  el.style.borderRadius = "4px";
  el.style.fontSize = "10px";
  el.style.fontWeight = "700";
  el.style.lineHeight = "1.1";
}

function stopMatchesPatternStop(stopObj, patternStop) {
  const aId = String(stopObj?.stop_id || "").trim();
  const bId = String(patternStop?.stop_id || "").trim();
  if (aId && bId && aId === bId) return true;
  const aName = normalizeStopName(stopObj?.stop_name || stopObj?.name || "");
  const bName = normalizeStopName(
    patternStop?.stop_name || patternStop?.name || "",
  );
  return !!aName && !!bName && aName === bName;
}

/** Distance à vol d’oiseau entre deux points WGS84 (arrêts GTFS). */
function approximateGeoDistMeters(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Infinity;
  }
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function gpsLatLngOrNull() {
  if (Array.isArray(lastGpsLatLng) && lastGpsLatLng.length >= 2) {
    const lat = Number(lastGpsLatLng[0]);
    const lon = Number(lastGpsLatLng[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon];
  }
  return null;
}

async function getOneShotGeolocationLatLngOrNull() {
  if (!navigator.geolocation) return null;
  return await new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos?.coords?.latitude);
          const lon = Number(pos?.coords?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return resolve(null);
          resolve([lat, lon]);
        },
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 9000 },
      );
    } catch {
      resolve(null);
    }
  });
}

function ensureTamRouteUiEls() {
  return {
    wrap: document.getElementById("tamRouteUi"),
    panel: document.getElementById("tamRoutePanel"),
    mode: document.getElementById("mapHudRouteMode"),
    lineBlock: document.getElementById("mapHudRouteLineBlock"),
    stopBlock: document.getElementById("mapHudRouteStopBlock"),
    linePills: document.getElementById("mapHudRouteLinePills"),
    line: document.getElementById("mapHudRouteLine"),
    lineStop: document.getElementById("mapHudRouteLineStop"),
    stop: document.getElementById("mapHudRouteStop"),
    go: document.getElementById("mapHudRouteGoBtn"),
    close: document.getElementById("mapHudRouteCloseBtn"),
    result: document.getElementById("mapHudRouteResult"),
  };
}

function setTamRouteUiVisible(visible) {
  const els = ensureTamRouteUiEls();
  if (!els.wrap) return;
  els.wrap.classList.toggle("hidden", !visible);
  els.wrap.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible && els.panel) els.panel.classList.remove("show");
}

function tamRouteUiIsVisible() {
  const els = ensureTamRouteUiEls();
  return !!els.wrap && !els.wrap.classList.contains("hidden");
}

function routePanelSetMode(mode) {
  const els = ensureTamRouteUiEls();
  if (!els.mode || !els.lineBlock || !els.stopBlock) return;
  const m = String(mode || "stop");
  const isLine = m === "line";
  els.lineBlock.hidden = !isLine;
  els.stopBlock.hidden = isLine;
  els.mode.value = isLine ? "line" : "stop";
}

function populateRoutePlannerSelects() {
  const els = ensureTamRouteUiEls();
  if (!els.line || !els.lineStop || !els.stop || !els.linePills) return;
  const idx = buildRoutePlannerIndexes();

  const routeItemByCode = new Map();
  for (const it of lineOptions || []) {
    const c = String(it?.route_short_name || "").trim();
    if (!c) continue;
    if (!routeItemByCode.has(c)) routeItemByCode.set(c, it);
  }

  els.line.innerHTML = "";
  const codes = [];
  for (const item of lineOptions || []) {
    const code = String(item?.route_short_name || "").trim();
    if (!code) continue;
    codes.push(code);
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `Ligne ${code}`;
    els.line.appendChild(opt);
  }

  // Vignettes : un seul bloc grille pour tout le réseau TaM (T1…A puis 6…53, avec retour à la ligne forcé),
  // puis barre de séparation et « Autres lignes » — même logique visuelle partout, sans défilement horizontal.
  const uniqueRouteItems = sortLineItemsForDisplay(
    [...new Set(codes)]
      .map((c) => routeItemByCode.get(String(c || "").trim()))
      .filter(Boolean),
  );
  const tamRouteItems = uniqueRouteItems.filter((it) =>
    isTamCoreLineCode(it.route_short_name),
  );
  const tamFirstRowItems = sortLineItemsForDisplay(
    tamRouteItems.filter(isRoutePlannerTramNavetteFirstRowItem),
  );
  const tamGridItems = sortLineItemsForDisplay(
    tamRouteItems.filter((it) => !isRoutePlannerTramNavetteFirstRowItem(it)),
  );
  const otherRouteItems = uniqueRouteItems.filter(
    (it) => !isTamCoreLineCode(it.route_short_name),
  );
  els.linePills.innerHTML = "";

  const addLinePillButtons = (groupEl, items) => {
    for (const routeItem of items) {
      const code = String(routeItem.route_short_name || "").trim();
      if (!code) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tam-route-ui__linePillBtn";
      btn.dataset.routeCode = code;
      btn.setAttribute("role", "listitem");
      const badge = document.createElement("span");
      badge.className = "mission-context-pill tam-route-ui__linePillBadge";
      badge.textContent = displayLineLabel(routeItem) || "?";
      applyLineColorStyling(badge, routeItem, "routePlannerPill");
      btn.appendChild(badge);
      btn.addEventListener("click", () => {
        els.line.value = code;
        fillLineStops(code);
        syncActiveLinePill();
      });
      groupEl.appendChild(btn);
    }
  };

  const addLinePillGroup = (parent, items, opts) => {
    const isSecondary = !!(opts && opts.isSecondary);
    const ariaLabel = (opts && opts.ariaLabel) || "Lignes";
    if (!items.length) return;
    const group = document.createElement("div");
    let groupClass =
      "tam-route-ui__linePillsGroup tam-route-ui__linePillsGroup--grid";
    if (isSecondary) {
      groupClass += " tam-route-ui__linePillsGroup--secondary";
    }
    group.className = groupClass;
    group.setAttribute("role", "list");
    group.setAttribute("aria-label", ariaLabel);
    addLinePillButtons(group, items);
    parent.appendChild(group);
  };

  if (tamRouteItems.length) {
    const tamGroup = document.createElement("div");
    tamGroup.className =
      "tam-route-ui__linePillsGroup tam-route-ui__linePillsGroup--grid";
    tamGroup.setAttribute("role", "list");
    tamGroup.setAttribute("aria-label", "Lignes du réseau TaM");
    addLinePillButtons(tamGroup, tamFirstRowItems);
    if (tamFirstRowItems.length && tamGridItems.length) {
      const brk = document.createElement("span");
      brk.className = "tam-route-ui__linePillsGridBreak";
      brk.setAttribute("aria-hidden", "true");
      tamGroup.appendChild(brk);
    }
    addLinePillButtons(tamGroup, tamGridItems);
    els.linePills.appendChild(tamGroup);
  }

  addLinePillGroup(els.linePills, otherRouteItems, {
    isSecondary: tamRouteItems.length > 0,
    ariaLabel: "Autres lignes",
  });

  els.stop.innerHTML = "";
  for (const st of idx.stopDestOptions) {
    const opt = document.createElement("option");
    opt.value = st.value;
    opt.textContent = st.label;
    els.stop.appendChild(opt);
  }

  const fillLineStops = (code) => {
    const c = String(code || "").trim();
    const set = idx.stopsByRoute.get(c) || new Set();
    const stops = [...set]
      .map((sid) => idx.stopsById.get(sid))
      .filter(Boolean)
      .sort((a, b) =>
        String(a.stop_name).localeCompare(String(b.stop_name), "fr"),
      );
    els.lineStop.innerHTML = "";
    const any = document.createElement("option");
    any.value = "";
    any.textContent = "Peu importe l’arrêt";
    els.lineStop.appendChild(any);

    // Si un même libellé d’arrêt apparaît plusieurs fois sur la ligne
    // (deux quais / deux sens), on ajoute la direction (headsign) entre parenthèses.
    const countByName = new Map();
    for (const st of stops) {
      const nm = String(st.stop_name || "").trim();
      if (!nm) continue;
      countByName.set(nm, (countByName.get(nm) || 0) + 1);
    }
    const needsDirByName = new Set(
      [...countByName.entries()].filter(([, ct]) => ct > 1).map(([n]) => n),
    );

    const stopsIdSet = new Set(stops.map((s) => String(s.stop_id || "").trim()));
    const headsignByStopId = new Map();
    for (const sid of stopsIdSet) headsignByStopId.set(sid, new Set());
    const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
    for (const p of patterns) {
      if (String(p?.route_short_name || "").trim() !== c) continue;
      const hs = String(p?.headsign || "").trim();
      if (!hs) continue;
      const ps = Array.isArray(p?.stops) ? p.stops : [];
      for (const s of ps) {
        const psid = String(s?.stop_id || "").trim();
        if (!headsignByStopId.has(psid)) continue;
        headsignByStopId.get(psid).add(hs);
      }
    }

    for (const st of stops) {
      const opt = document.createElement("option");
      opt.value = st.stop_id;
      const nm = String(st.stop_name || "").trim();
      if (needsDirByName.has(nm)) {
        const hsSet = headsignByStopId.get(String(st.stop_id || "").trim());
        const hsList = hsSet ? [...hsSet].filter(Boolean) : [];
        hsList.sort((a, b) => String(a).localeCompare(String(b), "fr"));
        if (hsList.length) {
          const shown = hsList.slice(0, 2).join(" / ");
          const suffix = hsList.length > 2 ? " …" : "";
          opt.textContent = `${nm} (${shown}${suffix})`;
        } else {
          opt.textContent = nm;
        }
      } else {
        opt.textContent = nm;
      }
      els.lineStop.appendChild(opt);
    }
  };
  const syncActiveLinePill = () => {
    const active = String(els.line.value || "").trim();
    for (const btn of els.linePills.querySelectorAll(".tam-route-ui__linePillBtn")) {
      if (!(btn instanceof HTMLElement)) continue;
      const code = String(btn.dataset.routeCode || "");
      btn.classList.toggle("is-active", code === active);
    }
  };
  fillLineStops(els.line.value);
  els.line.addEventListener("change", () => fillLineStops(els.line.value));
  syncActiveLinePill();
}

function computeWalkEdgeCandidates(lat, lon, maxMeters) {
  const { stopsById } = buildRoutePlannerIndexes();
  const edges = [];
  for (const st of stopsById.values()) {
    const dm = approximateGeoDistMeters(lat, lon, st.lat, st.lon);
    if (!Number.isFinite(dm) || dm > maxMeters) continue;
    edges.push({
      to: st.stop_id,
      w: walkSecondsForMeters(dm),
      kind: "walk",
      route: "",
    });
  }
  edges.sort((a, b) => a.w - b.w);
  return edges.slice(0, 18);
}

function describeRouteResult(destStopId, dRes, opts) {
  const o = opts || {};
  const omitFinalRideDirection = !!o.omitFinalRideDirection;
  const idx = buildRoutePlannerIndexes();
  const dest = idx.stopsById.get(destStopId);
  if (!dest) return "Destination inconnue.";
  if (!dRes) return "Aucun itinéraire trouvé avec les données actuelles.";

  const lines = [];
  lines.push(`Destination : ${dest.stop_name}`);
  lines.push(`Durée estimée : ${fmtMinutesFromSeconds(dRes.seconds)}`);
  lines.push("");
  /** Arrêt atteint par la dernière étape « marche » (évite « montez à … » redondant). */
  let lastWalkArrivalStopId = null;
  /** Nom normalisé du dernier arrêt de descente (même pôle / correspondance). */
  let lastAlightNameKey = "";
  let currentRide = null;
  let rideFrom = null;
  let rideHeadsign = "";
  let rideBranchLetter = "";
  const flushRide = (toStopId) => {
    if (!currentRide || !rideFrom) return;
    const a = idx.stopsById.get(rideFrom);
    const b = idx.stopsById.get(toStopId);
    const hsRaw = String(rideHeadsign || "").trim();
    const isFinalRide = toStopId === destStopId;
    const hsRawEffective =
      omitFinalRideDirection && isFinalRide ? "" : hsRaw;
    const branchPair = routePlannerHeadsignBranchPairMeta(
      currentRide,
      hsRawEffective,
    );
    const splitHs = headsignAbBranchSplit(hsRawEffective);
    const letterMeta =
      rideBranchLetter === "A" || rideBranchLetter === "B"
        ? rideBranchLetter
        : branchPair
          ? branchPair.letter
          : null;
    const take = routePlannerTakeLinePhrase(currentRide, letterMeta);
    const dirQuoted = branchPair
      ? branchPair.base
      : splitHs
        ? splitHs.base
        : hsRawEffective;
    const alightNameK = normalizeStopName(a?.stop_name || "");
    const arrivedByWalk =
      lastWalkArrivalStopId && rideFrom === lastWalkArrivalStopId;
    const sameHubAsLastAlight =
      !!lastAlightNameKey &&
      !!alightNameK &&
      alightNameK === lastAlightNameKey;
    const omitMontez = arrivedByWalk || sameHubAsLastAlight;
    lastWalkArrivalStopId = null;
    if (hsRawEffective) {
      if (omitMontez) {
        lines.push(`- Prenez ${take} en direction de « ${dirQuoted} ».`);
      } else {
        lines.push(
          `- Prenez ${take} en direction de « ${dirQuoted} », montez à ${a?.stop_name || "?"}.`,
        );
      }
      lines.push(`- Descendez à ${b?.stop_name || "?"}.`);
    } else {
      if (omitMontez) {
        lines.push(`- Prenez ${take}.`);
      } else {
        lines.push(`- Prenez ${take}, montez à ${a?.stop_name || "?"}.`);
      }
      lines.push(`- Descendez à ${b?.stop_name || "?"}.`);
    }
    const bk = normalizeStopName(b?.stop_name || "");
    if (bk) lastAlightNameKey = bk;
    currentRide = null;
    rideFrom = null;
    rideHeadsign = "";
    rideBranchLetter = "";
  };
  for (const step of dRes.path) {
    const e = step.edge;
    if (e.kind === "walk") {
      flushRide(step.from);
      const b = idx.stopsById.get(step.to);
      lines.push(
        `- Marchez jusqu’à ${b?.stop_name || "un arrêt"} (~${fmtMinutesFromSeconds(e.w)}).`,
      );
      lastWalkArrivalStopId = step.to;
    } else if (e.kind === "transfer") {
      flushRide(step.from);
      lastWalkArrivalStopId = null;
      const a = idx.stopsById.get(step.from);
      const b = idx.stopsById.get(step.to);
      if (step.to === destStopId) {
        const destKey = normalizeStopName(dest.stop_name || "");
        const fromKey = normalizeStopName(a?.stop_name || "");
        if (fromKey && destKey && fromKey === destKey) {
          continue;
        }
      }
      const na = normalizeStopName(a?.stop_name || "");
      const nb = normalizeStopName(b?.stop_name || "");
      const samePublicName = na && nb && na === nb;
      if (samePublicName) {
        lines.push(
          `- Changement de quai à ${a?.stop_name || "l’arrêt"} (~${fmtMinutesFromSeconds(e.w)}).`,
        );
      } else {
        lines.push(
          `- Correspondance : ${a?.stop_name || "l’arrêt"} → ${b?.stop_name || "arrêt"} (~${fmtMinutesFromSeconds(e.w)}).`,
        );
      }
    } else if (e.kind === "ride") {
      const r = String(e.route || "").trim();
      if (!r) continue;
      if (currentRide !== r) {
        flushRide(step.from);
        currentRide = r;
        rideFrom = step.from;
        rideHeadsign = String(e.headsign || "").trim();
        const br = String(e.branchLetter || "")
          .trim()
          .toUpperCase()
          .slice(0, 1);
        rideBranchLetter = br === "A" || br === "B" ? br : "";
      }
    }
  }
  flushRide(destStopId);
  return lines.join("\n").trim();
}

async function drawRouteOnMapFromResult(gpsLat, gpsLon, dRes) {
  clearTamRouteOverlay();
  const layer = ensureTamRouteOverlayLayer();
  if (!layer) return;
  const idx = buildRoutePlannerIndexes();
  addRouteMarker(gpsLat, gpsLon, "Départ");
  if (!dRes?.path?.length) return;

  const nearestIndexOnCoords = (coords, lat, lon) => {
    if (!coords || coords.length < 2) return -1;
    const p = L.latLng(lat, lon);
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || c.length < 2) continue;
      const d = p.distanceTo(L.latLng(c[0], c[1]));
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return bestI;
  };

  const sliceCoordsBetweenStops = (coords, fromStop, toStop) => {
    if (!coords || coords.length < 2 || !fromStop || !toStop) return null;
    const aI = nearestIndexOnCoords(coords, fromStop.lat, fromStop.lon);
    const bI = nearestIndexOnCoords(coords, toStop.lat, toStop.lon);
    if (aI < 0 || bI < 0) return null;
    const lo = Math.min(aI, bI);
    const hi = Math.max(aI, bI);
    const seg = coords.slice(lo, hi + 1);
    if (seg.length < 2) return null;
    return aI <= bI ? seg : seg.slice().reverse();
  };

  const getNetworkGeometryForRide = (routeCode, fromStop, toStop) => {
    const code = String(routeCode || "").trim();
    if (!code || !fromStop || !toStop) return null;
    const pseudoPattern = {
      route_short_name: code,
      coordinates: [
        [fromStop.lat, fromStop.lon],
        [toStop.lat, toStop.lon],
      ],
    };
    // Essayez d'abord tram, puis bus.
    return (
      getTramNetworkGeometry(pseudoPattern) ||
      getBusNetworkGeometry(pseudoPattern) ||
      null
    );
  };

  for (const step of dRes.path) {
    const e = step.edge;
    if (!e || !e.to) continue;
    const toStop = idx.stopsById.get(step.to);
    if (!toStop) continue;

    if (e.kind === "walk" || e.kind === "transfer") {
      let fromLat = gpsLat;
      let fromLon = gpsLon;
      if (step.from !== "__gps__") {
        const fromStop = idx.stopsById.get(step.from);
        if (fromStop) {
          fromLat = fromStop.lat;
          fromLon = fromStop.lon;
        }
      }
      const latlngs =
        (await fetchOsrmFootRouteGeojson(fromLat, fromLon, toStop.lat, toStop.lon)) ||
        [
          [fromLat, fromLon],
          [toStop.lat, toStop.lon],
        ];
      addRoutePolyline(latlngs, {
        color: e.kind === "transfer" ? "#64748b" : "#0ea5e9",
        weight: 5,
        opacity: 0.9,
        dashArray: e.kind === "transfer" ? "6 6" : null,
        lineCap: "round",
      });
      addRouteMarker(toStop.lat, toStop.lon, toStop.stop_name);
    } else if (e.kind === "ride") {
      const fromStop = idx.stopsById.get(step.from);
      if (!fromStop) continue;
      const geom = getNetworkGeometryForRide(e.route, fromStop, toStop);
      const rideCoords = geom
        ? sliceCoordsBetweenStops(geom.coords, fromStop, toStop)
        : null;
      addRoutePolyline(
        rideCoords || [
          [fromStop.lat, fromStop.lon],
          [toStop.lat, toStop.lon],
        ],
        {
          color: "#0f172a",
          weight: 4,
          opacity: 0.55,
          dashArray: "2 8",
          lineCap: "round",
        },
      );
    }
  }

  const lastTo = dRes.path[dRes.path.length - 1]?.to;
  const dest = lastTo ? idx.stopsById.get(lastTo) : null;
  if (dest) addRouteMarker(dest.lat, dest.lon, "Arrivée");
}

function setupTamRoutePlannerUi() {
  const els = ensureTamRouteUiEls();
  if (
    !els.wrap ||
    !els.panel ||
    !els.mode ||
    !els.lineBlock ||
    !els.stopBlock ||
    !els.line ||
    !els.lineStop ||
    !els.stop ||
    !els.go ||
    !els.close ||
    !els.result
  ) {
    return;
  }

  els.close.addEventListener("click", () => {
    els.panel.classList.remove("show");
  });
  els.mode.addEventListener("change", () => routePanelSetMode(els.mode.value));

  els.go.addEventListener("click", async () => {
    if (!data?.patterns?.length) {
      els.result.textContent = "Données réseau indisponibles.";
      return;
    }
    // Ne pas re-remplir ici : cela réinitialise les sélections (ex. ligne 14 → revient à la 1re option).
    // On ne (re)construit les listes qu’à l’ouverture du panneau.
    if (!els.line.options.length || !els.stop.options.length) {
      populateRoutePlannerSelects();
      routePanelSetMode(els.mode.value);
    }

    const gps = gpsLatLngOrNull() || (await getOneShotGeolocationLatLngOrNull());
    const pos = gps || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
    if (!pos) {
      els.result.textContent = "Position indisponible.";
      return;
    }
    const [lat, lon] = pos;

    // Nouveau calcul => remplace l'ancien tracé.
    clearTamRouteOverlay();

    const mode = String(els.mode.value || "stop");
    const idx = buildRoutePlannerIndexes();
    if (mode === "stop") {
      const raw = String(els.stop.value || "").trim();
      if (!raw) {
        els.result.textContent = "Choisissez un arrêt de destination.";
        return;
      }
      let destStopId = raw;
      if (raw.startsWith("namekey:")) {
        const key = raw.slice("namekey:".length);
        const opt = idx.stopDestOptions.find((o) => o.key === key);
        const ids = opt?.stop_ids || [];
        if (!ids.length) {
          els.result.textContent = "Choisissez un arrêt de destination.";
          return;
        }
        // On cible le quai le plus proche de la position (plus logique qu’un choix arbitraire).
        let best = ids[0];
        let bestD = Infinity;
        for (const sid of ids) {
          const st = idx.stopsById.get(sid);
          if (!st) continue;
          const dm = approximateGeoDistMeters(lat, lon, st.lat, st.lon);
          if (dm < bestD) {
            bestD = dm;
            best = sid;
          }
        }
        destStopId = best;
      }
      const walkEdges = computeWalkEdgeCandidates(lat, lon, 900);
      const res = dijkstraRoutePlanner("__gps__", destStopId, walkEdges);
      els.result.textContent = describeRouteResult(destStopId, res);
      await drawRouteOnMapFromResult(lat, lon, res);
      return;
    }

    const lineCode = String(els.line.value || "").trim();
    if (!lineCode) {
      els.result.textContent = "Choisissez une ligne.";
      return;
    }
    const lineStopId = String(els.lineStop.value || "").trim();
    const set = idx.stopsByRoute.get(lineCode) || new Set();
    const candidates = [...set].map((sid) => idx.stopsById.get(sid)).filter(Boolean);
    if (!candidates.length) {
      els.result.textContent = "Ligne indisponible dans les données.";
      return;
    }
    const walkEdges = computeWalkEdgeCandidates(lat, lon, 1200);
    let targetId = lineStopId;
    let res = null;
    if (targetId) {
      res = dijkstraRoutePlanner("__gps__", targetId, walkEdges);
    } else {
      // Objectif : atteindre la ligne (n’importe quel quai de la ligne), au plus vite,
      // sans “voyager” sur la ligne cible (la personne choisit ensuite sa direction).
      const goalSet = new Set([...set].map((sid) => String(sid || "").trim()).filter(Boolean));
      res = dijkstraRoutePlanner("__gps__", goalSet, walkEdges, {
        forbiddenRideRoutes: [lineCode],
      });
      targetId = String(res?.goalStopId || "").trim();
    }
    const target = targetId ? idx.stopsById.get(targetId) : null;
    const head = lineStopId
      ? `Rejoindre la ligne ${lineCode} vers ${target?.stop_name || "l’arrêt"}`
      : `Rejoindre la ligne ${lineCode} (au plus rapide)`;
    els.result.textContent = `${head}\n\n${describeRouteResult(targetId || lineStopId, res, {
      // En mode « Peu importe l’arrêt », on doit quand même indiquer le sens
      // des lignes empruntées (ex. ligne 11). La ligne cible est déjà interdite
      // dans le graphe, donc on n’a pas besoin de masquer la direction du “dernier trajet”.
      omitFinalRideDirection: false,
    })}`;
    await drawRouteOnMapFromResult(lat, lon, res);
  });

  // Contrôle Leaflet (bouton) : visible seulement hors mission.
  if (typeof L !== "undefined" && map) {
    const ctrl = L.control({ position: "topleft" });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create("div", "leaflet-bar");
      const a = L.DomUtil.create("a", "", div);
      a.href = "#";
      a.title = "Itinéraire";
      a.setAttribute("aria-label", "Itinéraire");
      a.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" fill="none" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M14.8 9.2l-1.7 5.6-5.6 1.7 1.7-5.6 5.6-1.7z" fill="currentColor"/>' +
        "</svg>";
      a.style.display = "inline-flex";
      a.style.alignItems = "center";
      a.style.justifyContent = "center";
      a.style.color = "#005ca9";
      L.DomEvent.disableClickPropagation(div);

      function positionPanelUnderButton() {
        if (!els.wrap || !els.panel) return;
        const mapEl = map.getContainer();
        if (!mapEl) return;
        const mapRect = mapEl.getBoundingClientRect();
        const br = a.getBoundingClientRect();
        const left = Math.max(6, Math.round(br.left - mapRect.left));
        const top = Math.max(6, Math.round(br.bottom - mapRect.top + 6));
        els.wrap.style.setProperty("--tam-route-panel-left", `${left}px`);
        els.wrap.style.setProperty("--tam-route-panel-top", `${top}px`);
      }
      window.addEventListener("resize", () => {
        if (els.panel.classList.contains("show")) positionPanelUnderButton();
      });

      L.DomEvent.on(a, "click", (ev) => {
        L.DomEvent.preventDefault(ev);
        if (!tamRouteUiIsVisible()) return;
        if (els.panel.classList.contains("show")) {
          els.panel.classList.remove("show");
          return;
        }
        // Réouverture : ne pas réinitialiser les choix/résultats.
        // On ne remplit les listes qu’au tout premier affichage (ou si elles sont vides).
        if (!els.line.options.length || !els.stop.options.length) {
          populateRoutePlannerSelects();
        }
        routePanelSetMode(els.mode.value);
        positionPanelUnderButton();
        els.panel.classList.add("show");
      });
      return div;
    };
    ctrl.addTo(map);
  }
}

function walkSecondsForMeters(m) {
  const meters = Number(m);
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  // ~4.8 km/h : marche urbaine.
  const speed = 1.33;
  return Math.max(0, Math.round(meters / speed));
}

function fmtMinutesFromSeconds(sec) {
  const s = Number(sec);
  if (!Number.isFinite(s)) return "-";
  return `${Math.max(1, Math.round(s / 60))} min`;
}

let routePlannerIndexCache = null;

function buildRoutePlannerIndexes() {
  if (routePlannerIndexCache) return routePlannerIndexCache;
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  const stopsById = new Map();
  const nameKeyToStopIds = new Map();
  const stopsByRoute = new Map();
  const routesByStopId = new Map();

  for (const p of patterns) {
    const route = String(p?.route_short_name || "").trim();
    const stops = Array.isArray(p?.stops) ? p.stops : [];
    if (route) {
      if (!stopsByRoute.has(route)) stopsByRoute.set(route, new Set());
    }
    for (const st of stops) {
      const sid = String(st?.stop_id || "").trim();
      const nm = String(st?.stop_name || st?.name || "").trim();
      const lat = Number(st?.lat);
      const lon = Number(st?.lon);
      if (!sid || !nm || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!stopsById.has(sid)) {
        stopsById.set(sid, { stop_id: sid, stop_name: nm, lat, lon });
      }
      const key = normalizeStopName(nm);
      if (key) {
        if (!nameKeyToStopIds.has(key)) nameKeyToStopIds.set(key, new Set());
        nameKeyToStopIds.get(key).add(sid);
      }
      if (route) {
        stopsByRoute.get(route).add(sid);
        if (!routesByStopId.has(sid)) routesByStopId.set(sid, new Set());
        routesByStopId.get(sid).add(route);
      }
    }
  }

  function isTramCode(code) {
    return /^T\d+/i.test(String(code || "").trim());
  }
  function tramSortKey(code) {
    const c = String(code || "").trim().toUpperCase();
    const m = /^T(\d+)/.exec(c);
    if (!m) return 999;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : 999;
  }
  function routeSortKey(code) {
    const c = String(code || "").trim().toUpperCase();
    if (isTramCode(c)) return { group: 0, n: tramSortKey(c), s: c };
    if (c.includes("NAV") || c.includes("NAVETTE")) return { group: 1, n: 0, s: c };
    const n = Number.parseInt(c, 10);
    if (Number.isFinite(n)) return { group: 2, n, s: c };
    return { group: 3, n: 0, s: c };
  }
  function formatRoutesList(routes) {
    const arr = [...routes].filter(Boolean);
    arr.sort((a, b) => {
      const ka = routeSortKey(a);
      const kb = routeSortKey(b);
      if (ka.group !== kb.group) return ka.group - kb.group;
      if (ka.n !== kb.n) return ka.n - kb.n;
      return ka.s.localeCompare(kb.s, "fr");
    });
    return arr.join(", ");
  }

  /** Options de destination par nom d’arrêt (évite doublons de quais). */
  const stopDestOptions = [];
  for (const [key, set] of nameKeyToStopIds.entries()) {
    const ids = [...set];
    if (!ids.length) continue;
    const first = stopsById.get(ids[0]);
    if (!first) continue;
    const routes = new Set();
    for (const sid of ids) {
      const rs = routesByStopId.get(sid);
      if (!rs) continue;
      for (const r of rs) routes.add(r);
    }
    const rs = formatRoutesList(routes);
    const label = rs ? `${first.stop_name} — ${rs}` : first.stop_name;
    stopDestOptions.push({
      value: `namekey:${key}`,
      key,
      label,
      stop_name: first.stop_name,
      stop_ids: ids,
    });
  }
  stopDestOptions.sort((a, b) =>
    String(a.stop_name || "").localeCompare(String(b.stop_name || ""), "fr"),
  );

  routePlannerIndexCache = {
    stopsById,
    nameKeyToStopIds,
    stopsByRoute,
    routesByStopId,
    stopDestOptions,
  };
  return routePlannerIndexCache;
}

let routePlannerGraphCache = null;

// (placeholder)

const TAM_ROUTE_OSRM_BASE = "https://router.project-osrm.org";
const TAM_ROUTE_OSRM_TIMEOUT_MS = 9000;
const TAM_ROUTE_OSRM_CACHE = new Map();
let tamRouteOverlayLayer = null;

function ensureTamRouteOverlayLayer() {
  if (tamRouteOverlayLayer) return tamRouteOverlayLayer;
  if (typeof L === "undefined" || !map) return null;
  // Pane dédié pour éviter toute interaction avec les calques mission.
  if (typeof map.getPane === "function" && !map.getPane("tamRoutePane")) {
    map.createPane("tamRoutePane");
    const p = map.getPane("tamRoutePane");
    if (p && p.style) {
      // Au-dessus des overlays par défaut (mission), sous les contrôles UI.
      p.style.zIndex = "650";
    }
  }
  tamRouteOverlayLayer = L.layerGroup([], { pane: "tamRoutePane" });
  tamRouteOverlayLayer.addTo(map);
  return tamRouteOverlayLayer;
}

function clearTamRouteOverlay() {
  const layer = ensureTamRouteOverlayLayer();
  if (!layer) return;
  layer.clearLayers();
}

async function fetchOsrmFootRouteGeojson(fromLat, fromLon, toLat, toLon) {
  const aLat = Number(fromLat);
  const aLon = Number(fromLon);
  const bLat = Number(toLat);
  const bLon = Number(toLon);
  if (
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLon) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLon)
  ) {
    return null;
  }
  const key = `${aLat.toFixed(6)},${aLon.toFixed(6)}->${bLat.toFixed(6)},${bLon.toFixed(6)}`;
  const now = Date.now();
  const cached = TAM_ROUTE_OSRM_CACHE.get(key);
  if (cached && cached.expiresAt > now) return cached.payload;

  const url =
    `${TAM_ROUTE_OSRM_BASE}/route/v1/foot/` +
    `${aLon},${aLat};${bLon},${bLat}` +
    `?overview=full&geometries=geojson&steps=false&alternatives=false`;

  const ctrl =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const tid = ctrl
    ? window.setTimeout(() => ctrl.abort(), TAM_ROUTE_OSRM_TIMEOUT_MS)
    : 0;
  try {
    const resp = await fetch(url, {
      cache: "no-store",
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!resp.ok) return null;
    const js = await resp.json();
    const coords = js?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    // OSRM: [lon,lat] -> Leaflet: [lat,lon]
    const latlngs = coords
      .map((c) => [Number(c?.[1]), Number(c?.[0])])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (latlngs.length < 2) return null;
    TAM_ROUTE_OSRM_CACHE.set(key, {
      expiresAt: now + 10 * 60_000,
      payload: latlngs,
    });
    return latlngs;
  } catch {
    return null;
  } finally {
    if (tid) window.clearTimeout(tid);
  }
}

function addRoutePolyline(latlngs, opts) {
  const layer = ensureTamRouteOverlayLayer();
  if (!layer || !Array.isArray(latlngs) || latlngs.length < 2) return;
  const poly = L.polyline(latlngs, { ...(opts || {}), pane: "tamRoutePane" });
  poly.addTo(layer);
}

function addRouteMarker(lat, lon, label) {
  const layer = ensureTamRouteOverlayLayer();
  if (!layer) return;
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
  const m = L.circleMarker([a, b], {
    radius: 6,
    weight: 2,
    color: "#0f172a",
    fillColor: "#ffffff",
    fillOpacity: 1,
    pane: "tamRoutePane",
  });
  if (label)
    m.bindTooltip(String(label), { permanent: false, direction: "top" });
  m.addTo(layer);
}

function buildRoutePlannerGraph() {
  if (routePlannerGraphCache) return routePlannerGraphCache;
  const { stopsById, nameKeyToStopIds } = buildRoutePlannerIndexes();
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];

  /** @type {Map<string, { to: string, w: number, kind: string, route: string, headsign: string, branchLetter: string }[]>} */
  const adj = new Map();
  const addEdge = (from, to, w, kind, route, headsign, branchLetter) => {
    if (!from || !to || from === to) return;
    if (!adj.has(from)) adj.set(from, []);
    const hs =
      kind === "ride" ? String(headsign == null ? "" : headsign).trim() : "";
    const brRaw =
      kind === "ride"
        ? String(branchLetter == null ? "" : branchLetter).trim().toUpperCase()
        : "";
    const brOk = brRaw === "A" || brRaw === "B" ? brRaw : "";
    adj.get(from).push({
      to,
      w,
      kind,
      route: route || "",
      headsign: hs,
      branchLetter: brOk,
    });
  };

  // Arcs "dans le véhicule" (directionnels) basés sur les temps GTFS du pattern.
  for (const p of patterns) {
    const route = String(p?.route_short_name || "").trim();
    const stops = Array.isArray(p?.stops) ? p.stops : [];
    if (!route || stops.length < 2) continue;
    const model = buildTamStopRailGtfsSchedule(stops);
    if (!model.ok) continue;
    const leg = model.legSec;
    const headsign = String(p?.headsign || "").trim();
    const t4Br = route === "4" ? t4BranchLetterFromPatternStops(p) : "";
    for (let i = 0; i < stops.length - 1; i++) {
      const a = String(stops[i]?.stop_id || "").trim();
      const b = String(stops[i + 1]?.stop_id || "").trim();
      if (!stopsById.has(a) || !stopsById.has(b)) continue;
      const w = Math.max(30, Number(leg[i] || 120));
      addEdge(a, b, w, "ride", route, headsign, t4Br);
    }
  }

  // Arcs "correspondance" : même nom normalisé, mais uniquement si les quais sont vraiment proches.
  const transferW = 180;
  const transferMaxMeters = 250;
  for (const set of nameKeyToStopIds.values()) {
    const ids = [...set];
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) {
      const a = stopsById.get(ids[i]);
      if (!a) continue;
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const b = stopsById.get(ids[j]);
        if (!b) continue;
        const dm = approximateGeoDistMeters(a.lat, a.lon, b.lat, b.lon);
        if (!Number.isFinite(dm) || dm > transferMaxMeters) continue;
        addEdge(ids[i], ids[j], transferW, "transfer", "", "", "");
      }
    }
  }

  routePlannerGraphCache = { adj };
  return routePlannerGraphCache;
}

function dijkstraRoutePlanner(startKey, goalStopIdOrSet, extraStartEdges, opts) {
  const o = opts || {};
  const { adj } = buildRoutePlannerGraph();
  // L’attente n’est pas modélisée : on approxime via une pénalité à chaque (ré)embarquement.
  // Pour éviter des enchaînements du type T2 → T1 → T2, on garde l’état « ligne en cours » dans Dijkstra.
  const dist = new Map();
  const prev = new Map();
  const prevEdge = new Map();
  const visited = new Set();

  const goalSet =
    goalStopIdOrSet && typeof goalStopIdOrSet !== "string"
      ? goalStopIdOrSet
      : null;
  const goalStopId = goalSet ? "" : String(goalStopIdOrSet || "").trim();

  const forbiddenRideRoutesRaw = Array.isArray(o.forbiddenRideRoutes)
    ? o.forbiddenRideRoutes
    : [];
  const forbiddenRideRoutes = new Set(
    forbiddenRideRoutesRaw.map((x) => String(x || "").trim()).filter(Boolean),
  );

  const routeTypeByCode = (() => {
    const map = new Map();
    for (const it of Array.isArray(lineOptions) ? lineOptions : []) {
      const code = String(it?.route_short_name || "").trim();
      if (!code || map.has(code)) continue;
      map.set(code, String(it?.route_type || "").trim());
    }
    return map;
  })();

  const boardingPenaltySeconds = (routeCode) => {
    const code = String(routeCode || "").trim();
    const rt = routeTypeByCode.get(code) || "";
    // GTFS: tram/metro/rail ~0 ; bus ~3. On met une pénalité plus forte en bus.
    if (rt === "0") return 240; // ~4 min (tram)
    if (code === "A") return 300; // navette
    return 420; // ~7 min (bus / reste)
  };

  const nodeKey = (stopId, routeCode) =>
    `${String(stopId || "").trim()}|||${String(routeCode || "").trim()}`;
  const parseNodeKey = (k) => {
    const raw = String(k || "");
    const i = raw.indexOf("|||");
    if (i < 0) return { stopId: raw, routeCode: "" };
    return { stopId: raw.slice(0, i), routeCode: raw.slice(i + 3) };
  };

  const pq = [];
  const push = (node, d) => {
    pq.push({ node, d });
  };
  const popMin = () => {
    let best = 0;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].d < pq[best].d) best = i;
    }
    return pq.splice(best, 1)[0];
  };

  const startNode = nodeKey(startKey, "");
  dist.set(startNode, 0);
  push(startNode, 0);

  let bestGoalNode = "";
  let bestGoalDist = Infinity;
  let bestGoalStopId = "";

  while (pq.length) {
    const cur = popMin();
    const u = cur.node;
    if (visited.has(u)) continue;
    visited.add(u);
    const pu = parseNodeKey(u);
    const isGoal = goalSet
      ? goalSet.has(pu.stopId)
      : !!goalStopId && pu.stopId === goalStopId;
    if (isGoal) {
      bestGoalNode = u;
      bestGoalDist = cur.d;
      bestGoalStopId = pu.stopId;
      break;
    }

    const baseD = dist.get(u) ?? Infinity;
    const edges = [];
    if (pu.stopId === startKey && Array.isArray(extraStartEdges) && !pu.routeCode) {
      for (const e of extraStartEdges) edges.push(e);
    }
    const a = adj.get(pu.stopId) || [];
    for (const e of a) edges.push(e);

    for (const e of edges) {
      const vStop = String(e.to || "").trim();
      if (!vStop) continue;
      const w = Math.max(0, Number(e.w || 0));

      let vRoute = "";
      let penalty = 0;
      if (e.kind === "ride") {
        vRoute = String(e.route || "").trim();
        if (vRoute && forbiddenRideRoutes.has(vRoute)) {
          continue;
        }
        if (vRoute && vRoute !== pu.routeCode) {
          penalty = boardingPenaltySeconds(vRoute);
        }
      }
      const v = nodeKey(vStop, vRoute);
      const nd = baseD + w + penalty;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        prevEdge.set(v, e);
        push(v, nd);
      }
    }
  }

  if (!bestGoalNode || !Number.isFinite(bestGoalDist)) return null;
  const path = [];
  let curN = bestGoalNode;
  while (curN && curN !== startNode) {
    const pN = prev.get(curN);
    const e = prevEdge.get(curN);
    if (!pN || !e) break;
    const fromStopId = parseNodeKey(pN).stopId;
    const toStopId = parseNodeKey(curN).stopId;
    path.push({ from: fromStopId, to: toStopId, edge: e });
    curN = pN;
  }
  path.reverse();
  return { seconds: bestGoalDist, path, goalStopId: bestGoalStopId };
}

function buildCorrespondenceDirectionInfo(stopObj, routeItem) {
  const routeCode = String(routeItem?.route_short_name || "").trim();
  if (!routeCode) return [];
  const byDir = new Map();
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  for (const p of patterns) {
    if (String(p?.route_short_name || "").trim() !== routeCode) continue;
    const stops = Array.isArray(p?.stops) ? p.stops : [];
    if (!stops.some((s) => stopMatchesPatternStop(stopObj, s))) continue;
    const dirRaw = String(p?.direction_id ?? "").trim();
    const dirKey = dirRaw === "1" ? "1" : "0";
    if (!byDir.has(dirKey)) {
      byDir.set(dirKey, new Set());
    }
    const headsign = String(p?.headsign || "").trim();
    if (headsign) {
      byDir.get(dirKey).add(headsign);
    }
  }
  const out = [];
  for (const dirKey of ["0", "1"]) {
    if (!byDir.has(dirKey)) continue;
    out.push({
      dirKey,
      labels: [...byDir.get(dirKey)].sort((a, b) => a.localeCompare(b, "fr")),
    });
  }
  return out;
}

function directionDisplayLabel(dirKey) {
  return String(dirKey) === "1" ? "Dir. 1" : "Dir. 0";
}

const CORRESPONDENCE_DIALOG_TITLE = "SAE TAM";
const SAINT_ROCH_HUB_DIALOG_TITLE = "SAE TAM (Pôle Saint-Roch)";

function appendCorrespondenceLineHeader(parentEl, opts) {
  const o = opts || {};
  const routeItem = o.routeItem || null;
  const stopObj = o.stopObj || null;
  const lineLabel =
    o.lineLabel || (routeItem ? displayLineLabel(routeItem) : "Ligne");
  const row = document.createElement("div");
  row.className = "app-correspondence-arrivals-row";
  const badge = document.createElement("span");
  badge.textContent = lineLabel;
  if (routeItem) {
    applyLineColorStyling(badge, routeItem, "contextPill");
  }
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.padding = "3px 10px";
  const arrivals = document.createElement("span");
  arrivals.className = "app-correspondence-arrivals";
  arrivals.textContent = stopObj && routeItem ? "chargement…" : "";
  row.appendChild(badge);
  row.appendChild(arrivals);
  parentEl.appendChild(row);
  if (stopObj && routeItem) {
    refreshCorrespondencePopupArrivals(stopObj, routeItem, arrivals);
  }
  return row;
}

function showCorrespondenceDirectionPopup(stopObj, routeItem) {
  const lineLabel = displayLineLabel(routeItem);
  const stopName = String(
    stopObj?.stop_name || stopObj?.name || "Arrêt",
  ).trim();
  const info = buildCorrespondenceDirectionInfo(stopObj, routeItem);
  if (!info.length) {
    showAppMessageDialog(
      CORRESPONDENCE_DIALOG_TITLE,
      `Correspondance ${lineLabel}\n\nAucune direction disponible pour cet arrêt.`,
    );
    return;
  }
  const dlg = document.getElementById("appMessageDialog");
  const titleEl = document.getElementById("appMessageDialogTitle");
  const bodyEl = document.getElementById("appMessageDialogBody");
  if (dlg && typeof dlg.showModal === "function" && titleEl && bodyEl) {
    titleEl.textContent = CORRESPONDENCE_DIALOG_TITLE;
    bodyEl.innerHTML = "";

    appendCorrespondenceLineHeader(bodyEl, { lineLabel, routeItem, stopObj });

    const stopLine = document.createElement("p");
    stopLine.style.margin = "0 0 6px";
    stopLine.innerHTML = `<strong>Arrêt :</strong> ${stopName}`;
    bodyEl.appendChild(stopLine);

    for (const it of info) {
      const sensLabel = directionDisplayLabel(it.dirKey);
      const p = document.createElement("p");
      p.style.margin = "0 0 6px";
      p.innerHTML = `<strong>${sensLabel} :</strong> ${it.labels.join(" / ")}`;
      bodyEl.appendChild(p);
    }

    dlg.returnValue = "";
    dlg.showModal();
    return;
  }
  const lines = [`Ligne : ${lineLabel}`, `Arrêt : ${stopName}`, ""];
  for (const it of info) {
    const sensLabel = directionDisplayLabel(it.dirKey);
    lines.push(`${sensLabel} : ${it.labels.join(" / ")}`);
  }
  showAppMessageDialog(CORRESPONDENCE_DIALOG_TITLE, lines.join("\n").trim());
}

async function refreshCorrespondencePopupArrivals(stopObj, routeItem, targetEl) {
  if (!(targetEl instanceof HTMLElement)) return;
  const stopId = resolveRealtimeStopIdForRoute(stopObj, routeItem);
  const routeCode = String(routeItem?.route_short_name || "").trim();
  if (!stopId || !routeCode) {
    targetEl.textContent = "";
    return;
  }
  try {
    const payload = await fetchTamStopRailArrivals(stopId, routeCode);
    const text = formatTamArrivalMinutes(payload?.arrivals);
    targetEl.textContent = text ? text : "aucun passage imminent";
  } catch (err) {
    console.warn("Chargement des prochains passages impossible:", err);
    targetEl.textContent = "temps indisponible";
  }
}

/**
 * `stop_id` pour l’API temps réel : celui de **la ligne consultée** au même lieu,
 * pas un repli sur le `stop_id` du trajet simulé (sinon T4 renvoie les mêmes minutes que le T1).
 */
function resolveRealtimeStopIdForRoute(stopObj, routeItem) {
  const routeCode = String(routeItem?.route_short_name || "").trim();
  const direct = String(stopObj?.stop_id || "").trim();
  if (!routeCode) return direct;

  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  let routeUsesSameStopIdAsSimulated = false;
  /** @type {{ sid: string; lat: number | null; lon: number | null }[]} */
  const candidates = [];

  for (const p of patterns) {
    if (String(p?.route_short_name || "").trim() !== routeCode) continue;
    const pstops = Array.isArray(p?.stops) ? p.stops : [];
    for (const st of pstops) {
      const sid = String(st?.stop_id || "").trim();
      if (!sid) continue;
      if (direct && sid === direct) routeUsesSameStopIdAsSimulated = true;
      if (!stopMatchesPatternStop(stopObj, st)) continue;
      const lat = Number(st.lat);
      const lon = Number(st.lon);
      candidates.push({
        sid,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
      });
    }
  }

  if (routeUsesSameStopIdAsSimulated && direct) return direct;

  const uniqBySid = new Map();
  for (const c of candidates) {
    if (!uniqBySid.has(c.sid)) uniqBySid.set(c.sid, c);
  }
  const uniq = [...uniqBySid.values()];
  if (!uniq.length) return "";

  if (uniq.length === 1) return uniq[0].sid;

  const lat0 = Number(stopObj?.lat);
  const lon0 = Number(stopObj?.lon);
  let best = uniq[0];
  let bestD = Infinity;
  for (const c of uniq) {
    if (c.lat == null || c.lon == null) continue;
    const dm = approximateGeoDistMeters(lat0, lon0, c.lat, c.lon);
    if (dm < bestD) {
      bestD = dm;
      best = c;
    }
  }
  return Number.isFinite(bestD) && bestD < Infinity ? best.sid : uniq[0].sid;
}

function appendLineDirectionDetails(lines, stopObj, routeItem) {
  const lineLabel = displayLineLabel(routeItem);
  const info = buildCorrespondenceDirectionInfo(stopObj, routeItem);
  lines.push(`- ${lineLabel}`);
  if (!info.length) {
    lines.push("  Sens indisponible");
    return;
  }
  for (const it of info) {
    const sensLabel = directionDisplayLabel(it.dirKey);
    lines.push(`  ${sensLabel}`);
    for (const headsign of it.labels) {
      lines.push(`   • ${headsign}`);
    }
  }
}

function showTabbedCorrespondenceDialog(title, subtitle, entries) {
  const dlg = document.getElementById("appMessageDialog");
  const titleEl = document.getElementById("appMessageDialogTitle");
  const bodyEl = document.getElementById("appMessageDialogBody");
  if (
    !dlg ||
    typeof dlg.showModal !== "function" ||
    !titleEl ||
    !bodyEl ||
    !entries?.length
  ) {
    return false;
  }
  titleEl.textContent = title || TAM_APP_DIALOG_TITLE;
  bodyEl.innerHTML = "";
  if (subtitle) {
    const sub = document.createElement("p");
    sub.style.margin = "0 0 8px";
    sub.textContent = subtitle;
    bodyEl.appendChild(sub);
  }

  const tabs = document.createElement("div");
  tabs.className = "app-message-tabs";
  tabs.setAttribute("role", "tablist");
  const panel = document.createElement("div");
  panel.className = "app-message-tab-panel";
  panel.setAttribute("role", "tabpanel");

  const buttons = [];
  function renderEntry(idx) {
    const entry = entries[idx];
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", i === idx);
      buttons[i].setAttribute("aria-selected", i === idx ? "true" : "false");
    }
    panel.innerHTML = "";
    appendCorrespondenceLineHeader(panel, entry);
    if (entry.stopName) {
      const stopP = document.createElement("p");
      stopP.style.margin = "0 0 6px";
      stopP.innerHTML = `<strong>Arrêt :</strong> ${entry.stopName}`;
      panel.appendChild(stopP);
    }
    const lines = document.createElement("div");
    lines.className = "app-message-tab-panel-lines";
    if (!entry.details.length) {
      const p = document.createElement("p");
      p.style.margin = "0 0 4px";
      p.textContent = "Sens indisponible";
      lines.appendChild(p);
    } else {
      for (const d of entry.details) {
        const p = document.createElement("p");
        p.style.margin = "0 0 4px";
        p.innerHTML = `<strong>${d.sensLabel} :</strong> ${d.headsigns.join(" / ")}`;
        lines.appendChild(p);
      }
    }
    panel.appendChild(lines);
  }

  entries.forEach((entry, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-message-tab";
    btn.setAttribute("role", "tab");
    btn.textContent = entry.lineLabel;
    if (entry.routeItem) {
      applyLineColorStyling(btn, entry.routeItem, "contextPill");
    }
    btn.addEventListener("click", () => {
      renderEntry(idx);
    });
    buttons.push(btn);
    tabs.appendChild(btn);
  });

  bodyEl.appendChild(tabs);
  bodyEl.appendChild(panel);
  renderEntry(0);
  dlg.returnValue = "";
  dlg.showModal();
  return true;
}

function showCorrespondenceListPopup(stopObj, routeItems, title) {
  const stopName = String(
    stopObj?.stop_name || stopObj?.name || "Arrêt",
  ).trim();
  if (!routeItems?.length) {
    showAppMessageDialog(
      CORRESPONDENCE_DIALOG_TITLE,
      `${title}\n\nAucune ligne supplémentaire pour ${stopName}.`,
    );
    return;
  }
  const entries = routeItems.map((item) => {
    const info = buildCorrespondenceDirectionInfo(stopObj, item);
    return {
      lineLabel: displayLineLabel(item),
      routeItem: item,
      stopObj,
      stopName,
      details: info.map((it) => ({
        sensLabel: directionDisplayLabel(it.dirKey),
        headsigns: it.labels,
      })),
    };
  });
  if (showTabbedCorrespondenceDialog(CORRESPONDENCE_DIALOG_TITLE, "", entries)) {
    return;
  }
  const lines = [title, `Arrêt : ${stopName}`, ""];
  for (const item of routeItems) {
    appendLineDirectionDetails(lines, stopObj, item);
    lines.push("");
  }
  showAppMessageDialog(CORRESPONDENCE_DIALOG_TITLE, lines.join("\n").trim());
}

function getStopAreaHubKey(stopObj) {
  const nameKey = normalizeStopName(stopObj?.stop_name || stopObj?.name || "");
  if (/\bgare\s+saint[-\s]*roch\b/.test(nameKey)) {
    return "saint-roch";
  }
  return "";
}

function isStopInHubByKey(stopObj, hubKey) {
  if (hubKey !== "saint-roch") return false;
  const nameKey = normalizeStopName(stopObj?.stop_name || stopObj?.name || "");
  return /\bgare\s+saint[-\s]*roch\b/.test(nameKey);
}

function hubStopNameOrder(a, b) {
  const pa = normalizeStopName(a);
  const pb = normalizeStopName(b);
  const rank = (v) => {
    if (v.includes("republique")) return 0;
    if (v.includes("pont de sete")) return 1;
    if (v === "gare saint roch") return 2;
    return 9;
  };
  const ra = rank(pa);
  const rb = rank(pb);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "fr");
}

function buildStopAreaHubSummary(stopObj) {
  const hubKey = getStopAreaHubKey(stopObj);
  if (!hubKey) return null;
  const byStopName = new Map();
  const patterns = Array.isArray(data?.patterns) ? data.patterns : [];
  const currentRouteCode = String(
    currentPattern?.route_short_name || "",
  ).trim();
  for (const p of patterns) {
    const routeCode = String(p?.route_short_name || "").trim();
    if (!routeCode || routeCode === currentRouteCode) continue;
    const routeItem = {
      route_short_name: routeCode,
      route_type: String(p?.route_type || ""),
      route_color: String(p?.route_color || ""),
    };
    const stops = Array.isArray(p?.stops) ? p.stops : [];
    for (const st of stops) {
      if (!isStopInHubByKey(st, hubKey)) continue;
      const nm = String(st?.stop_name || st?.name || "").trim();
      if (!nm) continue;
      if (!byStopName.has(nm)) {
        byStopName.set(nm, new Map());
      }
      const byCode = byStopName.get(nm);
      if (!byCode.has(routeCode)) {
        byCode.set(routeCode, routeItem);
      }
    }
  }
  if (!byStopName.size) return null;
  const sections = [...byStopName.entries()]
    .map(([stopName, byCode]) => ({
      stopName,
      lines: sortLineItemsForDisplay([...byCode.values()]),
    }))
    .sort((a, b) => hubStopNameOrder(a.stopName, b.stopName));
  return {
    title: SAINT_ROCH_HUB_DIALOG_TITLE,
    sections,
  };
}

function showStopAreaHubPopup(stopObj) {
  const summary = buildStopAreaHubSummary(stopObj);
  if (!summary || !summary.sections.length) {
    showAppMessageDialog(
      SAINT_ROCH_HUB_DIALOG_TITLE,
      "Aucune correspondance de pôle supplémentaire disponible.",
    );
    return;
  }
  const dlg = document.getElementById("appMessageDialog");
  const titleEl = document.getElementById("appMessageDialogTitle");
  const bodyEl = document.getElementById("appMessageDialogBody");
  if (dlg && typeof dlg.showModal === "function" && titleEl && bodyEl) {
    titleEl.textContent = summary.title;
    bodyEl.innerHTML = "";
    const sharedPanel = document.createElement("div");
    sharedPanel.className = "app-message-tab-panel";
    sharedPanel.style.marginTop = "10px";
    const allButtons = [];
    function renderSharedDetail(secStopName, entry) {
      for (const btn of allButtons) {
        btn.classList.remove("active");
        btn.setAttribute("aria-selected", "false");
      }
      if (entry._buttonEl) {
        entry._buttonEl.classList.add("active");
        entry._buttonEl.setAttribute("aria-selected", "true");
      }
      sharedPanel.innerHTML = "";
      const stopObjForEta = { stop_name: secStopName };
      appendCorrespondenceLineHeader(sharedPanel, {
        ...entry,
        stopObj: stopObjForEta,
      });
      const stopP = document.createElement("p");
      stopP.style.margin = "0 0 6px";
      stopP.innerHTML = `<strong>Arrêt :</strong> ${secStopName}`;
      sharedPanel.appendChild(stopP);
      const lines = document.createElement("div");
      lines.className = "app-message-tab-panel-lines";
      if (!entry.details.length) {
        const p = document.createElement("p");
        p.style.margin = "0 0 4px";
        p.textContent = "Sens indisponible";
        lines.appendChild(p);
      } else {
        for (const d of entry.details) {
          const p = document.createElement("p");
          p.style.margin = "0 0 4px";
          p.innerHTML = `<strong>${d.sensLabel} :</strong> ${d.headsigns.join(" / ")}`;
          lines.appendChild(p);
        }
      }
      sharedPanel.appendChild(lines);
    }

    let firstEntry = null;
    for (const sec of summary.sections) {
      const h = document.createElement("p");
      h.className = "app-message-tab-panel-title";
      h.style.marginTop = bodyEl.children.length ? "10px" : "0";
      h.textContent = sec.stopName;
      bodyEl.appendChild(h);
      if (!sec.lines.length) {
        const empty = document.createElement("p");
        empty.style.margin = "0 0 8px";
        empty.textContent = "Aucune ligne";
        bodyEl.appendChild(empty);
        continue;
      }
      const entries = sec.lines.map((item) => {
        const info = buildCorrespondenceDirectionInfo(
          { stop_name: sec.stopName },
          item,
        );
        return {
          lineLabel: displayLineLabel(item),
          routeItem: item,
          details: info.map((it) => ({
            sensLabel: directionDisplayLabel(it.dirKey),
            headsigns: it.labels,
          })),
        };
      });
      const tabs = document.createElement("div");
      tabs.className = "app-message-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.style.gridTemplateColumns = `repeat(${entries.length}, minmax(0, 1fr))`;
      for (const entry of entries) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "app-message-tab";
        btn.setAttribute("role", "tab");
        btn.textContent = entry.lineLabel;
        if (entry.routeItem) {
          applyLineColorStyling(btn, entry.routeItem, "contextPill");
        }
        entry._buttonEl = btn;
        allButtons.push(btn);
        btn.addEventListener("click", () => {
          renderSharedDetail(sec.stopName, entry);
        });
        tabs.appendChild(btn);
        if (!firstEntry) {
          firstEntry = { secStopName: sec.stopName, entry };
        }
      }
      bodyEl.appendChild(tabs);
    }
    bodyEl.appendChild(sharedPanel);
    if (firstEntry) {
      renderSharedDetail(firstEntry.secStopName, firstEntry.entry);
    }
    dlg.returnValue = "";
    dlg.showModal();
    return;
  }
  const lines = [summary.title, ""];
  for (const sec of summary.sections) {
    lines.push(sec.stopName);
    if (!sec.lines.length) {
      lines.push("- Aucune ligne");
      lines.push("");
      continue;
    }
    for (const item of sec.lines) {
      appendLineDirectionDetails(lines, { stop_name: sec.stopName }, item);
    }
    lines.push("");
  }
  showAppMessageDialog(summary.title, lines.join("\n").trim());
}

function wireStopRailInfoBadgeInteractions(el, onOpen) {
  if (!(el instanceof HTMLElement)) return;
  let holdTriggered = false;
  const openPopup = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    tamStopRailSuppressInnerClickUntil = performance.now() + 700;
    holdTriggered = true;
    onOpen(ev);
  };

  let holdTimer = null;
  const clearHold = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
  });
  el.addEventListener("contextmenu", openPopup);
  el.addEventListener(
    "touchstart",
    (ev) => {
      ev.stopPropagation();
      holdTriggered = false;
      clearHold();
      holdTimer = setTimeout(() => {
        holdTimer = null;
        openPopup(ev);
      }, 500);
    },
    { passive: true },
  );
  el.addEventListener(
    "touchend",
    (ev) => {
      clearHold();
      ev.stopPropagation();
      if (holdTriggered) {
        ev.preventDefault();
        holdTriggered = false;
      }
    },
    { passive: false },
  );
  el.addEventListener(
    "touchmove",
    () => {
      clearHold();
    },
    { passive: true },
  );
  el.addEventListener(
    "touchcancel",
    (ev) => {
      clearHold();
      holdTriggered = false;
      ev.stopPropagation();
    },
    { passive: true },
  );
}

function wireCorrespondenceBadgeInteractions(el, stopObj, routeItem) {
  wireStopRailInfoBadgeInteractions(el, () => {
    showCorrespondenceDirectionPopup(stopObj, routeItem);
  });
}

// Lignes exploitées TaM en direct (utilisé uniquement pour le tri/affichage).
// NB: les codes sont déjà "nettoyés" (T1->"1") dans `build_simulator_data.py`.
const TAM_CORE_ROUTE_CODES = new Set([
  "1",
  "2",
  "3",
  "4",
  "5", // Tram T1..T5
  "A", // Navette
  "6",
  "7",
  "8",
  "10",
  "11",
  "13",
  "14",
  "15",
  "16",
  "17",
  "19",
  "52",
  "53",
]);

function isTamCoreLineCode(code) {
  const c = String(code || "").trim();
  return !!c && TAM_CORE_ROUTE_CODES.has(c);
}

function updateLines() {
  const byCode = new Map();
  for (const p of data.patterns) {
    const code = String(p.route_short_name || "").trim();
    if (!code) continue;
    if (!byCode.has(code)) {
      byCode.set(code, {
        route_short_name: code,
        route_type: String(p.route_type || ""),
        route_color: p.route_color || "",
      });
    }
  }
  lineOptions = [...byCode.values()].sort((a, b) => {
    const pa = linePriority(a);
    const pb = linePriority(b);
    if (pa !== pb) return pa - pb;
    const aCode = String(a.route_short_name);
    const bCode = String(b.route_short_name);
    if (/^\d+$/.test(aCode) && /^\d+$/.test(bCode)) {
      return Number(aCode) - Number(bCode);
    }
    return aCode.localeCompare(bCode, "fr");
  });

  lineSelect.innerHTML = "";
  lineOptionLookup = [];
  const allTram = lineOptions.filter(isTramDisplayLine);
  const allNavette = lineOptions.filter(
    (x) => String(x.route_short_name) === "A",
  );
  const allBus = lineOptions.filter(
    (x) => !isTramDisplayLine(x) && String(x.route_short_name) !== "A",
  );
  const groups = {
    tramTam: allTram.filter((x) => isTamCoreLineCode(x.route_short_name)),
    tramAutres: allTram.filter((x) => !isTamCoreLineCode(x.route_short_name)),
    navette: allNavette,
    busTam: allBus.filter((x) => isTamCoreLineCode(x.route_short_name)),
    busAutres: allBus.filter((x) => !isTamCoreLineCode(x.route_short_name)),
  };

  /**
   * Note mobile (Chrome / WebView) : des options "fantôme" (spacer) entre
   * chaque vraie ligne s'affichent comme des pastilles vides + décalage
   * des libellés. On regroupe donc par <optgroup> sans option décorative.
   */
  function appendLineOption(og, item) {
    const opt = document.createElement("option");
    opt.value = String(lineOptionLookup.length);
    opt.textContent = displayLineLabel(item);
    applyLineColorStyling(opt, item, "option");
    og.appendChild(opt);
    lineOptionLookup.push(item);
  }

  function addLineGroup(label, items) {
    if (!items || !items.length) return;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const item of items) {
      appendLineOption(og, item);
    }
    lineSelect.appendChild(og);
  }

  addLineGroup("Tram — Réseau TaM", groups.tramTam);
  addLineGroup("Tram — Autres", groups.tramAutres);
  addLineGroup("Navette - Réseau TaM", groups.navette);
  addLineGroup("Bus — Réseau TaM", groups.busTam);
  addLineGroup("Bus — Autres", groups.busAutres);

  // Positionner sur la premiere vraie ligne selectable.
  for (let i = 0; i < lineSelect.options.length; i++) {
    if (!lineSelect.options[i].disabled) {
      lineSelect.selectedIndex = i;
      break;
    }
  }
  rebuildLineCustomList(groups);
  lineSelect.dispatchEvent(new Event("change"));
}

function rebuildLineCustomList(groups) {
  if (!lineSelectListbox) {
    return;
  }
  lineSelectListbox.innerHTML = "";
  if (!lineOptionLookup.length || !groups) {
    if (lineSelectTrigger) {
      lineSelectTrigger.setAttribute("aria-expanded", "false");
    }
    if (lineSelectListbox) {
      lineSelectListbox.hidden = true;
    }
    lineListboxOpen = false;
    return;
  }
  const sections = [
    { label: "Tram — Réseau TaM", items: groups.tramTam },
    { label: "Tram — Autres", items: groups.tramAutres },
    { label: "Navette - Réseau TaM", items: groups.navette },
    { label: "Bus — Réseau TaM", items: groups.busTam },
    { label: "Bus — Autres", items: groups.busAutres },
  ];
  for (const sec of sections) {
    if (!sec.items || !sec.items.length) {
      continue;
    }
    const sep = document.createElement("div");
    sep.className = "line-pick-sep";
    sep.textContent = sec.label;
    lineSelectListbox.appendChild(sep);
    for (const item of sec.items) {
      const idx = lineOptionLookup.indexOf(item);
      if (idx < 0) {
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "line-pick-row";
      btn.setAttribute("data-line-idx", String(idx));
      btn.setAttribute("role", "option");
      btn.textContent = displayLineLabel(item);
      applyLineColorStyling(btn, item, "row");
      lineSelectListbox.appendChild(btn);
    }
  }
  setLineListboxOpen(false);
}

function setLineListboxOpen(open) {
  if (!lineSelectListbox || !lineSelectTrigger) {
    lineListboxOpen = false;
    if (lineSelectListbox) {
      lineSelectListbox.hidden = true;
    }
    return;
  }
  lineListboxOpen = open;
  lineSelectListbox.hidden = !open;
  lineSelectTrigger.setAttribute("aria-expanded", open ? "true" : "false");
  const v = String(lineSelect.value);
  for (const row of lineSelectListbox.querySelectorAll(".line-pick-row")) {
    const ok = row.getAttribute("data-line-idx") === v;
    row.setAttribute("aria-selected", ok ? "true" : "false");
  }
}

function syncLineCustomTrigger() {
  if (lineSelectTrigger && lineSelectTriggerLabel) {
    const val = lineSelect.value;
    const item = lineOptionLookup[Number(val)];
    if (!item) {
      lineSelectTriggerLabel.textContent = "—";
      applyLineColorStyling(
        lineSelectTrigger,
        { route_short_name: "" },
        "trigger",
      );
    } else {
      lineSelectTriggerLabel.textContent = displayLineLabel(item);
      applyLineColorStyling(lineSelectTrigger, item, "trigger");
    }
  }
  applyLineThemeToMissionSubselects(
    lineOptionLookup[Number(lineSelect.value)] || null,
  );
}

function updateHeadsigns() {
  const selectedValue =
    lineSelect.options[lineSelect.selectedIndex]?.value || "";
  let selectedLine =
    lineOptionLookup[Number(selectedValue)]?.route_short_name || "";
  if (!selectedLine) {
    for (let i = 0; i < lineSelect.options.length; i++) {
      const opt = lineSelect.options[i];
      if (opt.disabled) continue;
      lineSelect.selectedIndex = i;
      selectedLine =
        lineOptionLookup[Number(opt.value)]?.route_short_name || "";
      break;
    }
  }
  filteredByLine = data.patterns.filter(
    (p) => p.route_short_name === selectedLine,
  );

  const headsignKeys = uniqueValues(
    filteredByLine,
    (p) => `${p.direction_id}|||${p.headsign}`,
  ).sort((a, b) => a.localeCompare(b, "fr"));

  fillSelect(headsignSelect, headsignKeys, (key) => {
    const parts = key.split("|||");
    const direction = parts[0] || "?";
    const headsign = parts[1] || "Terminus non renseigne";
    return `Sens ${direction} -> ${headsign}`;
  });
  headsignSelect.dispatchEvent(new Event("change"));
}

function updateVariants() {
  const selected =
    headsignSelect.options[headsignSelect.selectedIndex]?.textContent || "";
  const [left, right] = selected.split("->").map((s) => s.trim());
  const directionId = left.replace("Sens ", "").trim();
  const headsign = right || "";

  filteredByHeadsign = filteredByLine.filter(
    (p) => p.direction_id === directionId && p.headsign === headsign,
  );
  filteredByHeadsign.sort((a, b) =>
    a.variant_name.localeCompare(b.variant_name, "fr"),
  );

  fillSelect(variantSelect, filteredByHeadsign, (p) => {
    return `${p.variant_name} - ${p.start_stop} -> ${p.end_stop} (${p.stop_count} arrêts)`;
  });
  updateMissionContextBar();
  if (!running) {
    ensureOpsTargetPattern();
  }
  previewSelectedMission().catch((e) => {
    console.warn("Preview mission failed:", e);
  });
}

/** Texte apres "->" dans l’option 2) Terminus (libelle destination pour le bandeau). */
function parseHeadsignForContextBar(optionText) {
  if (!optionText || !String(optionText).trim()) {
    return "";
  }
  const raw = String(optionText);
  const idx = raw.indexOf("->");
  if (idx === -1) {
    return raw.trim();
  }
  return raw.slice(idx + 2).trim();
}

function updateMissionContextBar() {
  if (!missionContextBar || !missionContextPill || !missionContextDest) {
    return;
  }
  if (typeof data === "undefined" || !data || !lineOptionLookup.length) {
    if (missionContextScroll) {
      missionContextScroll.classList.remove("mission-context-scroll--pan");
      missionContextScroll.scrollLeft = 0;
    }
    missionContextBar.hidden = true;
    return;
  }
  const val = lineSelect.value;
  const item = lineOptionLookup[Number(val)];
  if (!item) {
    if (missionContextScroll) {
      missionContextScroll.classList.remove("mission-context-scroll--pan");
      missionContextScroll.scrollLeft = 0;
    }
    missionContextBar.hidden = true;
    return;
  }
  if (missionContextScroll) {
    missionContextScroll.classList.remove("mission-context-scroll--pan");
    missionContextScroll.scrollLeft = 0;
  }
  missionContextBar.hidden = false;
  missionContextPill.textContent = displayLineLabel(item);
  applyLineColorStyling(missionContextPill, item, "contextPill");
  const headOpt =
    headsignSelect.options[headsignSelect.selectedIndex]?.textContent || "";
  const dest = parseHeadsignForContextBar(headOpt);
  if (dest) {
    missionContextDest.textContent = "\u00a0\u2014\u00a0" + dest;
    missionContextDest.setAttribute("title", dest);
  } else {
    missionContextDest.textContent = "";
    missionContextDest.removeAttribute("title");
  }
}

function selectedPattern() {
  return filteredByHeadsign[variantSelect.selectedIndex] || null;
}

async function fetchRoadGeometry(pattern) {
  // OSRM public API expects lon,lat pairs.
  const coords = pattern.stops.map((s) => `${s.lon},${s.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    const route = payload?.routes?.[0]?.geometry?.coordinates || [];
    if (!route.length) {
      throw new Error("geometrie vide");
    }
    // Convert to Leaflet lat,lon format.
    return route.map((pt) => [pt[1], pt[0]]);
  } catch (err) {
    console.warn("Fallback trace direct (stop->stop):", err);
    return pattern.coordinates;
  }
}

function pointDistance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function rebuildPathMetrics(coords) {
  pathCumMeters = [];
  pathTotalMeters = 0;
  if (!coords || coords.length < 2) {
    return;
  }
  const cum = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    const d = L.latLng(coords[i]).distanceTo(L.latLng(coords[i + 1]));
    cum.push(cum[i] + d);
  }
  pathCumMeters = cum;
  pathTotalMeters = cum[cum.length - 1];
}

/**
 * Projete un point sur la polyligne active.
 * @returns {{ alongMeters: number, crossTrackMeters: number }} distance curviligne depuis le départ et écart latéral (m) au segment le plus proche.
 */
function projectLatLngOntoActivePath(lat, lng) {
  const coords = activeCoordinates;
  const cum = pathCumMeters;
  if (!coords || coords.length < 2 || !cum.length) {
    return { alongMeters: 0, crossTrackMeters: Infinity };
  }
  const s = L.latLng(lat, lng);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = L.latLng(coords[i]);
    const p1 = L.latLng(coords[i + 1]);
    const segLenM = p0.distanceTo(p1);
    if (segLenM < 1e-6) {
      const d0 = s.distanceTo(p0);
      if (d0 < bestD) {
        bestD = d0;
        best = cum[i];
      }
      continue;
    }
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
  return { alongMeters: best, crossTrackMeters: bestD };
}

/** Projete un point sur la polyligne : distance (m) depuis le départ du tracé. */
function distanceAlongPathForLatLng(lat, lng) {
  return projectLatLngOntoActivePath(lat, lng).alongMeters;
}

function normalizeStopMeters(raw, total) {
  if (!raw.length) return [];
  if (raw.length === 1) return [0];
  const eps = 0.5; // metres mini entre deux arrets consecutifs
  const out = new Array(raw.length);
  out[0] = 0;
  for (let i = 1; i < raw.length; i++) {
    const remaining = raw.length - 1 - i;
    const maxAllowed = Math.max(0, total - remaining * eps);
    const candidate = Math.min(maxAllowed, Math.max(out[i - 1] + eps, raw[i]));
    out[i] = Math.max(out[i - 1], candidate);
  }
  out[out.length - 1] = total;
  return out;
}

function buildStopMetersAlong(pattern) {
  const stops = pattern?.stops;
  if (!stops || !stops.length) {
    return [];
  }
  const raw = stops.map((s) => distanceAlongPathForLatLng(s.lat, s.lon));
  return normalizeStopMeters(raw, pathTotalMeters);
}

function pointAtDistanceMeters(d) {
  const coords = activeCoordinates;
  const cum = pathCumMeters;
  if (!coords || coords.length < 2 || !cum.length) {
    return coords && coords[0] ? coords[0] : [43.61, 3.88];
  }
  if (d <= 0) {
    return coords[0];
  }
  if (d >= pathTotalMeters) {
    return coords[coords.length - 1];
  }
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cum[mid] < d) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const i = lo;
  const a = coords[i];
  const b = coords[i + 1];
  const d0 = cum[i];
  const d1 = cum[i + 1];
  const segM = d1 - d0;
  const t = segM < 1e-6 ? 0 : (d - d0) / segM;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

function pathWindowBetweenMeters(d0, d1) {
  const coords = activeCoordinates;
  const cum = pathCumMeters;
  if (!coords || coords.length < 2 || !cum.length) {
    return [];
  }
  const total = pathTotalMeters;
  const from = Math.max(0, Math.min(total, d0));
  const to = Math.max(0, Math.min(total, d1));
  if (Math.abs(to - from) < 1e-3) {
    return [];
  }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const pts = [pointAtDistanceMeters(lo)];
  for (let i = 1; i < coords.length - 1; i++) {
    if (cum[i] > lo && cum[i] < hi) {
      pts.push(coords[i]);
    }
  }
  pts.push(pointAtDistanceMeters(hi));
  if (from > to) {
    pts.reverse();
  }
  return pts;
}

function trimActivePathToPatternStops(pattern) {
  const stops = pattern?.stops || [];
  if (!stops.length || activeCoordinates.length < 2 || pathTotalMeters <= 0) {
    return;
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const dStart = distanceAlongPathForLatLng(first.lat, first.lon);
  const dEnd = distanceAlongPathForLatLng(last.lat, last.lon);
  const cropped = pathWindowBetweenMeters(dStart, dEnd);
  if (cropped.length >= 2) {
    activeCoordinates = cropped;
    rebuildPathMetrics(activeCoordinates);
  }
}

/** Cap (degres, horaire depuis le nord) entre deux points [lat, lon]. */
function bearingBetweenPoints(p1, p2) {
  if (!p1 || !p2) {
    return 0;
  }
  const φ1 = (p1[0] * Math.PI) / 180;
  const φ2 = (p2[0] * Math.PI) / 180;
  const Δλ = ((p2[1] - p1[1]) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cap d'avancement le long de la polyligne au point d. */
function getTrackBearingDeg(d) {
  if (!pathTotalMeters || pathTotalMeters < 0.1) {
    return 0;
  }
  if (!activeCoordinates || activeCoordinates.length < 2) {
    return 0;
  }
  const look = Math.min(12, Math.max(pathTotalMeters * 0.05, 2));
  let d1 = Math.max(0, d);
  let d2 = Math.min(pathTotalMeters, d1 + look);
  if (d2 - d1 < 0.15) {
    d1 = Math.max(0, d - 3);
    d2 = d;
  }
  return bearingBetweenPoints(
    pointAtDistanceMeters(d1),
    pointAtDistanceMeters(d2),
  );
}

/**
 * Met a jour le triangle, le cap (rotation carte ou de l'icone) et optionnellement la camera.
 * @param { { centerCamera?: boolean, zoom?: number } } opt
 *        centerCamera false : apres fitBounds, ne deplace pas la vue.
 */
function updateMapNavigation(opt) {
  if (!currentPattern || pathTotalMeters <= 0) {
    return;
  }
  const o = opt || {};
  const centerCamera = o.centerCamera !== false;
  const d = distanceAlongPathMeters;
  const useRealGpsPosition =
    driveMode === DRIVE_MODE.REAL && Array.isArray(lastGpsLatLng);
  const maxSnap =
    typeof GPS_SNAP_CROSS_TRACK_MAX_M === "number"
      ? GPS_SNAP_CROSS_TRACK_MAX_M
      : 10;
  const gpsFarFromLine =
    useRealGpsPosition &&
    lastGpsCrossTrackM != null &&
    Number.isFinite(lastGpsCrossTrackM) &&
    lastGpsCrossTrackM > maxSnap;
  /* GPS réel : coller au tracé seulement si l’écart latéral ≤ seuil ; sinon position brute (hors ligne). */
  const pos = gpsFarFromLine ? lastGpsLatLng : pointAtDistanceMeters(d);
  const brg = useRealGpsPosition
    ? lastGpsHeadingDeg != null
      ? lastGpsHeadingDeg
      : getTrackBearingDeg(d)
    : getTrackBearingDeg(d);
  marker.setLatLng(pos);
  const el =
    typeof marker.getElement === "function" ? marker.getElement() : null;
  const tri = el ? el.querySelector(".nav-triangle") : null;
  if (headingUpEl && headingUpEl.checked) {
    if (typeof map.setBearing === "function") {
      map.setBearing((360 - brg) % 360);
    }
    if (tri) {
      tri.style.transform = "none";
    }
  } else {
    if (typeof map.setBearing === "function") {
      map.setBearing(0);
    }
    if (tri) {
      tri.style.transform = "rotate(" + brg + "deg)";
      tri.style.transformOrigin = "50% 65%";
    }
  }
  if (centerCamera) {
    if (o.zoom != null) {
      map.setView(pos, o.zoom, { animate: false });
    } else {
      map.setView(pos, map.getZoom(), { animate: false });
    }
  }
}

function currentStopIndexForDistance(d) {
  if (!stopMetersAlong.length) {
    return 0;
  }
  let k = 0;
  for (let s = 0; s < stopMetersAlong.length; s++) {
    if (stopMetersAlong[s] <= d + 0.5) {
      k = s;
    }
  }
  return k;
}

function redrawDoneLineAtDistance(d) {
  if (!currentPattern) {
    return;
  }
  const coords = activeCoordinates;
  if (!coords || coords.length < 2) {
    return;
  }
  if (d <= 0) {
    doneLine.setLatLngs([coords[0]]);
    return;
  }
  if (d >= pathTotalMeters - 1e-3) {
    doneLine.setLatLngs([...coords]);
    return;
  }
  const pos = pointAtDistanceMeters(d);
  const cum = pathCumMeters;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (cum[mid] < d) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const i = lo;
  const head = coords.slice(0, i + 1);
  head.push(pos);
  doneLine.setLatLngs(head);
}

function getSpeechVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return [];
  }
  return window.speechSynthesis.getVoices() || [];
}

function isFrenchVoice(v) {
  if (!v || !v.lang) {
    return false;
  }
  const l = v.lang.toLowerCase();
  return l.startsWith("fr") || l === "fr";
}

/** Tri par qualite (heuristique) : on evite d'imposer la premiere voix pourrie si une meilleure existe. */
function voiceHeuristicScore(v) {
  const n = (v.name + " " + (v.voiceURI || "")).toLowerCase();
  let s = 0;
  if (n.includes("neural")) s += 90;
  if (n.includes("natural")) s += 55;
  if (n.includes("premium") || n.includes("enhanced") || n.includes("hd "))
    s += 45;
  if (n.includes("google")) s += 40;
  if (
    n.includes("microsoft") ||
    n.includes("hortense") ||
    n.includes("julie") ||
    n.includes("paul ")
  )
    s += 35;
  if (n.includes("apple") || n.includes("amelie") || n.includes("thomas "))
    s += 25;
  if (n.includes("samantha")) s += 15;
  if (n.includes("pico") || n.includes("espeak") || n.includes("festival "))
    s -= 80;
  return s;
}

function pickAutoFrenchVoice() {
  const list = getSpeechVoices().filter(isFrenchVoice);
  if (!list.length) {
    return null;
  }
  return list
    .slice()
    .sort((a, b) => voiceHeuristicScore(b) - voiceHeuristicScore(a))[0];
}

function resolveCurrentVoice() {
  const val = voiceSelectEl.value;
  if (val && val !== "__auto__") {
    return (
      getSpeechVoices().find(
        (v) => (v.voiceURI && v.voiceURI === val) || v.name === val,
      ) || null
    );
  }
  return pickAutoFrenchVoice();
}

function speakProchainArret(nom, forTest) {
  if (!forTest && !voiceEnabledEl.checked) {
    return;
  }
  if (!nom) {
    return;
  }
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return;
  }
  const voice = resolveCurrentVoice();
  try {
    window.speechSynthesis.cancel();
  } catch (e) {
    // ignore
  }
  const spokenName = getStopSpeechName(nom);
  const u = new SpeechSynthesisUtterance(`Prochain arrêt, ${spokenName}.`);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang && voice.lang.length ? voice.lang : "fr-FR";
  } else {
    // Fallback: on laisse le moteur choisir la voix systeme.
    u.lang = "fr-FR";
  }
  u.rate = 0.92;
  u.pitch = 1.0;
  u.volume = 1.0;
  window.speechSynthesis.speak(u);
}

function resyncVoixForPosition(d) {
  if (!stopMetersAlong.length || !currentPattern || !currentPattern.stops) {
    return;
  }
  // Recalcule l'historique d'annonces depuis la position courante.
  // Important pour "Arrêt précédent": on doit pouvoir réentendre les annonces
  // après un retour en arrière, au lieu de garder les anciennes clés en mémoire.
  voixAnnounced = new Set();
  const g = servedGuideSnapshot;
  if (g.length >= 2) {
    for (let p = 0; p < g.length - 1; p++) {
      const mi = g[p].meters || 0;
      const mj = g[p + 1].meters || 0;
      if (d > mi + 0.5) {
        voixAnnounced.add(`dgp_${p}`);
      }
      const mid = (mi + mj) / 2;
      if (d > mid + 0.5) {
        voixAnnounced.add(`mgp_${p}`);
      }
    }
    return;
  }
  const served = getServedStopIndices();
  for (let p = 0; p < served.length - 1; p++) {
    const i = served[p];
    const j = served[p + 1];
    if (d > (stopMetersAlong[i] || 0) + 0.5) {
      voixAnnounced.add(`d${i}_${j}`);
    }
    const mid = ((stopMetersAlong[i] || 0) + (stopMetersAlong[j] || 0)) / 2;
    if (d > mid + 0.5) {
      voixAnnounced.add(`m${i}_${j}`);
    }
  }
}

function maybeAnnounceProchainArret(prev, curr) {
  if (!voiceEnabledEl.checked || !currentPattern) {
    return;
  }
  const mode = voiceModeEl.value;
  if (!mode) {
    return;
  }
  const stops = currentPattern.stops;
  if (!stops || stops.length < 2) {
    return;
  }
  if (prev == null || curr == null || prev > curr) {
    return;
  }
  const g = servedGuideSnapshot;
  if (g.length >= 2) {
    for (let p = 0; p < g.length - 1; p++) {
      const i = g[p];
      const j = g[p + 1];
      const nextName = j.name || "";
      const tDep = i.meters || 0;
      const tMid = ((i.meters || 0) + (j.meters || 0)) / 2;
      if (mode === "depart" || mode === "both") {
        if (prev < tDep && curr >= tDep && !voixAnnounced.has(`dgp_${p}`)) {
          voixAnnounced.add(`dgp_${p}`);
          speakProchainArret(nextName);
        }
      }
      if (mode === "mid" || mode === "both") {
        if (prev < tMid && curr >= tMid && !voixAnnounced.has(`mgp_${p}`)) {
          voixAnnounced.add(`mgp_${p}`);
          speakProchainArret(nextName);
        }
      }
    }
    return;
  }
  const served = getServedStopIndices();
  for (let p = 0; p < served.length - 1; p++) {
    const i = served[p];
    const j = served[p + 1];
    const nextName = stops[j] ? stops[j].stop_name : "";
    if (mode === "depart" || mode === "both") {
      const t = stopMetersAlong[i] || 0;
      if (prev < t && curr >= t && !voixAnnounced.has(`d${i}_${j}`)) {
        voixAnnounced.add(`d${i}_${j}`);
        speakProchainArret(nextName);
      }
    }
    if (mode === "mid" || mode === "both") {
      const t = ((stopMetersAlong[i] || 0) + (stopMetersAlong[j] || 0)) / 2;
      if (prev < t && curr >= t && !voixAnnounced.has(`m${i}_${j}`)) {
        voixAnnounced.add(`m${i}_${j}`);
        speakProchainArret(nextName);
      }
    }
  }
}

function announceInitialNextStopIfNeeded() {
  if (
    !voiceEnabledEl.checked ||
    !currentPattern?.stops ||
    currentPattern.stops.length < 2
  ) {
    return;
  }
  const g = servedGuideSnapshot;
  if (g.length >= 2) {
    if (voixAnnounced.has(`dgp_0`)) {
      return;
    }
    voixAnnounced.add(`dgp_0`);
    speakProchainArret(g[1].name || "");
    return;
  }
  const served = getServedStopIndices();
  if (served.length < 2) {
    return;
  }
  const first = served[0];
  const second = served[1];
  if (voixAnnounced.has(`d${first}_${second}`)) {
    return;
  }
  voixAnnounced.add(`d${first}_${second}`);
  speakProchainArret(currentPattern.stops[second].stop_name);
}

/**
 * Déplace la position simulation sur un arrêt desservi (précédent / suivant),
 * même quand certains arrêts sont désactivés. Utilisée par précédent / suivant
 * pour garder un seul chemin mise à jour + annonces.
 * @param {number} delta -1 précédent, +1 suivant
 */
function jumpServedStop(delta) {
  if (!currentPattern || pathTotalMeters <= 0) return false;
  if (
    typeof blockMissionResumeIfUnsavedDeviation === "function" &&
    blockMissionResumeIfUnsavedDeviation()
  ) {
    return false;
  }
  const stops = currentPattern.stops;
  if (!stops?.length || !stopMetersAlong.length) return false;

  const g = servedGuideSnapshot;
  if (g.length >= 2) {
    let pos = 0;
    for (let p = 0; p < g.length; p++) {
      if ((g[p].meters || 0) <= distanceAlongPathMeters + 0.5) {
        pos = p;
      }
    }
    const nextPos =
      delta < 0 ? Math.max(pos - 1, 0) : Math.min(pos + 1, g.length - 1);
    distanceAlongPathMeters = g[nextPos].meters || 0;
    lastRafTime = 0;
    resyncVoixForPosition(distanceAlongPathMeters);
    lastVoiceDistance = distanceAlongPathMeters;
    updateMapNavigation();
    redrawDoneLineAtDistance(distanceAlongPathMeters);
    updateStopToStopOverlay();
    updateStats();
    if (voiceEnabledEl.checked) {
      const slots = getCurrentAndNextServedGuideSlots(distanceAlongPathMeters);
      if (
        slots.next &&
        slots.curr &&
        (slots.next.meters || 0) > (slots.curr.meters || 0) + 0.25
      ) {
        speakProchainArret(slots.next.name || "");
      }
    }
    return true;
  }

  const served = getServedStopIndices();
  if (!served.length) return false;

  let idx = served[0] || 0;
  for (let p = 0; p < served.length; p++) {
    if ((stopMetersAlong[served[p]] || 0) <= distanceAlongPathMeters + 0.5) {
      idx = served[p];
    }
  }
  const pos = Math.max(0, served.indexOf(idx));
  const nextPos =
    delta < 0 ? Math.max(pos - 1, 0) : Math.min(pos + 1, served.length - 1);
  idx = served[nextPos] ?? idx;

  distanceAlongPathMeters = stopMetersAlong[idx];
  lastRafTime = 0;
  resyncVoixForPosition(distanceAlongPathMeters);
  lastVoiceDistance = distanceAlongPathMeters;
  updateMapNavigation();
  redrawDoneLineAtDistance(distanceAlongPathMeters);
  updateStopToStopOverlay();
  updateStats();

  if (voiceEnabledEl.checked) {
    const slots = getCurrentAndNextServedGuideSlots(distanceAlongPathMeters);
    if (
      slots.next &&
      slots.curr &&
      (slots.next.meters || 0) > (slots.curr.meters || 0) + 0.25
    ) {
      speakProchainArret(slots.next.name || "");
    }
  }

  return true;
}

function refreshVoiceSelect() {
  if (!voiceSelectEl) {
    return;
  }
  const before = voiceSelectEl.value;
  const voices = getSpeechVoices();
  const saved = (() => {
    try {
      return localStorage.getItem(LS_KEY_VOICE);
    } catch (e) {
      return null;
    }
  })();
  voiceSelectEl.innerHTML = "";
  const oAuto = document.createElement("option");
  oAuto.value = "__auto__";
  oAuto.textContent = "Automatique (meilleure voix fr disponible)";
  voiceSelectEl.appendChild(oAuto);
  const fr = voices.filter(isFrenchVoice);
  fr.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  for (const v of fr) {
    const o = document.createElement("option");
    o.value = v.voiceURI || v.name;
    o.textContent = `${v.name} (${v.lang || "fr"})`;
    voiceSelectEl.appendChild(o);
  }
  const tryVal =
    before && fr.some((x) => (x.voiceURI || x.name) === before)
      ? before
      : saved && fr.some((x) => (x.voiceURI || x.name) === saved)
        ? saved
        : "__auto__";
  voiceSelectEl.value = fr.length ? tryVal : "__auto__";
}

function reverseCoordinates(coords) {
  const copy = [...coords];
  copy.reverse();
  return copy;
}

function getNetworkGeometryByLine(features, pattern) {
  if (!features.length) return null;

  const line = String(pattern.route_short_name);
  const start = pattern.coordinates[0];
  const end = pattern.coordinates[pattern.coordinates.length - 1];

  const candidates = features.filter(
    (f) => String(f.line_code) === line && f.coordinates?.length > 1,
  );
  if (!candidates.length) return null;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const coords = candidate.coordinates;
    const first = coords[0];
    const last = coords[coords.length - 1];

    const directScore = pointDistance(start, first) + pointDistance(end, last);
    const reverseScore = pointDistance(start, last) + pointDistance(end, first);

    if (directScore < bestScore) {
      bestScore = directScore;
      best = { coords, nom_ligne: candidate.nom_ligne };
    }
    if (reverseScore < bestScore) {
      bestScore = reverseScore;
      best = {
        coords: reverseCoordinates(coords),
        nom_ligne: candidate.nom_ligne,
      };
    }
  }

  // Guard against unrelated branches that are too far from GTFS start/end.
  if (!best || bestScore > 0.08) {
    return null;
  }
  return best;
}

function getBusNetworkGeometry(pattern) {
  return getNetworkGeometryByLine(data?.bus_network_features || [], pattern);
}

function getTramNetworkGeometry(pattern) {
  return getNetworkGeometryByLine(data?.tram_network_features || [], pattern);
}

function updateStopToStopOverlay() {
  if (typeof tamUpdateStopToStopGuide !== "function") {
    stopToStopLayer.clearLayers();
    if (segmentGuideInfoEl) {
      segmentGuideInfoEl.textContent = "-";
    }
    return;
  }
  const info = tamUpdateStopToStopGuide(
    map,
    stopToStopLayer,
    activeCoordinates,
    pathCumMeters,
    activeStopMetersForGuide,
    distanceAlongPathMeters,
  );
  if (segmentGuideInfoEl) {
    if (!info || info.segmentIndex < 0 || info.totalSegments <= 0) {
      segmentGuideInfoEl.textContent = "-";
    } else {
      segmentGuideInfoEl.textContent = `${info.segmentIndex + 1}/${info.totalSegments}`;
    }
  }
}

async function setMission(pattern, opts) {
  const o = opts || {};
  previewOnlyMode = !!o.previewOnly;
  if (previewOnlyMode) {
    mapMissionHudSessionActive = false;
    hideMapMissionHud();
  }
  stopManualDrawMode();
  currentPattern = pattern;
  distanceAlongPathMeters = 0;
  lastRafTime = 0;
  lastVoiceDistance = 0;
  voixAnnounced = new Set();
  const keepPrefill =
    !o.forceOpsReset &&
    !!opsState.targetPatternId &&
    opsState.targetPatternId === (pattern.pattern_id || "");
  if (!keepPrefill) {
    resetOpsStateForMission({
      preserveTemporarySnapshot:
        restoringTemporarySnapshot || !!o.preserveTemporarySnapshot,
    });
  }
  opsState.targetPatternId = pattern.pattern_id || "";
  missionName.textContent = `Ligne ${pattern.route_short_name} | ${pattern.headsign} | ${pattern.variant_name}`;

  const isTram = String(pattern.route_type) === "0";
  const tramGeom = isTram ? getTramNetworkGeometry(pattern) : null;
  const busGeom = !isTram ? getBusNetworkGeometry(pattern) : null;
  if (tramGeom) {
    activeCoordinates = tramGeom.coords;
    traceSource = `Réseau tram 3M (${tramGeom.nom_ligne || "ligne"})`;
  } else if (busGeom) {
    activeCoordinates = busGeom.coords;
    traceSource = `Réseau bus 3M (${busGeom.nom_ligne || "ligne"})`;
  } else {
    activeCoordinates = await fetchRoadGeometry(pattern);
    if (activeCoordinates.length && activeCoordinates !== pattern.coordinates) {
      traceSource = "OSRM routier";
    } else {
      traceSource = "GTFS arrêt → arrêt";
    }
    if (!activeCoordinates.length) {
      activeCoordinates = pattern.coordinates;
      traceSource = "GTFS arrêt → arrêt";
    }
  }
  opsState.baseCoordinates = [...activeCoordinates];
  if (!keepPrefill) {
    opsState.modeCoordinates.MANUEL_ACTIF = null;
    opsState.manualProfile = null;
    opsState.manualStopOverrides = {};
    opsState.nonServedEditActive = false;
    opsState.provisionalStops = [];
    opsState.provisionalEditActive = false;
    nonServedEditFocusStopId = null;
    clearManualRouteOverlayLayers();
  }

  rebuildPathMetrics(activeCoordinates);
  trimActivePathToPatternStops(pattern);
  stopMetersAlong = buildStopMetersAlong(pattern);
  recomputeSkippedAndRedrawStopLayers();

  fullLine.setLatLngs(activeCoordinates);
  doneLine.setLatLngs([activeCoordinates[0]]);
  // Reset explicite a chaque mission pour forcer le redraw du troncon actif.
  stopToStopLayer.clearLayers();
  stopToStopLayer.__tamSegIdx = -1;

  updateStopToStopOverlay();

  if (headingUpEl.checked) {
    updateMapNavigation({ centerCamera: true, zoom: 16 });
  } else {
    map.fitBounds(fullLine.getBounds(), { padding: [20, 20] });
    updateMapNavigation({ centerCamera: false });
  }
  if (!previewOnlyMode) {
    announceInitialNextStopIfNeeded();
  }
  finalizeInitialOpsMode();
  const startMode = recomputeOpsMode();
  if (startMode !== OPS_MODE.BASE) {
    await applyTraceForOpsMode(startMode, { centerCamera: false });
  }
  refreshMapLayout();
  refreshProvisionalUi();
  updateStats();
  refreshRecapDeviationMeta();
  if (!o.skipPlannedBaselineSync) {
    syncPlannedSaveBaselineFromLive();
  }
}

/** Positionne le scroll (mode compact uniquement si le contenu dépasse — souvent inutile avec pastilles réparties sur toute la hauteur). */
function snapTamStopRailScrollToLastPastCore() {
  const { scroll, root } = getTamStopRailEls();
  if (!scroll || !root || root.hidden) return;
  const stops = currentPattern?.stops;
  if (!stops?.length) return;
  const n = stops.length;
  const d = distanceAlongPathMeters;
  const k = currentStopIndexForDistance(d);
  const complete = pathTotalMeters > 0 && d >= pathTotalMeters - 0.05;
  const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);

  let target;
  if (k <= 0 && !complete) {
    target = maxScroll;
  } else {
    const lastPastIdx = complete ? n - 1 : k - 1;
    const btn = scroll.querySelector(
      `.tam-stop-rail__pill[data-tam-stop-idx="${lastPastIdx}"]`,
    );
    if (!btn) {
      target = maxScroll;
    } else {
      const sr = scroll.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const topInContent = br.top - sr.top + scroll.scrollTop;
      const bottomInContent = topInContent + btn.offsetHeight;
      const pad = 3;
      target = bottomInContent - scroll.clientHeight + pad;
    }
  }
  const clamped = Math.min(maxScroll, Math.max(0, Math.round(target)));
  if (Math.abs(scroll.scrollTop - clamped) < 2) return;
  scroll.scrollTop = clamped;
}

function snapTamStopRailScrollToLastPastImpl() {
  const { root } = getTamStopRailEls();
  if (!root || root.hidden) return;
  if (root.classList.contains("tam-stop-rail--explore")) return;
  snapTamStopRailScrollToLastPastCore();
}

/** Auto-scroll uniquement en mode compact (pas de recolle à chaque frame en liste étendue). */
function maybeAutoSnapTamStopRailScroll(k) {
  const { root, scroll } = getTamStopRailEls();
  if (!root || !scroll || root.hidden) return;
  if (root.classList.contains("tam-stop-rail--explore")) return;
  if (tamStopRailLastAutoSnapK === k) return;
  tamStopRailLastAutoSnapK = k;
  if (tamStopRailSnapRaf) {
    cancelAnimationFrame(tamStopRailSnapRaf);
  }
  tamStopRailSnapRaf = requestAnimationFrame(() => {
    tamStopRailSnapRaf = 0;
    snapTamStopRailScrollToLastPastImpl();
  });
}

function getTamStopRailEls() {
  return {
    root: document.getElementById("tamStopRail"),
    inner: document.getElementById("tamStopRailInner"),
    scroll: document.getElementById("tamStopRailScroll"),
    fill: document.getElementById("tamStopRailProgressFill"),
  };
}

function setTamStopRailExploreOpen(open) {
  const { root } = getTamStopRailEls();
  if (!root) return;
  if (open) {
    root.style.removeProperty("--tam-rail-pill");
    root.classList.add("tam-stop-rail--explore");
    tamStopRailCurrentLineRtPeriodicAt = Date.now();
    scheduleTamStopRailCurrentLineRealtime();
    return;
  }
  root.classList.remove("tam-stop-rail--explore");
  tamStopRailCurrentLineRtRefreshGen++;
  tamStopRailLastAutoSnapK = null;
  requestAnimationFrame(() => {
    snapTamStopRailScrollToLastPastImpl();
    tamStopRailLastAutoSnapK = currentStopIndexForDistance(
      distanceAlongPathMeters,
    );
    updateTamStopRailCompactSpacing();
  });
}

function scrollTamStopRailStopToBottom(patternIdx) {
  const { root, scroll } = getTamStopRailEls();
  if (!root || !scroll || root.hidden) return;
  const idx = Number(patternIdx);
  if (!Number.isFinite(idx)) return;
  const btn = scroll.querySelector(
    `.tam-stop-rail__pill[data-tam-stop-idx="${idx}"]`,
  );
  if (!(btn instanceof HTMLElement)) return;
  const sr = scroll.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const topInContent = br.top - sr.top + scroll.scrollTop;
  const bottomInContent = topInContent + btn.offsetHeight;
  const pad = 4;
  const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  const target = bottomInContent - scroll.clientHeight + pad;
  scroll.scrollTop = Math.min(maxScroll, Math.max(0, Math.round(target)));
}

function openTamStopRailAtNextStop() {
  const pair = getCurrentAndNextServedGuideSlots(distanceAlongPathMeters);
  const next = pair.next;
  if (!next || next.kind !== "gtfs") {
    setTamStopRailExploreOpen(true);
    return;
  }
  setTamStopRailExploreOpen(true);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollTamStopRailStopToBottom(next.patternIdx);
    });
  });
}

function formatTamArrivalMinutes(arrivals) {
  const items = Array.isArray(arrivals) ? arrivals : [];
  return items
    .slice(0, 4)
    .map((it) => {
      const m = Number(it?.minutes);
      if (!Number.isFinite(m)) return "";
      return `${Math.max(0, Math.round(m))}′`;
    })
    .filter(Boolean)
    .join(" ");
}

async function fetchTamStopRailArrivals(stopId, routeCode) {
  const stop = String(stopId || "").trim();
  const route = String(routeCode || "").trim();
  if (!stop || !route) return null;
  const key = `${stop}|${route}`;
  const now = Date.now();
  const cached = tamStopRailArrivalCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }
  const url =
    `${TAM_REALTIME_API_BASE}/arrivals?` +
    new URLSearchParams({ stop_id: stop, route, limit: "4" }).toString();
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const payload = await resp.json();
  tamStopRailArrivalCache.set(key, {
    expiresAt: now + TAM_STOP_RAIL_ARRIVALS_CACHE_MS,
    payload,
  });
  return payload;
}

function firstTamArrivalMinuteRounded(payload) {
  const arr = payload?.arrivals;
  if (!Array.isArray(arr) || !arr.length) return null;
  const m = Number(arr[0]?.minutes);
  if (!Number.isFinite(m)) return null;
  return Math.max(0, Math.round(m));
}

function extractTamArrivalCandidates(payload) {
  const arr = payload?.arrivals;
  if (!Array.isArray(arr) || !arr.length) return [];
  const out = [];
  for (const it of arr) {
    const m = Number(it?.minutes);
    if (!Number.isFinite(m)) continue;
    const tripId = String(it?.trip_id || "").trim();
    out.push({ min: Math.max(0, Math.round(m)), tripId });
  }
  return out;
}

function pickCandidateClosestToGtfs(cands, gtfsMin, minFloor) {
  const vs = Array.isArray(cands) ? cands : [];
  const g = Number(gtfsMin);
  const gOk = Number.isFinite(g) ? Math.max(1, Math.round(g)) : 1;
  const floor = Number.isFinite(minFloor) ? minFloor : 0;
  let best = null;
  let bestDist = Infinity;
  for (const c of vs) {
    const v = Number(c?.min);
    if (!Number.isFinite(v) || v < floor) continue;
    const dist = Math.abs(v - gOk);
    if (dist < bestDist || (dist === bestDist && v > (best?.min ?? -1))) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

const TAM_STOP_RAIL_LINE_RT_DEBOUNCE_MS = 260;
const TAM_STOP_RAIL_LINE_RT_PERIODIC_MS = 22_000;
const TAM_STOP_RAIL_LINE_RT_PARALLEL = 5;
const TAM_STOP_RAIL_LINE_RT_MAX_STOPS_AHEAD = 12;

function scheduleTamStopRailCurrentLineRealtime() {
  if (tamStopRailCurrentLineRtScheduleTid) {
    clearTimeout(tamStopRailCurrentLineRtScheduleTid);
    tamStopRailCurrentLineRtScheduleTid = 0;
  }
  tamStopRailCurrentLineRtScheduleTid = window.setTimeout(() => {
    tamStopRailCurrentLineRtScheduleTid = 0;
    void refreshTamStopRailCurrentLineRealtime();
  }, TAM_STOP_RAIL_LINE_RT_DEBOUNCE_MS);
}

function maybePeriodicTamStopRailCurrentLineRealtime() {
  const { root } = getTamStopRailEls();
  if (
    !root ||
    root.hidden ||
    !root.classList.contains("tam-stop-rail--explore")
  ) {
    return;
  }
  const now = Date.now();
  if (now - tamStopRailCurrentLineRtPeriodicAt < TAM_STOP_RAIL_LINE_RT_PERIODIC_MS)
    return;
  tamStopRailCurrentLineRtPeriodicAt = now;
  scheduleTamStopRailCurrentLineRealtime();
}

function collectTamStopRailCurrentLineRtJobs() {
  const stops = currentPattern?.stops;
  if (!stops?.length) return [];
  const route = String(currentPattern?.route_short_name || "").trim();
  if (!route) return [];
  const k = currentStopIndexForDistance(distanceAlongPathMeters);
  const hi = Math.min(stops.length - 1, k + TAM_STOP_RAIL_LINE_RT_MAX_STOPS_AHEAD);
  /** @type {{ stopIdx: number, stopId: string, route: string }[]} */
  const jobs = [];
  for (let idx = k + 1; idx <= hi; idx++) {
    const st = stops[idx];
    const sid = String(st?.stop_id || "").trim();
    if (!sid) continue;
    jobs.push({ stopIdx: idx, stopId: sid, route });
  }
  return jobs;
}

async function refreshTamStopRailCurrentLineRealtime() {
  const { root, scroll } = getTamStopRailEls();
  if (
    !root ||
    root.hidden ||
    !scroll ||
    !root.classList.contains("tam-stop-rail--explore")
  ) {
    return;
  }
  const gen = ++tamStopRailCurrentLineRtRefreshGen;
  const jobs = collectTamStopRailCurrentLineRtJobs();
  if (!jobs.length) {
    tamStopRailCurrentLineRtCandidatesByStopIdx = new Map();
    updateTamStopRailScheduleEtas();
    return;
  }
  /** @type {Map<number, { min: number, tripId: string }[]>} */
  const byIdx = new Map();
  for (let i = 0; i < jobs.length; i += TAM_STOP_RAIL_LINE_RT_PARALLEL) {
    if (gen !== tamStopRailCurrentLineRtRefreshGen) return;
    const slice = jobs.slice(i, i + TAM_STOP_RAIL_LINE_RT_PARALLEL);
    await Promise.all(
      slice.map(async ({ stopIdx, stopId, route }) => {
        try {
          const payload = await fetchTamStopRailArrivals(stopId, route);
          if (gen !== tamStopRailCurrentLineRtRefreshGen) return;
          const cands = extractTamArrivalCandidates(payload);
          if (cands.length) byIdx.set(stopIdx, cands);
        } catch (err) {
          console.warn("Temps réel ligne courante — échec:", err);
        }
      }),
    );
  }
  if (gen !== tamStopRailCurrentLineRtRefreshGen) return;
  tamStopRailCurrentLineRtCandidatesByStopIdx = byIdx;
  updateTamStopRailScheduleEtas();
}

function updateTamStopRailCompactSpacing() {
  const { root, scroll } = getTamStopRailEls();
  if (!root || !scroll) return;
  if (root.hidden || root.classList.contains("tam-stop-rail--explore")) {
    root.style.removeProperty("--tam-rail-pill");
    return;
  }
  const n = scroll.querySelectorAll(".tam-stop-rail__pill").length;
  if (!n) {
    root.style.removeProperty("--tam-rail-pill");
    return;
  }
  const cs = getComputedStyle(scroll);
  const padY =
    (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const innerH = Math.max(0, scroll.clientHeight - padY);
  if (innerH <= 0) return;
  const maxP = 12;
  const minP = 5;
  let p = maxP;
  if (n * maxP > innerH) {
    p = Math.max(minP, Math.floor((innerH / n) * 10) / 10);
  }
  root.style.setProperty("--tam-rail-pill", `${p}px`);
}

function ensureTamStopRailWired() {
  const { scroll, root, inner } = getTamStopRailEls();
  if (!scroll || !root || !inner || inner.dataset.tamRailWired) return;
  inner.dataset.tamRailWired = "1";
  function touchEventTargetsCorrespondenceBadge(ev) {
    const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
    for (const node of path) {
      if (
        node instanceof Element &&
        node.closest(".tam-stop-rail__correspondenceBadge")
      ) {
        return true;
      }
    }
    return (
      ev.target instanceof Element &&
      !!ev.target.closest(".tam-stop-rail__correspondenceBadge")
    );
  }
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      const r = getTamStopRailEls().root;
      if (r && !r.classList.contains("tam-stop-rail--explore")) {
        updateTamStopRailCompactSpacing();
      }
    });
    ro.observe(scroll);
  }
  const openExplore = () => {
    setTamStopRailExploreOpen(true);
  };

  let railExploreTouchSx = 0;
  let railExploreTouchSy = 0;
  let railExploreTouchTracing = false;
  let railExploreTouchMaxDistSq = 0;
  /** Identifiant Touch du doigt suivi (évite les incohérences si plusieurs touchers). */
  let railExploreTouchId = null;

  function resetRailExploreTouchTrace() {
    railExploreTouchTracing = false;
    railExploreTouchMaxDistSq = 0;
    railExploreTouchId = null;
  }

  function tamTouchListFind(tl, id) {
    for (let i = 0; i < tl.length; i++) {
      if (tl[i].identifier === id) {
        return tl[i];
      }
    }
    return null;
  }

  function onRailExploreTouchStart(ev) {
    resetRailExploreTouchTrace();
    if (touchEventTargetsCorrespondenceBadge(ev)) {
      return;
    }
    if (ev.touches.length !== 1) return;
    const t = ev.touches[0];
    railExploreTouchId = t.identifier;
    railExploreTouchSx = t.clientX;
    railExploreTouchSy = t.clientY;
    railExploreTouchTracing = true;
    railExploreTouchMaxDistSq = 0;
  }

  function onRailExploreTouchMove(ev) {
    if (
      !railExploreTouchTracing ||
      railExploreTouchId === null ||
      ev.touches.length !== 1
    ) {
      return;
    }
    const t = tamTouchListFind(ev.touches, railExploreTouchId);
    if (!t) return;
    const dx = t.clientX - railExploreTouchSx;
    const dy = t.clientY - railExploreTouchSy;
    const dsq = dx * dx + dy * dy;
    if (dsq > railExploreTouchMaxDistSq) {
      railExploreTouchMaxDistSq = dsq;
    }
  }

  /* Un seul suivi sur root (évite un double reset touchstart root + scroll). Touchend en double
   * sur root et scroll pour garder le relâchement fiable sur liste longue. */
  function onRailExploreTouchEnd(ev) {
    if (touchEventTargetsCorrespondenceBadge(ev)) {
      resetRailExploreTouchTrace();
      return;
    }
    if (!railExploreTouchTracing || railExploreTouchId === null) {
      resetRailExploreTouchTrace();
      return;
    }
    const t = tamTouchListFind(ev.changedTouches, railExploreTouchId);
    if (!t) {
      resetRailExploreTouchTrace();
      return;
    }
    const dx = t.clientX - railExploreTouchSx;
    const dy = t.clientY - railExploreTouchSy;
    const dsq = dx * dx + dy * dy;
    const peak = Math.max(dsq, railExploreTouchMaxDistSq);
    resetRailExploreTouchTrace();

    if (!root.classList.contains("tam-stop-rail--explore")) {
      return;
    }
    if (peak > TAM_STOP_RAIL_TAP_MOVE_MAX_SQ) return;

    ev.preventDefault();
    setTamStopRailExploreOpen(false);
    tamStopRailSuppressInnerClickUntil = performance.now() + 500;
  }

  root.addEventListener("touchstart", onRailExploreTouchStart, {
    capture: true,
    passive: true,
  });
  root.addEventListener("touchmove", onRailExploreTouchMove, {
    capture: true,
    passive: true,
  });
  root.addEventListener("touchend", onRailExploreTouchEnd, {
    capture: true,
    passive: false,
  });
  scroll.addEventListener("touchend", onRailExploreTouchEnd, {
    capture: true,
    passive: false,
  });

  if (
    !tamStopRailMapCloseWired &&
    typeof map !== "undefined" &&
    map &&
    typeof map.on === "function"
  ) {
    tamStopRailMapCloseWired = true;
    map.on("click", () => {
      const r = getTamStopRailEls().root;
      if (!r || r.hidden) return;
      if (!r.classList.contains("tam-stop-rail--explore")) return;
      setTamStopRailExploreOpen(false);
      tamStopRailSuppressInnerClickUntil = performance.now() + 400;
    });
  }

  inner.addEventListener("click", () => {
    if (performance.now() < tamStopRailSuppressInnerClickUntil) {
      tamStopRailSuppressInnerClickUntil = 0;
      return;
    }
    const isOpen = root.classList.contains("tam-stop-rail--explore");
    setTamStopRailExploreOpen(!isOpen);
  });
  /* Ne pas appeler openExplore() sur « scroll » : en mode liste ouverte chaque défilement (doigt)
   * et chaque recalcul de layout (pastille franchie → hauteur) relançait setTamStopRailExploreOpen(true),
   * ce qui provoquait des sauts de scroll et des fermetures tactiles capricieuses. La barre repliée
   * est en overflow-y: hidden ; l’ouverture au rouet souris reste sur « wheel ». */
  scroll.addEventListener(
    "wheel",
    () => {
      if (root.classList.contains("tam-stop-rail--explore")) return;
      openExplore();
    },
    { passive: true },
  );
}

/** Parse `HH:MM:SS` ou `H:MM:SS` GTFS (durées au-delà de 24 h possibles) en secondes depuis minuit « service ». */
function gtfsClockToSeconds(clockStr) {
  if (clockStr == null || clockStr === "") return null;
  const parts = String(clockStr).trim().split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const mi = Number(parts[1]);
  const se = Number(parts.length >= 3 ? parts[2] : 0);
  if (![h, mi, se].every((x) => Number.isFinite(x))) return null;
  return (h * 60 + mi) * 60 + se;
}

function tamStopBoardSeconds(stop) {
  const d = gtfsClockToSeconds(stop?.departure_time);
  const a = gtfsClockToSeconds(stop?.arrival_time);
  return d != null ? d : a;
}

function tamStopAlignSeconds(stop) {
  const a = gtfsClockToSeconds(stop?.arrival_time);
  const d = gtfsClockToSeconds(stop?.departure_time);
  return a != null ? a : d;
}

/** Entre deux arrêts successifs : différence horaires GTFS, avec repli si données absentes. */
function buildTamStopRailGtfsSchedule(stops) {
  const n = stops?.length || 0;
  if (n < 2) {
    return { ok: false, legSec: [], cumArriveSec: [] };
  }
  const legSec = [];
  for (let i = 0; i < n - 1; i++) {
    const dep = tamStopBoardSeconds(stops[i]);
    const arr = tamStopAlignSeconds(stops[i + 1]);
    let diff = dep != null && arr != null ? arr - dep : null;
    if (diff == null || !Number.isFinite(diff) || diff < 30) {
      diff = 120;
    }
    legSec.push(diff);
  }
  const cumArriveSec = [0];
  for (let i = 0; i < legSec.length; i++) {
    cumArriveSec.push(cumArriveSec[i] + legSec[i]);
  }
  return { ok: true, legSec, cumArriveSec };
}

/** Avancée « horloge GTFS » interpolée selon la distance sur le tracé (pour le voyage type). */
function tamStopRailScheduleElapsedSec(d, model) {
  const stops = currentPattern?.stops;
  const m = stopMetersAlong;
  if (
    !model?.ok ||
    !stops?.length ||
    !m?.length ||
    model.cumArriveSec.length !== stops.length
  ) {
    return 0;
  }
  const n = stops.length;
  const k = currentStopIndexForDistance(d);
  if (n < 2 || k >= n - 1) {
    return model.cumArriveSec[n - 1] || 0;
  }
  const m0 = m[k] ?? 0;
  const m1 = m[k + 1] ?? pathTotalMeters;
  const spanM = Math.max(m1 - m0, 1e-6);
  const frac = Math.min(1, Math.max(0, (d - m0) / spanM));
  const leg = model.legSec[k] ?? 0;
  return (model.cumArriveSec[k] ?? 0) + frac * leg;
}

/** Met à jour les libellés « X min » à droite du nom d’arrêt (mode rail étendu). */
function updateTamStopRailScheduleEtas() {
  const { scroll, root } = getTamStopRailEls();
  if (!scroll || !root || root.hidden) return;
  const model = tamStopRailGtfsSchedule;
  const stops = currentPattern?.stops;
  if (!model?.ok || !stops?.length || stops.length < 2) {
    for (const btn of scroll.children) {
      if (!(btn instanceof HTMLElement)) continue;
      const eta = btn.querySelector(".tam-stop-rail__pillEta");
      if (eta) {
        eta.textContent = "";
        eta.classList.remove("tam-stop-rail__pillEta--tempsReel");
      }
    }
    return;
  }
  const d = distanceAlongPathMeters;
  const k = currentStopIndexForDistance(d);
  const elapsed = tamStopRailScheduleElapsedSec(d, model);
  const cum = model.cumArriveSec;
  function gtfsMinutesToStop(idx) {
    const remainSec = Math.max(0, (cum[idx] ?? 0) - elapsed);
    return Math.max(1, Math.round(remainSec / 60));
  }

  const useRt =
    root.classList.contains("tam-stop-rail--explore") &&
    tamStopRailCurrentLineRtCandidatesByStopIdx?.size > 0;

  const n = stops.length;
  /** Chaînage : après un temps réel direct cohérent (vert), les suivants restent en gris mais suivent les deltas GTFS. */
  let chainAbsMin = null;
  let chainGtfsMin = null;
  let chosenTripId = "";
  let lastGreenMin = null;

  /** @type {Map<number, { mins: number, vert: boolean }>} */
  const etaPlan = new Map();
  for (let idx = k + 1; idx < n; idx++) {
    const g = gtfsMinutesToStop(idx);
    /** Continuité : valeur minimale attendue à cet arrêt selon le calendrier (depuis la dernière valeur affichée). */
    const base =
      chainAbsMin != null && chainGtfsMin != null
        ? Math.max(1, chainAbsMin + (g - chainGtfsMin))
        : g;
    /** Tolérance arrondi : on accepte au plus 1 min en dessous, jamais un vrai retour en arrière. */
    const floor = Math.max(0, base - 1);

    let mins = base;
    let vert = false;

    if (useRt) {
      const cands = tamStopRailCurrentLineRtCandidatesByStopIdx.get(idx) || [];
      if (chosenTripId) {
        const same = cands.find(
          (c) => String(c?.tripId || "") === chosenTripId,
        );
        const v = same ? Number(same.min) : NaN;
        if (Number.isFinite(v) && v >= floor) {
          mins = Math.max(1, Math.round(v));
          vert = true;
        }
      }
      if (!vert) {
        const picked = pickCandidateClosestToGtfs(cands, g, floor);
        if (picked && Number.isFinite(Number(picked.min))) {
          mins = Math.max(1, Math.round(Number(picked.min)));
          vert = true;
          chosenTripId = String(picked.tripId || "").trim();
        }
      }
      if (vert) lastGreenMin = mins;
    }

    etaPlan.set(idx, { mins, vert });
    /** La continuité avance toujours avec la valeur affichée (verte ou grise). */
    chainAbsMin = mins;
    chainGtfsMin = g;
  }

  for (const btn of scroll.children) {
    if (!(btn instanceof HTMLElement)) continue;
    if (!btn.classList.contains("tam-stop-rail__pill")) continue;
    const eta = btn.querySelector(".tam-stop-rail__pillEta");
    if (!eta) continue;
    const i = Number(btn.dataset.tamStopIdx);
    if (!Number.isFinite(i)) continue;
    if (i <= k) {
      eta.textContent = "";
      eta.classList.remove("tam-stop-rail__pillEta--tempsReel");
      continue;
    }
    const row = etaPlan.get(i);
    const mins = row ? row.mins : gtfsMinutesToStop(i);
    eta.textContent = `${mins} min`;
    eta.classList.toggle("tam-stop-rail__pillEta--tempsReel", !!row?.vert);
  }
}

/**
 * Remplissage cumulatif du rail depuis le bas :
 * - au départ, la hauteur atteint immédiatement le haut de la 1re pastille (départ franchi),
 * - puis progresse vers le haut de la suivante selon la distance réelle sur le tronçon,
 * - sans jamais "repartir de zéro" entre deux arrêts.
 */
function tamStopRailProgressFillHeightPct(d) {
  const { fill, scroll } = getTamStopRailEls();
  const track = fill?.parentElement;
  if (!fill || !scroll || !(track instanceof HTMLElement)) {
    return null;
  }
  const stops = currentPattern?.stops;
  const m = stopMetersAlong;
  if (!stops?.length || !m?.length || pathTotalMeters <= 0) {
    return 0;
  }
  const n = Math.min(stops.length, m.length);
  const tr = track.getBoundingClientRect();
  const H = Math.max(tr.height, 1e-6);

  function zTopFromTrackBottomPx(patternIdx) {
    const btn = scroll.querySelector(
      `.tam-stop-rail__pill[data-tam-stop-idx="${patternIdx}"]`,
    );
    if (!btn) return null;
    const br = btn.getBoundingClientRect();
    return Math.max(0, tr.bottom - br.top);
  }

  const dc = Math.min(pathTotalMeters, Math.max(0, d));

  if (dc >= pathTotalMeters - 0.05) {
    return 100;
  }

  if (n < 2) {
    return Math.min(100, Math.max(0, (dc / pathTotalMeters) * 100));
  }

  const s = currentStopIndexForDistance(dc);
  const sNext = Math.min(s + 1, n - 1);

  const z0 = zTopFromTrackBottomPx(s);
  const z1 = zTopFromTrackBottomPx(sNext);
  const m0 = m[s] || 0;
  const m1 = m[sNext] ?? pathTotalMeters;

  let t = 0;
  if (sNext <= s || Math.abs(m1 - m0) <= 1e-3) {
    t = dc >= m1 - 1e-3 ? 1 : dc <= m0 + 1e-3 ? 0 : 0.5;
  } else {
    t = Math.min(1, Math.max(0, (dc - m0) / (m1 - m0)));
  }

  let totalHeightPct = 0;
  if (z0 != null && z1 != null) {
    const basePct = Math.min(100, Math.max(0, (z0 / H) * 100));
    const segPx = Math.max(z1 - z0, 0.5);
    const segPct = Math.max(0, ((t * segPx) / H) * 100);
    totalHeightPct = Math.min(100, Math.max(0, basePct + segPct));
  }
  /** Mesure DOM indisponible : repli comportement ancien (~proportional au trajet global). */
  if (totalHeightPct <= 1e-4 && z0 == null) {
    return Math.min(100, Math.max(0, (dc / pathTotalMeters) * 100));
  }

  return totalHeightPct;
}

/** Pastilles « déjà dépassées » : même logique d’index que le guidage (`currentStopIndexForDistance`). */
function updateTamStopRailPillPastStates() {
  const { scroll, root } = getTamStopRailEls();
  if (!scroll || !root || root.hidden) return;
  const stops = currentPattern?.stops;
  if (!stops?.length || !stopMetersAlong.length) return;
  const d = distanceAlongPathMeters;
  const k = currentStopIndexForDistance(d);
  const complete = pathTotalMeters > 0 && d >= pathTotalMeters - 0.05;
  for (const btn of scroll.children) {
    if (!(btn instanceof HTMLElement)) continue;
    if (!btn.classList.contains("tam-stop-rail__pill")) continue;
    const i = Number(btn.dataset.tamStopIdx);
    if (!Number.isFinite(i)) continue;
    /* Le départ est considéré franchi dès le lancement :
     * k=0 => première pastille déjà validée (verte). */
    const past = complete || i <= k;
    btn.classList.toggle("tam-stop-rail__pill--past", past);
  }
  updateTamStopRailScheduleEtas();
  maybePeriodicTamStopRailCurrentLineRealtime();
}

function updateTamStopRailProgressFill() {
  const { fill, root } = getTamStopRailEls();
  if (!fill || !root || root.hidden) return;
  if (pathTotalMeters <= 0) {
    fill.style.bottom = "0";
    fill.style.height = "0%";
    updateTamStopRailPillPastStates();
    maybeAutoSnapTamStopRailScroll(
      currentStopIndexForDistance(distanceAlongPathMeters),
    );
    return;
  }
  const h = tamStopRailProgressFillHeightPct(distanceAlongPathMeters);
  fill.style.bottom = "0";
  fill.style.height = `${h}%`;
  updateTamStopRailPillPastStates();
  maybeAutoSnapTamStopRailScroll(
    currentStopIndexForDistance(distanceAlongPathMeters),
  );
}

function refreshStopRail() {
  const { root, scroll, fill } = getTamStopRailEls();
  if (!root || !scroll) return;
  ensureTamStopRailWired();
  const hud = document.getElementById("mapMissionHud");
  const hudLive = !!hud && !hud.classList.contains("map-mission-hud--inactive");

  if (!currentPattern?.stops?.length || pathTotalMeters <= 0) {
    tamStopRailBuiltFor = "";
    tamStopRailGtfsSchedule = { ok: false, legSec: [], cumArriveSec: [] };
    tamStopRailLastAutoSnapK = null;
    root.hidden = true;
    root.classList.remove("tam-stop-rail--explore");
    setTamStopRailExploreOpen(false);
    scroll.innerHTML = "";
    if (fill) {
      fill.style.bottom = "0";
      fill.style.height = "0%";
    }
    return;
  }
  /* Même visibilité que le HUD carte (pastille prochain arrêt + commandes) : pas en aperçu mission. */
  if (!hudLive) {
    tamStopRailBuiltFor = "";
    tamStopRailGtfsSchedule = { ok: false, legSec: [], cumArriveSec: [] };
    tamStopRailLastAutoSnapK = null;
    root.hidden = true;
    root.classList.remove("tam-stop-rail--explore");
    setTamStopRailExploreOpen(false);
    scroll.innerHTML = "";
    if (fill) {
      fill.style.bottom = "0";
      fill.style.height = "0%";
    }
    return;
  }
  const sig = `${currentPattern.pattern_id || ""}:${currentPattern.stops.length}`;
  if (sig === tamStopRailBuiltFor && scroll.children.length > 0) {
    updateTamStopRailProgressFill();
    requestAnimationFrame(() => {
      updateTamStopRailCompactSpacing();
    });
    return;
  }
  tamStopRailBuiltFor = sig;
  tamStopRailLastAutoSnapK = null;
  tamStopRailCorrespondenceByStop = null;
  root.hidden = false;
  setTamStopRailExploreOpen(false);
  scroll.innerHTML = "";
  /* stops[0] = premier arrêt du trajet, dernier = terminus. Colonne CSS = haut → bas :
   * on ajoute du terminus vers le départ pour que le remplissage (bas = 0 %) coïncide avec le début de ligne en bas. */
  const stops = currentPattern.stops;
  tamStopRailGtfsSchedule = buildTamStopRailGtfsSchedule(stops);
  for (let i = stops.length - 1; i >= 0; i--) {
    const st = stops[i];
    const name = String(st.stop_name || st.name || `Arrêt ${i + 1}`);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tam-stop-rail__pill";
    btn.dataset.tamStopIdx = String(i);
    btn.setAttribute("aria-label", `Arrêt : ${name}`);
    const main = document.createElement("span");
    main.className = "tam-stop-rail__pillMain";
    const textCol = document.createElement("span");
    textCol.className = "tam-stop-rail__pillTextCol";
    const span = document.createElement("span");
    span.className = "tam-stop-rail__pillLabel";
    span.textContent = name;
    const eta = document.createElement("span");
    eta.className = "tam-stop-rail__pillEta";
    eta.setAttribute("aria-hidden", "true");
    textCol.appendChild(span);
    textCol.appendChild(eta);
    main.appendChild(textCol);
    const correspondences = getStopCorrespondenceLines(st);
    if (correspondences.length) {
      const corrWrap = document.createElement("span");
      corrWrap.className = "tam-stop-rail__correspondences";
      const showCompactWithMore = correspondences.length > 3;
      const shown = showCompactWithMore
        ? correspondences.slice(0, 2)
        : correspondences;
      const hidden = showCompactWithMore ? correspondences.slice(2) : [];
      for (const lineItem of shown) {
        const badge = document.createElement("span");
        badge.className = "tam-stop-rail__correspondenceBadge";
        badge.textContent = displayLineLabel(lineItem);
        styleStopCorrespondenceBadge(badge, lineItem);
        wireCorrespondenceBadgeInteractions(badge, st, lineItem);
        corrWrap.appendChild(badge);
      }
      const hiddenCount = hidden.length;
      if (hiddenCount > 0) {
        const more = document.createElement("span");
        more.className =
          "tam-stop-rail__correspondenceBadge tam-stop-rail__correspondenceBadge--more";
        more.textContent = `+${hiddenCount}`;
        wireStopRailInfoBadgeInteractions(more, () => {
          showCorrespondenceListPopup(
            st,
            correspondences,
            "Correspondances de l’arrêt",
          );
        });
        corrWrap.appendChild(more);
      }
      if (getStopAreaHubKey(st)) {
        const hub = document.createElement("span");
        hub.className =
          "tam-stop-rail__correspondenceBadge tam-stop-rail__correspondenceBadge--hub";
        hub.textContent = "Pôle";
        wireStopRailInfoBadgeInteractions(hub, () => {
          showStopAreaHubPopup(st);
        });
        corrWrap.appendChild(hub);
      }
      main.appendChild(corrWrap);
      const corrTxt = correspondences
        .map((x) => displayLineLabel(x))
        .join(", ");
      btn.setAttribute(
        "aria-label",
        `Arrêt : ${name}. Correspondances : ${corrTxt}`,
      );
    }
    btn.appendChild(main);
    scroll.appendChild(btn);
  }
  updateTamStopRailProgressFill();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateTamStopRailCompactSpacing();
    });
  });
}

function updateStats() {
  if (!currentPattern) {
    refreshStopRail();
    refreshMapMissionHudState();
    refreshMapHudNextStopPeek();
    return;
  }
  const stops = currentPattern.stops;
  const d = distanceAlongPathMeters;
  if (!stops || !stops.length) {
    currentStopEl.textContent = "-";
    nextStopEl.textContent = "-";
  } else {
    const pair = getCurrentAndNextServedGuideSlots(d);
    function fmtSlot(slot) {
      if (!slot || !slot.name) return "-";
      const skipped =
        slot.kind === "gtfs" &&
        skippedStopIdSet.has(String(slot.stop_id || ""));
      return `${slot.name}${skipped ? " (non desservi)" : ""}`;
    }
    currentStopEl.textContent = fmtSlot(pair.curr);
    nextStopEl.textContent = fmtSlot(pair.next);
  }

  const pct =
    pathTotalMeters > 0 ? ((d / pathTotalMeters) * 100).toFixed(1) : "0.0";
  progressPctEl.textContent = `${pct}% (${traceSource}) — ~${Math.round(
    BASE_METERS_PER_SECOND * speed * 3.6,
  )} km/h sim.`;
  refreshStopRail();
  refreshMapMissionHudState();
  refreshMapHudNextStopPeek();
}

const HUD_ICON_PAUSE =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4.5" height="14" rx="1" fill="currentColor"/></svg>';
const HUD_ICON_PLAY =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>';
const HUD_CHEVRON_L =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 7l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HUD_CHEVRON_R =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HUD_ICON_VOICE_ON =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const HUD_ICON_VOICE_OFF =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

/** Vitesses affichées sur la HUD carte — alignées sur `#speedSelect`. */
const MAP_HUD_SPEED_SEQUENCE = [1, 2, 4, 10];

function refreshMapHudSpeedLabel() {
  const btn = document.getElementById("mapHudSpeedBtn");
  if (!btn || !speedSelect) return;
  const raw = Number(speedSelect.value);
  const v = MAP_HUD_SPEED_SEQUENCE.includes(raw)
    ? raw
    : MAP_HUD_SPEED_SEQUENCE[0];
  btn.textContent = `×${v}`;
  btn.title = `Vitesse simulation (${btn.textContent}) — clic pour changer`;
  btn.setAttribute("aria-label", `Vitesse simulation ${btn.textContent}`);
}

function cycleMapHudSpeed() {
  if (!speedSelect) return;
  const cur = Number(speedSelect.value) || 1;
  const idx = MAP_HUD_SPEED_SEQUENCE.indexOf(cur);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % MAP_HUD_SPEED_SEQUENCE.length;
  speedSelect.value = String(MAP_HUD_SPEED_SEQUENCE[nextIdx]);
  speedSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function refreshMapHudToggleIcon() {
  const root = document.getElementById("mapMissionHud");
  const btn = document.getElementById("mapMissionHudToggleBtn");
  if (!root || !btn) return;
  const collapsed = root.classList.contains("map-mission-hud--collapsed");
  btn.innerHTML = collapsed ? HUD_CHEVRON_L : HUD_CHEVRON_R;
  btn.title = collapsed ? "Afficher les commandes" : "Masquer les commandes";
  btn.setAttribute(
    "aria-label",
    collapsed
      ? "Afficher les commandes mission"
      : "Masquer les commandes mission",
  );
}

/**
 * Pourcentage de remplissage de la pastille « Prochain arrêt » : distance parcourue
 * entre l’arrêt courant et le prochain le long du tracé guide (0 → départ courant, 100 → prochain).
 */
function computeMapHudNextStripFillPercent(d) {
  if (!currentPattern || pathTotalMeters <= 0) return 0;
  const pair = getCurrentAndNextServedGuideSlots(d);
  const m0 = pair.curr?.meters;
  const m1 = pair.next?.meters;
  if (m0 == null || m1 == null) return 0;
  const v0 = Number(m0);
  const v1 = Number(m1);
  const span = v1 - v0;
  const dn = Number(d);
  if (span <= 1e-3) {
    return dn >= v1 - 0.5 ? 100 : 0;
  }
  const ratio = (dn - v0) / span;
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

/** Même libellé que le récap `#nextStop`, affiché sur la carte + barre de progression tronçon. */
function refreshMapHudNextStopPeek() {
  const strip = document.querySelector(
    "#mapMissionHud .map-mission-hud__nextStrip",
  );
  const line = document.getElementById("mapHudNextStopLine");
  if (!line || !nextStopEl) return;
  const t = (nextStopEl.textContent || "").trim();
  line.textContent = t.length ? t : "—";
  if (strip) {
    const pct = computeMapHudNextStripFillPercent(distanceAlongPathMeters);
    strip.style.setProperty("--map-hud-next-fill-pct", String(pct));
  }
}

function mapHudPauseShowsPauseAction() {
  if (driveMode === DRIVE_MODE.REAL) {
    return gpsWatchId != null;
  }
  return !!running;
}

function refreshMapHudVoiceBtn() {
  const btn = document.getElementById("mapHudVoiceBtn");
  const root = document.getElementById("mapMissionHud");
  if (
    !btn ||
    !voiceEnabledEl ||
    root?.classList.contains("map-mission-hud--inactive")
  ) {
    return;
  }
  const on = !!voiceEnabledEl.checked;
  btn.innerHTML = on ? HUD_ICON_VOICE_ON : HUD_ICON_VOICE_OFF;
  btn.classList.toggle("map-mission-hud__voice-icon--on", on);
  btn.classList.toggle("map-mission-hud__voice-icon--off", !on);
  btn.title = on
    ? "Annonces vocales activées (clic pour couper)"
    : "Annonces vocales coupées (clic pour activer)";
  btn.setAttribute(
    "aria-label",
    on ? "Désactiver les annonces vocales" : "Activer les annonces vocales",
  );
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function refreshMapMissionHudState() {
  const root = document.getElementById("mapMissionHud");
  const pauseB = document.getElementById("mapHudPauseBtn");
  if (
    !root ||
    !pauseB ||
    root.classList.contains("map-mission-hud--inactive")
  ) {
    return;
  }
  const showPause = mapHudPauseShowsPauseAction();
  pauseB.innerHTML = showPause ? HUD_ICON_PAUSE : HUD_ICON_PLAY;
  pauseB.setAttribute("aria-label", showPause ? "Pause" : "Reprendre");
  pauseB.title = showPause ? "Pause" : "Reprendre";
  refreshMapHudVoiceBtn();
}

function hideMapMissionHud() {
  const root = document.getElementById("mapMissionHud");
  if (!root) return;
  root.classList.add("map-mission-hud--inactive");
  root.classList.remove("map-mission-hud--collapsed");
  root.setAttribute("aria-hidden", "true");
}

function syncMapHudHeadingCheckboxFromMain() {
  const mapHeading = document.getElementById("mapHudHeadingUp");
  const cap = document.getElementById("mapHudHeadingCaption");
  if (mapHeading) mapHeading.checked = !!headingUpEl.checked;
  if (cap) cap.textContent = headingUpEl.checked ? "Cap" : "Nord";
}

function showMapMissionHud() {
  const root = document.getElementById("mapMissionHud");
  if (!root) return;
  root.classList.remove("map-mission-hud--inactive");
  root.classList.remove("map-mission-hud--collapsed");
  root.setAttribute("aria-hidden", "false");
  syncMapHudHeadingCheckboxFromMain();
  refreshMapMissionHudState();
  refreshMapHudToggleIcon();
  refreshMapHudSpeedLabel();
  refreshMapHudNextStopPeek();
  refreshStopRail();
  refreshMapLayout();
}

function togglePauseResumeMission() {
  if (previewOnlyMode) {
    running = false;
    lastRafTime = 0;
    stopGpsTracking();
    refreshMapMissionHudState();
    return;
  }
  if (driveMode === DRIVE_MODE.REAL) {
    if (!currentPattern) return;
    if (gpsWatchId == null) {
      running = startGpsTracking();
    } else {
      stopGpsTracking();
      running = false;
      setGpsStatus("GPS en pause.");
    }
    refreshMapMissionHudState();
    return;
  }
  if (!running) {
    if (
      typeof blockMissionResumeIfUnsavedDeviation === "function" &&
      blockMissionResumeIfUnsavedDeviation()
    ) {
      return;
    }
  }
  running = !running;
  if (!running) {
    lastRafTime = 0;
  }
  refreshMapMissionHudState();
}

function setupMapMissionHud() {
  const root = document.getElementById("mapMissionHud");
  const toggleB = document.getElementById("mapMissionHudToggleBtn");
  const voiceB = document.getElementById("mapHudVoiceBtn");
  const pauseB = document.getElementById("mapHudPauseBtn");
  const prevB = document.getElementById("mapHudPrevBtn");
  const nextB = document.getElementById("mapHudNextBtn");
  const speedB = document.getElementById("mapHudSpeedBtn");
  const mapHeading = document.getElementById("mapHudHeadingUp");
  const nextStrip = root.querySelector(".map-mission-hud__nextStrip");
  if (
    !root ||
    !toggleB ||
    !voiceB ||
    !pauseB ||
    !prevB ||
    !nextB ||
    !speedB ||
    !mapHeading ||
    !nextStrip
  )
    return;

  prevB.innerHTML = HUD_CHEVRON_L;
  nextB.innerHTML = HUD_CHEVRON_R;
  refreshMapHudToggleIcon();
  refreshMapHudSpeedLabel();
  refreshMapHudVoiceBtn();

  voiceB.addEventListener("click", () => {
    voiceEnabledEl.checked = !voiceEnabledEl.checked;
    voiceEnabledEl.dispatchEvent(new Event("change", { bubbles: true }));
  });

  toggleB.addEventListener("click", () => {
    root.classList.toggle("map-mission-hud--collapsed");
    refreshMapHudToggleIcon();
    refreshMapLayout();
  });

  pauseB.addEventListener("click", () => {
    togglePauseResumeMission();
  });
  prevB.addEventListener("click", () => {
    jumpServedStop(-1);
  });
  nextB.addEventListener("click", () => {
    jumpServedStop(1);
  });
  nextStrip.addEventListener("click", () => {
    openTamStopRailAtNextStop();
  });
  nextStrip.addEventListener(
    "touchend",
    (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      tamStopRailSuppressInnerClickUntil = performance.now() + 500;
      openTamStopRailAtNextStop();
    },
    { passive: false },
  );
  nextStrip.setAttribute("role", "button");
  nextStrip.setAttribute("tabindex", "0");
  nextStrip.setAttribute(
    "aria-label",
    "Ouvrir le rail des arrêts au prochain arrêt",
  );
  nextStrip.setAttribute("title", "Ouvrir le rail au prochain arrêt");
  nextStrip.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    openTamStopRailAtNextStop();
  });

  speedB.addEventListener("click", () => {
    cycleMapHudSpeed();
  });

  mapHeading.addEventListener("change", () => {
    headingUpEl.checked = mapHeading.checked;
    headingUpEl.dispatchEvent(new Event("change", { bubbles: true }));
    syncMapHudHeadingCheckboxFromMain();
  });
}

/**
 * Recalcule skips + guide puis redraw pastilles/overlays carte (sans stats ni tronçon stop-to-stop) —
 * utilisé avant repositionnement lignes carte dans `setMission`.
 */
function recomputeSkippedAndRedrawStopLayers() {
  recomputeSkippedStopsForCurrentMission();
  rebuildActiveGuideStops();
  drawAllStopsOverlay();
  drawSkippedStopsOverlay();
  drawProvisionalStopsOverlay();
}

/** Même flux + tronçon guide et bloc stats progression (motif très répandu dans les handlers). */
function refreshMissionStopVisualsAndStats() {
  recomputeSkippedAndRedrawStopLayers();
  updateStopToStopOverlay();
  updateStats();
}

function tickRaf(now) {
  if (
    running &&
    driveMode === DRIVE_MODE.SIMULATION &&
    !previewOnlyMode &&
    currentPattern &&
    pathTotalMeters > 0
  ) {
    if (lastRafTime === 0) {
      lastRafTime = now;
    } else {
      const prevVoiceD = lastVoiceDistance;
      const dt = Math.min(0.1, (now - lastRafTime) / 1000);
      lastRafTime = now;
      distanceAlongPathMeters = Math.min(
        pathTotalMeters,
        distanceAlongPathMeters + BASE_METERS_PER_SECOND * speed * dt,
      );
      if (distanceAlongPathMeters >= pathTotalMeters - 0.01) {
        distanceAlongPathMeters = pathTotalMeters;
        running = false;
        lastRafTime = 0;
      }
      maybeAnnounceProchainArret(prevVoiceD, distanceAlongPathMeters);
      lastVoiceDistance = distanceAlongPathMeters;
      updateMapNavigation();
      redrawDoneLineAtDistance(distanceAlongPathMeters);
      updateStopToStopOverlay();
      updateStats();
    }
  }
  requestAnimationFrame(tickRaf);
}

startBtn.addEventListener("click", () => {
  const p = selectedPattern();
  if (!p) return;
  speed = Number(speedSelect.value) || 1;
  const token = ++previewMissionToken;
  running = false;
  startBtn.disabled = true;
  startBtn.textContent = "Chargement du tracé…";
  setMission(p, { previewOnly: false })
    .then(() => {
      if (token !== previewMissionToken) return;
      previewOnlyMode = false;
      lastRafTime = 0;
      if (driveMode === DRIVE_MODE.REAL) {
        running = startGpsTracking();
        if (!running) {
          return;
        }
        appendOpsLog("mode_reel_start", "GPS actif");
      } else {
        stopGpsTracking();
        if (
          typeof blockMissionResumeIfUnsavedDeviation === "function" &&
          blockMissionResumeIfUnsavedDeviation()
        ) {
          running = false;
        } else {
          running = true;
        }
      }
      mapMissionHudSessionActive = true;
      showMapMissionHud();
      closeControlPanel();
    })
    .finally(() => {
      startBtn.disabled = false;
      refreshDriveModeUi();
    });
});

pauseBtn.addEventListener("click", togglePauseResumeMission);

/**
 * Retire uniquement le tracé manuel validé (profil + géométrie fusionnée).
 * Conserve manualStopOverrides et provisionalStops ; réaffiche la ligne de base.
 */
async function clearManualDeviationTraceKeepingStops(skipConfirm) {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  const hadValidatedTrace =
    opsState.manualProfile &&
    Array.isArray(opsState.manualProfile.mergedCoords) &&
    opsState.manualProfile.mergedCoords.length >= 2;
  const hadDraft = !!manualDrawActive && manualDraftPoints.length > 0;
  if (!hadValidatedTrace && !hadDraft) return;

  const msg = hadValidatedTrace
    ? "Supprimer toutes les déviations sur la carte (y compris si vous avez validé plusieurs fois) ? Les arrêts non desservis et les arrêts provisoires sont conservés."
    : "Abandonner le tracé en cours et effacer les points posés sur la carte ?";
  if (
    !skipConfirm &&
    !(await showAppConfirmDialog(TAM_APP_DIALOG_TITLE, msg))
  ) {
    return;
  }

  stopManualDrawMode({ keepPoints: false });
  opsState.manualProfile = null;
  opsState.modeCoordinates[OPS_MODE.MANUEL] = null;
  opsState.manualActive = false;
  opsState.nonServedEditActive = false;
  opsState.provisionalEditActive = false;
  nonServedEditFocusStopId = null;
  clearManualRouteOverlayLayers();
  opsState.returnMode = OPS_MODE.BASE;
  applyOpsStateUi();
  await applyTraceForOpsMode(OPS_MODE.BASE, { centerCamera: false });
  refreshMissionStopVisualsAndStats();
  resyncVoixForPosition(distanceAlongPathMeters);
  appendOpsLog(
    "manual_trace_cleared",
    hadValidatedTrace ? "validated_profile" : "draft_only",
  );
  const persistedAuto =
    hadValidatedTrace &&
    autoUpdateSelectedDeviationPayloadIfPossible("tracé manuel effacé");
  setGpsStatus(
    hadValidatedTrace
      ? persistedAuto
        ? "Tracé de la déviation planifiée supprimé ; entrée locale mise à jour (arrêts conservés)."
        : "Tracé de la déviation planifiée supprimé : les arrêts sont conservés. Sélectionnez une entrée puis « MàJ des dates de l’entrée sélectionnée » pour persister."
      : "Brouillon de tracé effacé.",
  );
}

/** Retire uniquement la portion sélectionnée ; les autres sont recalculées (ancres sur la base mission). */
async function removeManualDeviationSegmentsFromSelectedIndex() {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (manualDrawActive && manualDraftPoints.length > 0) {
    tamAppAlert(
      "Terminez ou abandonnez le brouillon de tracé (« Quitter le tracé » ou supprimer toutes les déviations) avant.",
    );
    return;
  }
  fillMissingManualSegmentBaseAnchors(opsState.manualProfile);
  const chainArr = manualProfileToVisualChainArray(opsState.manualProfile);
  const n = chainArr.length;
  if (!n || !manualTraceSegmentSelectEl) return;
  const idx = parseInt(manualTraceSegmentSelectEl.value || "0", 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= n) return;

  const remaining = chainArr.filter((_, i) => i !== idx);
  if (
    !(await showAppConfirmDialog(
      TAM_APP_DIALOG_TITLE,
      `Supprimer la déviation n°${idx + 1} sur ${n} ? Les autres déviations restent (réordonnées si besoin).`,
    ))
  ) {
    return;
  }

  if (remaining.length === 0) {
    await clearManualDeviationTraceKeepingStops(true);
    return;
  }
  const rebuilt = rebuildManualProfileFromVisualChain(remaining);
  if (!rebuilt) {
    tamAppAlert(
      "Impossible de recalculer le tracé — utilisez « Supprimer toutes les déviations » puis retracer.",
    );
    return;
  }
  opsState.manualProfile = rebuilt;
  opsState.modeCoordinates[OPS_MODE.MANUEL] = rebuilt.mergedCoords;
  opsState.manualActive = true;
  opsState.returnMode = OPS_MODE.MANUEL;
  applyOpsStateUi();
  await applyTraceForOpsMode(OPS_MODE.MANUEL, { centerCamera: false });
  refreshMissionStopVisualsAndStats();
  resyncVoixForPosition(distanceAlongPathMeters);
  appendOpsLog(
    "manual_trace_single_removed",
    `${n}->${remaining.length};removed=${idx + 1}`,
  );
  const persistedAuto =
    autoUpdateSelectedDeviationPayloadIfPossible("portion retirée");
  setGpsStatus(
    `Déviation n°${idx + 1} retirée ; il en reste ${remaining.length}.${
      persistedAuto
        ? " Enregistrement local synchronisé (entrée sélectionnée)."
        : ""
    }`,
  );
}

/** Logique anciennement reliée au bouton « Saisir une déviation en Mode manuel » (UI retirée). */
function activateStoredManualDeviationMode() {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (!opsState.modeCoordinates[OPS_MODE.MANUEL]) {
    tamAppAlert(
      "Aucun tracé de déviation planifiée enregistré. Utilisez d'abord « Tracer la déviation planifiée ».",
    );
    return;
  }
  opsState.returnMode = recomputeOpsMode();
  opsState.manualActive = true;
  applyOpsStateUi();
  recomputeSkippedStopsForCurrentMission();
  rebuildActiveGuideStops();
  drawSkippedStopsOverlay();
  drawProvisionalStopsOverlay();
  applyTraceForOpsMode(OPS_MODE.MANUEL);
  appendOpsLog("activate_manual", "Réactivation déviation enregistrée");
}

nonServedBtn?.addEventListener("click", () => {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (!ensureTemporaryDeviationSessionIfOnSubtab()) return;
  opsState.manualActive = true;
  opsState.nonServedEditActive = !opsState.nonServedEditActive;
  if (opsState.nonServedEditActive) {
    opsState.provisionalEditActive = false;
  }
  nonServedEditFocusStopId = null;
  applyOpsStateUi();
  refreshMissionStopVisualsAndStats();
  setGpsStatus(
    opsState.nonServedEditActive
      ? "Mode arrêt non desservi actif: cliquez une pastille pour activer/désactiver."
      : "Mode arrêt non desservi désactivé.",
  );
  if (opsState.nonServedEditActive) {
    closeControlPanel();
  }
});

provisionalStopBtn?.addEventListener("click", () => {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (!ensureTemporaryDeviationSessionIfOnSubtab()) return;
  opsState.provisionalEditActive = !opsState.provisionalEditActive;
  if (opsState.provisionalEditActive) {
    opsState.nonServedEditActive = false;
    nonServedEditFocusStopId = null;
  }
  applyOpsStateUi();
  drawAllStopsOverlay();
  drawSkippedStopsOverlay();
  drawProvisionalStopsOverlay();
  setGpsStatus(
    opsState.provisionalEditActive
      ? "Arrêts provisoires : touchez la carte pour placer un arrêt (nom demandé). Pastille orange : touchez pour supprimer en mode actif."
      : "Saisie arrêts provisoires désactivée.",
  );
  if (opsState.provisionalEditActive) {
    closeControlPanel();
  }
});

provisionalUndoBtn?.addEventListener("click", () => {
  if (!opsState.provisionalStops?.length) return;
  opsState.provisionalStops.pop();
  rebuildActiveGuideStops();
  drawProvisionalStopsOverlay();
  updateStopToStopOverlay();
  updateStats();
  resyncVoixForPosition(distanceAlongPathMeters);
  refreshProvisionalUi();
  refreshTemporaryDeviationUi();
  setGpsStatus("Dernier arrêt provisoire retiré.");
});

function onManualDrawStartClick(ev) {
  const fromTempToolbar = ev?.currentTarget === tempManualDrawStartBtn;
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (manualDrawActive) {
    /** Même logique Temporaire / Planifiée : sans « Valider le tracé », quitter efface le brouillon (comme si le tracé n’avait pas été commencé). */
    stopManualDrawMode();
    const endedTemp =
      tryDismissTemporaryDeviationIfUnchanged("quit_trace_draft");
    const endedPlan = tryDismissPlannedDeviationIfUnchanged("quit_trace_draft");
    let msg =
      "Brouillon de tracé annulé : les points sur la carte ont été retirés sans validation.";
    if (endedTemp && endedPlan) {
      msg =
        "Brouillon annulé. Session temporaire refermée et état carte inchangé par rapport au début de la saisie (planifiée) — vous pouvez charger une autre déviation enregistrée.";
    } else if (endedTemp) {
      msg =
        "Brouillon annulé. Aucune modification depuis l’état avant session Temporaire : la session est refermée (vous pouvez charger une autre déviation enregistrée).";
    } else if (endedPlan) {
      msg =
        "Brouillon annulé. Aucune modification sur la carte depuis le début de cette saisie (planifiée) — vous pouvez charger une autre déviation enregistrée.";
    }
    setGpsStatus(msg);
    return;
  }
  if (fromTempToolbar) {
    plannedDeviationEditSnapshot = null;
    if (!ensureTemporaryDeviationSessionIfOnSubtab()) return;
  } else if (!opsState.temporaryDeviationActive) {
    plannedDeviationEditSnapshot = {
      pattern_id: String(p.pattern_id || ""),
      payload: deviationPayloadFromLiveState(),
    };
  }
  startManualDrawMode();
  closeControlPanel();
}
manualDrawStartBtn?.addEventListener("click", onManualDrawStartClick);
tempManualDrawStartBtn?.addEventListener("click", onManualDrawStartClick);

function onManualDrawUndoClick() {
  if (!manualDrawActive || !manualDraftPoints.length) {
    return;
  }
  manualDraftPoints.pop();
  redrawManualDraftVisuals();
}
manualDrawUndoBtn?.addEventListener("click", onManualDrawUndoClick);
tempManualDrawUndoBtn?.addEventListener("click", onManualDrawUndoClick);

manualTraceClearBtn?.addEventListener("click", () => {
  if (
    isTempDeviationSubtabActive() &&
    !ensureTemporaryDeviationSessionIfOnSubtab()
  ) {
    return;
  }
  void clearManualDeviationTraceKeepingStops(false).catch((e) =>
    console.warn("clearManualDeviationTraceKeepingStops:", e),
  );
});

manualTraceSegmentSelectEl?.addEventListener("change", () => {
  applyManualDeviationOverlayStyles(getMapVisualProfile());
});

manualTraceRemoveSegmentBtn?.addEventListener("click", () => {
  if (
    isTempDeviationSubtabActive() &&
    !ensureTemporaryDeviationSessionIfOnSubtab()
  ) {
    return;
  }
  void removeManualDeviationSegmentsFromSelectedIndex().catch((e) =>
    console.warn("removeManualDeviationSegmentsFromSelectedIndex:", e),
  );
});

async function onManualDrawSaveClick(validatedFromToolbar) {
  const p = ensureOpsTargetPattern();
  if (!p) return;
  if (manualDraftPoints.length < 2) {
    tamAppAlert(
      temporarySessionOwnsDraft()
        ? "Ajoutez au moins 2 points sur la carte pour valider le tracé de la déviation temporaire."
        : "Ajoutez au moins 2 points sur la carte pour valider le tracé de la déviation planifiée.",
    );
    return;
  }
  const hadPriorMerged =
    opsState.manualActive &&
    opsState.manualProfile &&
    opsState.manualProfile.mergedCoords?.length >= 2;
  const profile = buildManualProfileFromDraft(manualDraftPoints);
  if (!profile) {
    tamAppAlert(
      "Impossible de raccorder la déviation à la ligne. Commencez et terminez bien sur la ligne.",
    );
    return;
  }
  opsState.manualProfile = profile;
  fillMissingManualSegmentBaseAnchors(opsState.manualProfile);
  opsState.modeCoordinates[OPS_MODE.MANUEL] = profile.mergedCoords;
  stopManualDrawMode();
  opsState.returnMode = recomputeOpsMode();
  opsState.manualActive = true;
  applyOpsStateUi();
  recomputeSkippedStopsForCurrentMission();
  rebuildActiveGuideStops();
  drawSkippedStopsOverlay();
  await applyTraceForOpsMode(OPS_MODE.MANUEL, { centerCamera: false });
  appendOpsLog(
    "manual_trace_saved",
    `Detour=${profile.detourCoords.length}pts; merged=${profile.mergedCoords.length}pts; bypassSegs=${(profile.baseBypassRanges || []).length}`,
  );
  setGpsStatus(
    hadPriorMerged
      ? "Déviation manuelle mise à jour : tracé supplémentaire fusionné (vous pouvez en ajouter d’autres avant les arrêts non desservis ou provisoires)."
      : "Déviation manuelle validée : segment de ligne remplacé entre A et B.",
  );
  plannedDeviationEditSnapshot = null;
  if (validatedFromToolbar === "plan") {
    unlockPlannedSaveAfterRecordedTemporaryDeviation();
  }
}
manualDrawSaveBtn?.addEventListener(
  "click",
  () => void onManualDrawSaveClick("plan"),
);
tempManualDrawSaveBtn?.addEventListener(
  "click",
  () => void onManualDrawSaveClick("temp"),
);

returnInitialBtn.addEventListener("click", () => {
  const linePurged = snapshotBeforeTemporary
    ? routeShortNameForPatternId(snapshotBeforeTemporary.pattern_id)
    : currentMissionRouteShortName();
  purgeDeviationsSavedDuringTemporarySession();
  purgeTemporaryLabeledSavedDeviationsForRouteShortName(linePurged);
  void (async () => {
    if (snapshotBeforeTemporary) {
      await restoreTemporaryMissionSnapshot();
      return;
    }
    const p = ensureOpsTargetPattern();
    if (!p) return;
    applyModeFlags(coerceOpsMode(opsState.returnMode || OPS_MODE.BASE));
    applyOpsStateUi();
    applyTraceForOpsMode(recomputeOpsMode());
    refreshMissionStopVisualsAndStats();
    appendOpsLog("return_initial", "Retour état initial mission");
  })().catch((e) => console.warn("return_initial:", e));
});

temporarySaveDeviationBtn?.addEventListener("click", () => {
  void saveTemporaryDeviationToLocalStore().catch((e) =>
    console.warn("saveTemporaryDeviation:", e),
  );
});

returnBaseBtn.addEventListener("click", () => {
  purgeDeviationsSavedDuringTemporarySession();
  const p = ensureOpsTargetPattern();
  if (!p) return;
  opsState.temporaryDeviationActive = false;
  snapshotBeforeTemporary = null;
  plannedDeviationEditSnapshot = null;
  deferPlannedSaveUntilEditedAfterTempRecorded = false;
  refreshTemporaryDeviationUi();
  stopManualDrawMode();
  opsState.manualActive = false;
  opsState.returnMode = OPS_MODE.BASE;
  opsState.modeCoordinates.MANUEL_ACTIF = null;
  opsState.manualProfile = null;
  opsState.manualStopOverrides = {};
  opsState.nonServedEditActive = false;
  opsState.provisionalStops = [];
  opsState.provisionalEditActive = false;
  nonServedEditFocusStopId = null;
  applyOpsStateUi();
  applyTraceForOpsMode(OPS_MODE.BASE);
  refreshMissionStopVisualsAndStats();
  syncPlannedSaveBaselineFromLive();
  setGpsStatus("Mode base rétabli : déviation courante effacée.");
  appendOpsLog("return_base", "Forçage mode BASE");
});

saveDeviationBtn?.addEventListener("click", () => {
  void deviationSaveOrUpdatePlannedFromToolbar();
});

updateDeviationBtn?.addEventListener("click", () =>
  deviationSaveOrUpdate("update"),
);

loadDeviationBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      await loadDeviationItemIntoApp(getSelectedDeviationItem(), {
        forceOpsReset: true,
      });
    } finally {
      closeControlPanel();
    }
  })();
});

deleteDeviationBtn?.addEventListener("click", () => {
  void deviationDeleteSelected().catch((e) =>
    console.warn("deviationDeleteSelected:", e),
  );
});

duplicateFromDeviationSelectEl?.addEventListener("change", () => {
  refreshDuplicateTargetsForSelectedSource();
});

duplicateDeviationBtn?.addEventListener("click", () => {
  deviationDuplicateSelectionToVariant();
});

savedDeviationSelectEl?.addEventListener("change", () => {
  refreshSavedDeviationBannerAndDup(getSelectedDeviationItem());
  if (duplicateFromDeviationSelectEl && getSelectedDeviationItem()?.id) {
    duplicateFromDeviationSelectEl.value = getSelectedDeviationItem().id;
  }
  refreshDuplicateTargetsForSelectedSource();
});

document.getElementById("nextBtn").addEventListener("click", () => {
  jumpServedStop(1);
});

document.getElementById("prevBtn").addEventListener("click", () => {
  jumpServedStop(-1);
});

speedSelect.addEventListener("change", () => {
  speed = Number(speedSelect.value) || 1;
  refreshMapHudSpeedLabel();
});
speed = Number(speedSelect.value) || 1;
refreshMapHudSpeedLabel();

lineSelect.addEventListener("change", updateHeadsigns);
lineSelect.addEventListener("change", syncLineCustomTrigger);
lineSelect.addEventListener("change", refreshSavedDeviationSelectOptions);
lineSelectTrigger?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!lineSelectListbox) {
    return;
  }
  setLineListboxOpen(!lineListboxOpen);
});
lineSelectListbox?.addEventListener("click", (e) => {
  const row = e.target.closest?.(".line-pick-row");
  if (!row) {
    return;
  }
  e.preventDefault();
  const idx = row.getAttribute("data-line-idx");
  if (idx == null) {
    return;
  }
  lineSelect.value = String(idx);
  lineSelect.dispatchEvent(new Event("change", { bubbles: true }));
  setLineListboxOpen(false);
});
document.addEventListener("click", (e) => {
  if (!lineListboxOpen) {
    return;
  }
  if (lineSelectDual && !lineSelectDual.contains(e.target)) {
    setLineListboxOpen(false);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lineListboxOpen) {
    setLineListboxOpen(false);
  }
});
headsignSelect.addEventListener("change", updateVariants);
variantSelect.addEventListener("change", () => {
  previewSelectedMission().catch((e) => {
    console.warn("Preview mission failed:", e);
  });
});

function saveMapPrefs() {
  try {
    localStorage.setItem(LS_KEY_HEADING, headingUpEl.checked ? "1" : "0");
  } catch (e) {
    // ignore
  }
}

function initVocalUI() {
  try {
    const on = localStorage.getItem(LS_KEY_ENABLED);
    voiceEnabledEl.checked = on === "1" || on === "true";
    const mode = localStorage.getItem(LS_KEY_MODE);
    if (mode && ["depart", "mid", "both"].includes(mode)) {
      voiceModeEl.value = mode;
    }
    const h = localStorage.getItem(LS_KEY_HEADING);
    if (h === "0" || h === "false") {
      headingUpEl.checked = false;
    }
    if (h === "1" || h === "true") {
      headingUpEl.checked = true;
    }
  } catch (e) {
    // ignore
  }
  voiceModeEl.disabled = !voiceEnabledEl.checked;
  refreshVoiceSelect();
  syncMapHudHeadingCheckboxFromMain();
  refreshMapHudVoiceBtn();
  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      refreshVoiceSelect();
    });
  }
}

function saveVocalPrefs() {
  try {
    localStorage.setItem(LS_KEY_ENABLED, voiceEnabledEl.checked ? "1" : "0");
    localStorage.setItem(LS_KEY_MODE, voiceModeEl.value);
    localStorage.setItem(LS_KEY_VOICE, voiceSelectEl.value);
  } catch (e) {
    // ignore
  }
}

voiceEnabledEl.addEventListener("change", () => {
  voiceModeEl.disabled = !voiceEnabledEl.checked;
  saveVocalPrefs();
  refreshMapHudVoiceBtn();
});
voiceModeEl.addEventListener("change", saveVocalPrefs);
voiceSelectEl.addEventListener("change", saveVocalPrefs);

headingUpEl.addEventListener("change", () => {
  saveMapPrefs();
  syncMapHudHeadingCheckboxFromMain();
  if (currentPattern && pathTotalMeters > 0) {
    if (headingUpEl.checked) {
      updateMapNavigation({ centerCamera: true, zoom: map.getZoom() });
    } else {
      if (typeof map.setBearing === "function") {
        map.setBearing(0);
      }
      updateMapNavigation({ centerCamera: true, zoom: map.getZoom() });
    }
  } else {
    if (typeof map.setBearing === "function") {
      map.setBearing(0);
    }
  }
});

voiceTestBtn.addEventListener("click", () => {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return;
  }
  if (!getSpeechVoices().length) {
    refreshVoiceSelect();
  }
  if (!resolveCurrentVoice()) {
    const msg =
      "Aucune voix utilisable. Vérifiez qu'une voix française est installée (paramètres Windows / navigateur) puis rouvrez la page.";
    if (voiceNoteEl) {
      const prev = voiceNoteEl.textContent;
      voiceNoteEl.textContent = msg;
      setTimeout(() => {
        voiceNoteEl.textContent = prev;
      }, 8000);
    }
    return;
  }
  speakProchainArret("Test, Place de l'Europe", true);
});

initVocalUI();
try {
  const savedDriveMode = localStorage.getItem(LS_KEY_DRIVE_MODE);
  if (
    savedDriveMode === DRIVE_MODE.REAL ||
    savedDriveMode === DRIVE_MODE.SIMULATION
  ) {
    driveMode = savedDriveMode;
  }
} catch (e) {
  // ignore
}
if (driveModeSelect) {
  driveModeSelect.value = driveMode;
  driveModeSelect.addEventListener("change", () => {
    const nextMode =
      driveModeSelect.value === DRIVE_MODE.REAL
        ? DRIVE_MODE.REAL
        : DRIVE_MODE.SIMULATION;
    driveMode = nextMode;
    running = false;
    lastRafTime = 0;
    try {
      localStorage.setItem(LS_KEY_DRIVE_MODE, driveMode);
    } catch (e) {
      // ignore
    }
    stopGpsTracking();
    refreshDriveModeUi();
  });
}
refreshDriveModeUi();
refreshManualDrawUi();
setupMapMissionHud();
setupTamRoutePlannerUi();
burgerMenuBtn?.addEventListener("click", () => openControlPanel());
recapToggleBtn?.addEventListener("click", () => {
  const isOn = !!mapRecapEl?.classList.contains("show");
  setRecapVisible(!isOn);
});
closeMenuBtn?.addEventListener("click", closeControlPanel);
missionTabBtn?.addEventListener("click", () => setPanelTab("mission"));
opsTabBtn?.addEventListener("click", () => setPanelTab("ops"));
voiceTabBtn?.addEventListener("click", () => setPanelTab("voice"));
helpTabBtn?.addEventListener("click", () => setPanelTab("help"));
controlPanelEl
  ?.querySelectorAll(".panel-ops-subtabs [data-ops-subtab]")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      const sub = btn.getAttribute("data-ops-subtab");
      if (sub) setOpsSubtab(sub);
    });
  });
controlPanelEl?.addEventListener("click", (e) => {
  if (e.target === controlPanelEl) {
    closeControlPanel();
  }
});
window.addEventListener("resize", refreshMapLayout);
window.addEventListener("orientationchange", refreshMapLayout);
try {
  const recapOn = localStorage.getItem(LS_KEY_RECAP);
  setRecapVisible(recapOn === "1" || recapOn === "true");
} catch (e) {
  setRecapVisible(false);
}
refreshMapLayout();
applyMapVisualProfile();

fetch("./simulation_data.json")
  .then((resp) => resp.json())
  .then((json) => {
    data = json;
    datasetDigestLoaded = String(json?.meta?.dataset_digest || "");
    updateLines();
    applyMapVisualProfile();
    refreshSavedDeviationSelectOptions();
    requestAnimationFrame(tickRaf);
    refreshMapLayout();
  })
  .catch((err) => {
    tamAppAlert(
      "Impossible de charger simulation_data.json. Lancez d'abord build_simulator_data.py",
    );
    console.error(err);
  });
window.addEventListener("beforeunload", () => {
  stopGpsTracking();
});
