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
  return normalizeText(s)
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    if (!sid || !Object.prototype.hasOwnProperty.call(overrides, sid))
      continue;
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
  return collectMergedGuideEntriesRaw().filter(
    mergedEntryIsServedForGuide,
  );
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
      servedGuideSnapshot[
        Math.min(pos + 1, servedGuideSnapshot.length - 1)
      ];
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
  const r = Math.max(
    p.stopRadius + 1,
    (p.stopRadius + p.skippedRadius) / 2,
  );
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
    const focusThisStop =
      nonServedPickMode && nonServedEditFocusStopId === sid;
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
      if (!(opsState.manualActive && opsState.nonServedEditActive))
        return;
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
      ? opsState.modeCoordinates[OPS_MODE.MANUEL] ||
        opsState.baseCoordinates
      : opsState.baseCoordinates;
  if (!coords || coords.length < 2) return;
  activeCoordinates = coords;
  rebuildPathMetrics(activeCoordinates);
  trimActivePathToPatternStops(currentPattern);
  stopMetersAlong = buildStopMetersAlong(currentPattern);
  rebuildActiveGuideStops();
  fullLine.setLatLngs(activeCoordinates);
  const newD = Math.min(
    pathTotalMeters,
    Math.max(0, ratio * pathTotalMeters),
  );
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
 * @param {"option"|"row"|"trigger"|"missionSelect"|"contextPill"} context
 */
function applyLineColorStyling(el, item, context) {
  const bg =
    forcedLineColor(item?.route_short_name) ||
    lineColorHex(item?.route_color);
  if (bg) {
    const tx = lineLabelContrastTextColor(item);
    el.style.backgroundColor = bg;
    el.style.color = tx;
    el.style.fontWeight = "700";
    el.style.setProperty("-webkit-text-fill-color", tx);
    if (context === "missionSelect") {
      el.style.border = "1px solid rgba(0, 0, 0, 0.2)";
      /* Bande couleur ligne uniquement sur le menu, pas sur le label (évite le « rose » à côté du 2 / 3). */
      el.style.borderLeft = `4px solid ${bg}`;
      el.classList.add("line-themed-select");
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
    item && item.route_short_name != null
      ? item
      : { route_short_name: "" };
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
  return (
    item.route_type === "0" && Number.isInteger(n) && n >= 1 && n <= 5
  );
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
  const currentRouteCode = String(currentPattern?.route_short_name || "").trim();
  const stopId = String(stopObj?.stop_id || "").trim();
  const stopNameKey = normalizeStopName(stopObj?.stop_name || stopObj?.name || "");
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
  const groups = {
    tram: lineOptions.filter(isTramDisplayLine),
    navette: lineOptions.filter(
      (x) => String(x.route_short_name) === "A",
    ),
    bus: lineOptions.filter(
      (x) => !isTramDisplayLine(x) && String(x.route_short_name) !== "A",
    ),
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

  addLineGroup("Tram", groups.tram);
  addLineGroup("Navette", groups.navette);
  addLineGroup("Bus", groups.bus);

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
    { label: "Tram", items: groups.tram },
    { label: "Navette", items: groups.navette },
    { label: "Bus", items: groups.bus },
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
  lineSelectTrigger.setAttribute(
    "aria-expanded",
    open ? "true" : "false",
  );
  const v = String(lineSelect.value);
  for (const row of lineSelectListbox.querySelectorAll(
    ".line-pick-row",
  )) {
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
    headsignSelect.options[headsignSelect.selectedIndex]?.textContent ||
    "";
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
      missionContextScroll.classList.remove(
        "mission-context-scroll--pan",
      );
      missionContextScroll.scrollLeft = 0;
    }
    missionContextBar.hidden = true;
    return;
  }
  const val = lineSelect.value;
  const item = lineOptionLookup[Number(val)];
  if (!item) {
    if (missionContextScroll) {
      missionContextScroll.classList.remove(
        "mission-context-scroll--pan",
      );
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
    headsignSelect.options[headsignSelect.selectedIndex]?.textContent ||
    "";
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
    const candidate = Math.min(
      maxAllowed,
      Math.max(out[i - 1] + eps, raw[i]),
    );
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
  if (
    !stops.length ||
    activeCoordinates.length < 2 ||
    pathTotalMeters <= 0
  ) {
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
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
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
  if (
    n.includes("premium") ||
    n.includes("enhanced") ||
    n.includes("hd ")
  )
    s += 45;
  if (n.includes("google")) s += 40;
  if (
    n.includes("microsoft") ||
    n.includes("hortense") ||
    n.includes("julie") ||
    n.includes("paul ")
  )
    s += 35;
  if (
    n.includes("apple") ||
    n.includes("amelie") ||
    n.includes("thomas ")
  )
    s += 25;
  if (n.includes("samantha")) s += 15;
  if (
    n.includes("pico") ||
    n.includes("espeak") ||
    n.includes("festival ")
  )
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
  const u = new SpeechSynthesisUtterance(`Prochain arrêt, ${nom}.`);
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
  if (
    !stopMetersAlong.length ||
    !currentPattern ||
    !currentPattern.stops
  ) {
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
    const mid =
      ((stopMetersAlong[i] || 0) + (stopMetersAlong[j] || 0)) / 2;
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
        if (
          prev < tDep &&
          curr >= tDep &&
          !voixAnnounced.has(`dgp_${p}`)
        ) {
          voixAnnounced.add(`dgp_${p}`);
          speakProchainArret(nextName);
        }
      }
      if (mode === "mid" || mode === "both") {
        if (
          prev < tMid &&
          curr >= tMid &&
          !voixAnnounced.has(`mgp_${p}`)
        ) {
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
      const t =
        ((stopMetersAlong[i] || 0) + (stopMetersAlong[j] || 0)) / 2;
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
      const slots = getCurrentAndNextServedGuideSlots(
        distanceAlongPathMeters,
      );
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
    if (
      (stopMetersAlong[served[p]] || 0) <=
      distanceAlongPathMeters + 0.5
    ) {
      idx = served[p];
    }
  }
  const pos = Math.max(0, served.indexOf(idx));
  const nextPos =
    delta < 0
      ? Math.max(pos - 1, 0)
      : Math.min(pos + 1, served.length - 1);
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
    const slots = getCurrentAndNextServedGuideSlots(
      distanceAlongPathMeters,
    );
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

    const directScore =
      pointDistance(start, first) + pointDistance(end, last);
    const reverseScore =
      pointDistance(start, last) + pointDistance(end, first);

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
  return getNetworkGeometryByLine(
    data?.bus_network_features || [],
    pattern,
  );
}

function getTramNetworkGeometry(pattern) {
  return getNetworkGeometryByLine(
    data?.tram_network_features || [],
    pattern,
  );
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
    if (
      activeCoordinates.length &&
      activeCoordinates !== pattern.coordinates
    ) {
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
    return;
  }
  root.classList.remove("tam-stop-rail--explore");
  tamStopRailLastAutoSnapK = null;
  requestAnimationFrame(() => {
    snapTamStopRailScrollToLastPastImpl();
    tamStopRailLastAutoSnapK = currentStopIndexForDistance(
      distanceAlongPathMeters,
    );
    updateTamStopRailCompactSpacing();
  });
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
    return Math.min(
      100,
      Math.max(0, (dc / pathTotalMeters) * 100),
    );
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
  const hudLive =
    !!hud && !hud.classList.contains("map-mission-hud--inactive");

  if (!currentPattern?.stops?.length || pathTotalMeters <= 0) {
    tamStopRailBuiltFor = "";
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
    const span = document.createElement("span");
    span.className = "tam-stop-rail__pillLabel";
    span.textContent = name;
    main.appendChild(span);
    const correspondences = getStopCorrespondenceLines(st);
    if (correspondences.length) {
      const corrWrap = document.createElement("span");
      corrWrap.className = "tam-stop-rail__correspondences";
      const shown = correspondences.slice(0, 4);
      for (const lineItem of shown) {
        const badge = document.createElement("span");
        badge.className = "tam-stop-rail__correspondenceBadge";
        badge.textContent = displayLineLabel(lineItem);
        styleStopCorrespondenceBadge(badge, lineItem);
        corrWrap.appendChild(badge);
      }
      const hiddenCount = correspondences.length - shown.length;
      if (hiddenCount > 0) {
        const more = document.createElement("span");
        more.className =
          "tam-stop-rail__correspondenceBadge tam-stop-rail__correspondenceBadge--more";
        more.textContent = `+${hiddenCount}`;
        corrWrap.appendChild(more);
      }
      main.appendChild(corrWrap);
      const corrTxt = correspondences.map((x) => displayLineLabel(x)).join(", ");
      btn.setAttribute("aria-label", `Arrêt : ${name}. Correspondances : ${corrTxt}`);
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
    pathTotalMeters > 0
      ? ((d / pathTotalMeters) * 100).toFixed(1)
      : "0.0";
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
  const nextIdx =
    idx === -1 ? 0 : (idx + 1) % MAP_HUD_SPEED_SEQUENCE.length;
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
  if (
    !root ||
    !toggleB ||
    !voiceB ||
    !pauseB ||
    !prevB ||
    !nextB ||
    !speedB ||
    !mapHeading
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
  const chainArr = manualProfileToVisualChainArray(
    opsState.manualProfile,
  );
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
    const endedTemp = tryDismissTemporaryDeviationIfUnchanged(
      "quit_trace_draft",
    );
    const endedPlan = tryDismissPlannedDeviationIfUnchanged(
      "quit_trace_draft",
    );
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
tempManualDrawStartBtn?.addEventListener(
  "click",
  onManualDrawStartClick,
);

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
  if (isTempDeviationSubtabActive() && !ensureTemporaryDeviationSessionIfOnSubtab()) {
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
  if (isTempDeviationSubtabActive() && !ensureTemporaryDeviationSessionIfOnSubtab()) {
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
manualDrawSaveBtn?.addEventListener("click", () =>
  void onManualDrawSaveClick("plan"),
);
tempManualDrawSaveBtn?.addEventListener("click", () =>
  void onManualDrawSaveClick("temp"),
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
    localStorage.setItem(
      LS_KEY_ENABLED,
      voiceEnabledEl.checked ? "1" : "0",
    );
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
