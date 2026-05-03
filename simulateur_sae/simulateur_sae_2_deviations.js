/* simulateur SAE — fichier 2/3 : stockage local des déviations, fiches et duplication (voir fin de fichier).
 * S’appuie sur tout ce qui précède (fichier 1). */

function readDeviationStore() {
  try {
    const raw = localStorage.getItem(LS_KEY_DEVIATIONS);
    if (!raw) return { version: 1, items: [] };
    const j = JSON.parse(raw);
    if (!j || j.version !== 1 || !Array.isArray(j.items)) {
      return { version: 1, items: [] };
    }
    return j;
  } catch (e) {
    return { version: 1, items: [] };
  }
}

function writeDeviationStore(store) {
  try {
    localStorage.setItem(LS_KEY_DEVIATIONS, JSON.stringify(store));
  } catch (e) {
    window.alert(
      "Stockage local plein ou désactivé : impossible d'enregistrer la déviation.",
    );
  }
}

/**
 * id de la fiche dont le payload a été appliqué sur la carte (« Charger la sélection »).
 * null si la mission affichée ne correspond pas à une fiche explicitement chargée
 * (évite de mettre à jour une entrée liste alors que la carte est encore « ligne de base »).
 */
let liveDeviationLoadedItemId = null;

function clearLiveDeviationLoadedSource() {
  liveDeviationLoadedItemId = null;
}

/** Listes déroulantes + duplication après lecture/écriture du stockage local fiches. */
function refreshDeviationStoreSelectorsAfterMutation() {
  refreshSavedDeviationSelectOptions();
  refreshSavedDeviationBannerAndDup(getSelectedDeviationItem());
  rebuildDuplicateFromOptions();
  refreshDuplicateTargetsForSelectedSource();
}

function generateLocalDeviationRecordId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `d_${Date.now()}_${Math.floor(Math.random() * 99999)}`;
}

function selectSavedDeviationSelectOptionByDeviationId(deviationId) {
  const id = deviationId != null ? String(deviationId) : "";
  if (!id || !savedDeviationSelectEl) return;
  const opts = savedDeviationSelectEl.options;
  for (let i = 0; i < opts.length; i++) {
    if (opts[i].dataset.deviationId === id) {
      savedDeviationSelectEl.selectedIndex = i;
      break;
    }
  }
}

function purgeDeviationsSavedDuringTemporarySession() {
  if (!deviationIdsSavedDuringTemporarySession.length) return;
  const idSet = new Set(deviationIdsSavedDuringTemporarySession);
  deviationIdsSavedDuringTemporarySession = [];
  const st = readDeviationStore();
  const nBefore = st.items.length;
  st.items = st.items.filter((x) => !idSet.has(x.id));
  if (st.items.length === nBefore) return;
  writeDeviationStore(st);
  refreshDeviationStoreSelectorsAfterMutation();
  appendOpsLog("temporary_saved_deviations_purged", [...idSet].join(","));
}

/** Ex. T3 pour retrouver toutes les entrées « Déviation temporaire » à la Rétablissement. */
function routeShortNameForPatternId(patternId) {
  const pat = data?.patterns?.find(
    (x) => String(x.pattern_id || "") === String(patternId || ""),
  );
  return String(pat?.route_short_name || "").trim();
}

/**
 * Supprime du stockage local toutes les fiches dont le libellé est une « déviation temporaire »
 * pour la ligne (route_short_name), ex. les duplicatas V1/V2/V3.
 */
function purgeTemporaryLabeledSavedDeviationsForRouteShortName(routeShortName) {
  const want = String(routeShortName || "").trim();
  if (!want) return;
  const st = readDeviationStore();
  const nBefore = st.items.length;
  st.items = st.items.filter((it) => {
    if (!isDeviationTemporaireStoredLabel(it?.label)) return true;
    return String(routeShortNameForSavedDeviation(it) || "").trim() !== want;
  });
  if (st.items.length === nBefore) return;
  writeDeviationStore(st);
  refreshDeviationStoreSelectorsAfterMutation();
  appendOpsLog("temporary_labelled_deviations_purged", want);
}

function getPatternDigest(pat) {
  if (!pat) return "";
  const s = String(pat.pattern_signature || "").trim();
  return s || "legacy_missing";
}

/** Horodatage et empreintes communes aux entrées « Déviations enregistrées » (localStorage). */
function stampDeviationItemPayloadMeta(cur, p, nowIso) {
  cur.pattern_id = p.pattern_id;
  cur.origin_deviation_id = String(cur.origin_deviation_id || cur.id || "");
  cur.pattern_signature_snapshot = getPatternDigest(p);
  cur.dataset_digest_snapshot = datasetDigestLoaded || "";
  cur.updated_at = nowIso;
}

function formatLineLabelForDeviation(pat) {
  const code = String(pat?.route_short_name || "").trim();
  if (String(pat?.route_type || "") === "0" && /^\d+$/.test(code)) {
    return `T${code}`;
  }
  return code || "?";
}

function formatVariantLabelForDeviation(pat) {
  const n = String(pat?.variant_name || "").match(/\d+/)?.[0];
  return n ? `V${n}` : String(pat?.variant_name || "V?");
}

function buildAutoDeviationLabel(pat) {
  const line = formatLineLabelForDeviation(pat);
  const variant = formatVariantLabelForDeviation(pat);
  const start = String(pat?.start_stop || "?");
  const end = String(pat?.end_stop || "?");
  return `${line} (${variant}: ${start} -> ${end})`;
}

function buildTemporaryDeviationDefaultLabel(pat) {
  return `Déviation temporaire — ${buildAutoDeviationLabel(pat)}`;
}

function isDeviationTemporaireStoredLabel(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  return (
    s.startsWith("déviation temporaire") || s.startsWith("deviation temporaire")
  );
}

/** Libellé d’une copie vers une autre variante (conserve le préfixe temporaire si la source l’avait). */
function duplicateDeviationLabelForVariant(sourceItem, targetPat) {
  if (isDeviationTemporaireStoredLabel(sourceItem?.label)) {
    return buildTemporaryDeviationDefaultLabel(targetPat);
  }
  return buildAutoDeviationLabel(targetPat);
}

async function saveTemporaryDeviationToLocalStore() {
  if (!opsState.temporaryDeviationActive) {
    window.alert(
      "Commencez par utiliser le tracé ou la saisie d’arrêts sous Temporaire — la session temporaire s’ouvre au premier geste utile.",
    );
    return;
  }
  const p = selectedPattern();
  if (!p) {
    window.alert("Choisissez une mission.");
    return;
  }
  ensureOpsTargetPattern();
  const pl = deviationPayloadFromLiveState();
  if (deviationPayloadIsEmpty(pl)) {
    window.alert(
      "Rien à enregistrer : aucun tracé de déviation planifiée, aucun arrêt marqué non desservi, aucun arrêt provisoire.",
    );
    return;
  }
  const id = await deviationSaveOrUpdate("new", {
    allowDuringTemporaryDevSession: true,
  });
  if (!id) return;
  deviationIdsSavedDuringTemporarySession.push(String(id));
  commitTemporaryDeviationMode({
    statusMessage:
      "Déviation temporaire enregistrée (stockage navigateur). « Rétablir le mode exploitation du début de mission » efface aussi sur la carte l’exploration en cours ; l’entrée tout juste créée sera retirée de la liste en même temps.",
  });
  deferPlannedSaveGateAfterRecordedTemporaryDeviation();
}

function normalizeDeviationLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(/\s*\[V\d+\]\s*$/i, "")
    .replace(/\s*[—-]\s*V\d+\s*$/i, "")
    .trim();
}

function routeShortNameForSavedDeviation(item) {
  const pid = String(item?.pattern_id || "");
  const pat = data?.patterns?.find((p) => String(p.pattern_id || "") === pid);
  return String(pat?.route_short_name || "");
}

function currentMissionRouteShortName() {
  return String(selectedPattern()?.route_short_name || "");
}

function filterSavedDeviationsForCurrentMission(items) {
  const missionLine = currentMissionRouteShortName();
  if (!missionLine) return items;
  return items.filter(
    (it) => String(routeShortNameForSavedDeviation(it)) === missionLine,
  );
}

function deviationPayloadFromLiveState() {
  const merged = opsState.modeCoordinates?.[OPS_MODE.MANUEL];
  const mp = opsState.manualProfile;
  let mpCopy = null;
  if (mp) {
    const ranges =
      Array.isArray(mp.baseBypassRanges) && mp.baseBypassRanges.length
        ? mp.baseBypassRanges
        : normalizeBypassRangesOnBase(mp);
    mpCopy = {
      startDistance: mp.startDistance,
      endDistance: mp.endDistance,
      detourCoords: tamMapLatLngPairs(mp.detourCoords),
      bypassedCoords: tamMapLatLngPairs(mp.bypassedCoords),
      mergedCoords: tamMapLatLngPairs(mp.mergedCoords),
      baseBypassRanges: ranges.map((pair) => [
        Number(pair[0]),
        Number(pair[1]),
      ]),
      detourVisualChain: Array.isArray(mp.detourVisualChain)
        ? mp.detourVisualChain.map(normalizeDeviationChainSegmentFromStored)
        : (mp.detourCoords || []).length >= 2
          ? [
              normalizeDeviationChainSegmentFromStored({
                detourCoords: mp.detourCoords,
                bypassedCoords: mp.bypassedCoords,
              }),
            ]
          : [],
    };
  }
  return {
    manualProfile: mpCopy,
    mergedCoordsManual: Array.isArray(merged)
      ? merged.map((xy) => [Number(xy[0]), Number(xy[1])])
      : null,
    manualStopOverrides: tamCloneSerializable({}, opsState.manualStopOverrides),
    provisionalStops: tamCloneSerializable([], opsState.provisionalStops),
  };
}

function deviationPayloadIsEmpty(pl) {
  const ovs = pl.manualStopOverrides || {};
  const hasOv = Object.keys(ovs).some((k) => ovs[k]);
  const hasProv =
    Array.isArray(pl.provisionalStops) && pl.provisionalStops.length > 0;
  const hasTrace =
    pl.manualProfile &&
    Array.isArray(pl.mergedCoordsManual) &&
    pl.mergedCoordsManual.length >= 2;
  return !hasOv && !hasProv && !hasTrace;
}

/**
 * Snapshot JSON pour « Rétablir… » : après chargement fiche, ouverture session temp,
 * ou fin de restore (évite références partagées au liveState).
 */
function buildTemporaryRevertSnapshotFromMissionPattern(pat) {
  if (!pat) return null;
  return {
    pattern_id: String(pat.pattern_id || ""),
    payload: tamCloneSerializable({}, deviationPayloadFromLiveState()),
    returnMode: coerceOpsMode(opsState.returnMode || OPS_MODE.BASE),
    initialMode: coerceOpsMode(opsState.initialMode || OPS_MODE.BASE),
  };
}

/**
 * État bouton « Enregistrer la déviation planifiée » : session temp, contenu carte, verrou defer.
 * @returns {{ disabled: boolean, title: string }}
 */
function computePlannedSaveDeviationToolbarState(o) {
  const deferEffective = o.deferPlannedGate && o.hasContent;
  const canSave =
    !o.temporarySessionOn &&
    o.hasMission &&
    !!o.payloadDirty &&
    !deferEffective;
  let title = "";
  if (o.temporarySessionOn) {
    title =
      "Une session Temporaire est ouverte — enregistrez-la ou rétablissez avant une fiche planifiée.";
  } else if (!o.hasMission) {
    title = "Choisissez une mission pour enregistrer une déviation planifiée.";
  } else if (deferEffective) {
    title =
      "Pour activer « Enregistrer la déviation planifiée », utilisez d’abord un bouton du sous-onglet Planifiée (tracé, retirer le dernier point, valider ce tracé côté planifiée…). Cela évite d’associer à la Planifiée un retour simplement « depuis Temporaire / Rétablir » sans intention explicite.";
  } else if (!o.payloadDirty) {
    title = !o.hasContent
      ? o.tipWhenSavingNeedsContent
      : "Aucune modification à enregistrer par rapport au dernier chargement ou enregistrement local.";
  }
  return { disabled: !canSave, title };
}

/**
 * État bouton « Enregistrer la déviation temporaire » (session + contenu carte).
 * @returns {{ disabled: boolean, title: string }}
 */
function computeTemporarySaveDeviationToolbarState(o) {
  const canSave = o.temporarySessionOn && o.hasMission && o.hasContent;
  let title = "";
  if (!o.hasMission) {
    title = "Choisissez une mission pour enregistrer la déviation temporaire.";
  } else if (!canSave) {
    title = o.tipWhenSavingNeedsContent;
  }
  return { disabled: !canSave, title };
}

/** Seuil de déplacement GPS avant bannière « déviation non enregistrée » (~précision horizontale courante). */
const GPS_UNSAVED_DEVIATION_WARN_METERS = 25;
let gpsUnsavedDeviationWarnAnchorLatLng = null;
/** Mis à true après reprise bloquée (simu) ou déplacement GPS seuil ; effacé quand plus d’enregistrement attendu. */
let unsavedDeviationUserWarnedLatch = false;

function resetGpsUnsavedDeviationMovementWarn() {
  gpsUnsavedDeviationWarnAnchorLatLng = null;
}

/** Texte du bandeau : consigne courte + modes de saisie actifs le cas échéant. */
function buildUnsavedDeviationBannerDetailText() {
  const parts = [];
  if (opsState.provisionalEditActive) {
    parts.push(
      "quittez la saisie avec « Quitter la saisie arrêts provisoires »",
    );
  }
  if (opsState.nonServedEditActive) {
    parts.push("quittez la saisie arrêts non desservis");
  }
  if (typeof manualDrawActive !== "undefined" && manualDrawActive) {
    parts.push("terminez ou annulez le tracé manuel en cours");
  }
  const head = parts.length > 0 ? `${parts.join(", puis ")}, puis ` : "";
  return `${head}enregistrez avec « Enregistrer la déviation planifiée » ou « Enregistrer la déviation temporaire » (panneau latéral → Déviations), ou rétablissez l’état, avant de reprendre le trajet.`;
}

function refreshUnsavedDeviationBannerUi() {
  const el = document.getElementById("tamUnsavedDeviationBanner");
  const detailEl = document.getElementById("tamUnsavedDeviationBannerDetail");
  if (!el) return;
  if (typeof isDeviationSaveActionCurrentlyOffered !== "function") {
    return;
  }
  const offered = isDeviationSaveActionCurrentlyOffered();
  if (!offered) {
    unsavedDeviationUserWarnedLatch = false;
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    if (detailEl) detailEl.textContent = "";
    return;
  }
  const show = unsavedDeviationUserWarnedLatch;
  el.hidden = !show;
  el.setAttribute("aria-hidden", show ? "false" : "true");
  if (detailEl) {
    detailEl.textContent =
      show && offered ? buildUnsavedDeviationBannerDetailText() : "";
  }
}

/**
 * True si au moins un bouton Enregistrer (planifiée ou temporaire) est actuellement cliquable —
 * même critères que `refreshTemporaryDeviationUi`.
 */
function isDeviationSaveActionCurrentlyOffered() {
  const temporarySessionOn = !!opsState.temporaryDeviationActive;
  const pat = typeof selectedPattern === "function" ? selectedPattern() : null;
  const hasMission = !!pat;
  const hasContent = !deviationPayloadIsEmpty(deviationPayloadFromLiveState());
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
  const planned = computePlannedSaveDeviationToolbarState({
    temporarySessionOn,
    hasMission,
    hasContent,
    deferPlannedGate: deferPlannedSaveUntilEditedAfterTempRecorded,
    payloadDirty,
    tipWhenSavingNeedsContent,
  });
  const temporary = computeTemporarySaveDeviationToolbarState({
    temporarySessionOn,
    hasMission,
    hasContent,
    tipWhenSavingNeedsContent,
  });
  return !planned.disabled || !temporary.disabled;
}

/**
 * Bloque l’action si un enregistrement est attendu (bouton planifiée ou temporaire actif).
 * @returns {boolean} true → ne pas reprendre la simulation / ne pas sauter d’arrêt
 */
function blockMissionResumeIfUnsavedDeviation() {
  if (!isDeviationSaveActionCurrentlyOffered()) return false;
  unsavedDeviationUserWarnedLatch = true;
  refreshUnsavedDeviationBannerUi();
  return true;
}

/**
 * Appelé à chaque point GPS : déclenche la bannière persistante après ~25 m sans enregistrement.
 */
function maybeWarnUnsavedDeviationAfterGpsMovement(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (typeof L === "undefined" || !L.latLng) return;
  if (!isDeviationSaveActionCurrentlyOffered()) {
    gpsUnsavedDeviationWarnAnchorLatLng = null;
    return;
  }
  const cur = L.latLng(lat, lon);
  if (!gpsUnsavedDeviationWarnAnchorLatLng) {
    gpsUnsavedDeviationWarnAnchorLatLng = cur;
    return;
  }
  const dist = gpsUnsavedDeviationWarnAnchorLatLng.distanceTo(cur);
  if (dist < GPS_UNSAVED_DEVIATION_WARN_METERS) return;
  gpsUnsavedDeviationWarnAnchorLatLng = cur;
  unsavedDeviationUserWarnedLatch = true;
  refreshUnsavedDeviationBannerUi();
}

/** Repositionner les trois sélecteurs mission sur un pattern exact. */
function selectMissionSelectorsForPattern(pat) {
  if (!pat || !Array.isArray(data?.patterns)) return false;
  const lineIdx = lineOptionLookup.findIndex(
    (it) => String(it.route_short_name) === String(pat.route_short_name),
  );
  if (lineIdx < 0) return false;
  lineSelect.value = String(lineIdx);
  lineSelect.dispatchEvent(new Event("change"));
  filteredByLine = data.patterns.filter(
    (p) => String(p.route_short_name) === String(pat.route_short_name),
  );

  const headKey = `${pat.direction_id}|||${pat.headsign}`;
  const headsignKeys = uniqueValues(
    filteredByLine,
    (x) => `${x.direction_id}|||${x.headsign}`,
  ).sort((a, b) => a.localeCompare(b, "fr"));
  const hi = headsignKeys.indexOf(headKey);
  if (hi < 0) return false;
  headsignSelect.selectedIndex = hi;
  headsignSelect.dispatchEvent(new Event("change"));
  filteredByHeadsign = filteredByLine.filter(
    (x) => x.direction_id === pat.direction_id && x.headsign === pat.headsign,
  );
  filteredByHeadsign.sort((a, b) =>
    a.variant_name.localeCompare(b.variant_name, "fr"),
  );
  const vi = filteredByHeadsign.findIndex(
    (x) => x.pattern_id === pat.pattern_id,
  );
  if (vi < 0) return false;
  variantSelect.selectedIndex = vi;
  variantSelect.dispatchEvent(new Event("change"));
  return true;
}

function rebuildDuplicateVariantChoices(pidAnchor) {
  duplicateVariantChoices = [];
  if (!duplicateTargetVariantSelectEl || !pidAnchor) {
    if (duplicateTargetVariantSelectEl) {
      duplicateTargetVariantSelectEl.innerHTML = "";
    }
    return;
  }
  const anchor = data.patterns.find((p) => (p.pattern_id || "") === pidAnchor);
  if (!anchor) {
    duplicateTargetVariantSelectEl.innerHTML = "";
    return;
  }

  duplicateVariantChoices = data.patterns.filter(
    (p) =>
      p.route_id === anchor.route_id &&
      String(p.direction_id) === String(anchor.direction_id) &&
      String(p.headsign || "") === String(anchor.headsign || "") &&
      (p.pattern_id || "") !== (anchor.pattern_id || ""),
  );
  duplicateVariantChoices.sort((a, b) =>
    String(a.variant_name || "").localeCompare(
      String(b.variant_name || ""),
      "fr",
    ),
  );
  duplicateTargetVariantSelectEl.innerHTML = "";
  duplicateVariantChoices.forEach((p, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${p.variant_name || "Variante"} — ${p.stop_count ?? "?"} arrêts`;
    duplicateTargetVariantSelectEl.appendChild(opt);
  });
}

function getDeviationLabelForUi(it) {
  function fmtDate(raw) {
    const t = String(raw || "").trim();
    if (!t) return "?";
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? formatIsoDateFrench(t) : t;
  }
  return (
    normalizeDeviationLabel(it?.label || "") ||
    `${it?.pattern_id || "Entrée"} (${fmtDate(it?.valid_from)} -> ${fmtDate(it?.valid_to)})`
  );
}

function getDeviationVariantTag(patternId) {
  const pat = data?.patterns?.find(
    (p) => String(p.pattern_id || "") === String(patternId || ""),
  );
  if (!pat) return "";
  return formatVariantLabelForDeviation(pat);
}

function sortSavedDeviationsForUi(items) {
  const arr = [...items];
  arr.sort((a, b) => {
    const la = String(getDeviationLabelForUi(a) || "");
    const lb = String(getDeviationLabelForUi(b) || "");
    const c = la.localeCompare(lb, "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (c !== 0) return c;
    const va = String(getDeviationVariantTag(a.pattern_id) || "");
    const vb = String(getDeviationVariantTag(b.pattern_id) || "");
    return va.localeCompare(vb, "fr", { numeric: true });
  });
  return arr;
}

function rebuildDuplicateFromOptions() {
  if (!duplicateFromDeviationSelectEl) return;
  const st = readDeviationStore();
  const sorted = sortSavedDeviationsForUi(
    filterSavedDeviationsForCurrentMission(st.items),
  );
  duplicateFromDeviationSelectEl.innerHTML = "";
  for (const it of sorted) {
    const opt = document.createElement("option");
    opt.value = it.id;
    const vt = getDeviationVariantTag(it.pattern_id);
    opt.textContent = vt
      ? `${getDeviationLabelForUi(it)} — ${vt}`
      : getDeviationLabelForUi(it);
    duplicateFromDeviationSelectEl.appendChild(opt);
  }
  const selected = getSelectedDeviationItem();
  if (selected) {
    duplicateFromDeviationSelectEl.value = selected.id;
  }
}

function refreshDuplicateTargetsForSelectedSource() {
  if (!duplicateFromDeviationSelectEl?.value) {
    rebuildDuplicateVariantChoices(null);
    if (duplicateDeviationBtn) duplicateDeviationBtn.disabled = true;
    return;
  }
  const st = readDeviationStore();
  const src = st.items.find(
    (x) => x.id === duplicateFromDeviationSelectEl.value,
  );
  rebuildDuplicateVariantChoices(src?.pattern_id || null);
  const originId = String(src?.origin_deviation_id || src?.id || "");
  const remaining = duplicateVariantChoices.filter((pat) => {
    const existing = st.items.find(
      (it) =>
        String(it.pattern_id || "") === String(pat.pattern_id || "") &&
        String(it.origin_deviation_id || it.id || "") === originId,
    );
    return !existing;
  });
  duplicateVariantChoices = remaining;
  if (duplicateTargetVariantSelectEl) {
    duplicateTargetVariantSelectEl.innerHTML = "";
    if (!remaining.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Aucune variante restante à dupliquer";
      duplicateTargetVariantSelectEl.appendChild(opt);
    } else {
      remaining.forEach((p, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `${p.variant_name || "Variante"} — ${p.stop_count ?? "?"} arr. (${p.pattern_id})`;
        duplicateTargetVariantSelectEl.appendChild(opt);
      });
    }
  }
  if (duplicateDeviationBtn) duplicateDeviationBtn.disabled = !remaining.length;
}

/**
 * Affiche une date ISO `YYYY-MM-DD` en ordre français JJ/MM/AAAA (ex. 05/05/2026).
 * Sans mois en toutes lettres ; les entrées `<input type="date">` restent en ISO en interne.
 */
function formatIsoDateFrench(iso) {
  const s = String(iso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || "";
  const [y, m, d] = s.split("-");
  if (
    !y ||
    !m ||
    !d ||
    Number.isNaN(Number(y)) ||
    Number.isNaN(Number(m)) ||
    Number.isNaN(Number(d))
  ) {
    return s;
  }
  return `${d}/${m}/${y}`;
}

function refreshRecapDeviationMeta() {
  const labelEl = document.getElementById("recapDeviationLabel");
  const periodEl = document.getElementById("recapDeviationPeriod");
  if (!labelEl || !periodEl) return;
  const it = getSelectedDeviationItem();
  const pidCur = String(currentPattern?.pattern_id || "");
  if (!it) {
    labelEl.textContent = "—";
    periodEl.textContent =
      "Aucune entrée sélectionnée dans « Déviations enregistrées ».";
    return;
  }
  if (String(it.pattern_id || "") !== pidCur) {
    labelEl.textContent =
      normalizeDeviationLabel(it.label || "") ||
      String(it.pattern_id || "") ||
      "—";
    periodEl.textContent =
      "La fiche sélectionnée concerne une autre variante que la mission affichée — chargez-la ou changez la sélection.";
    return;
  }
  labelEl.textContent =
    normalizeDeviationLabel(it.label || "") ||
    String(it.pattern_id || "") ||
    "—";
  const vf = String(it.valid_from || "").trim();
  const vt = String(it.valid_to || "").trim();
  if (!vf && !vt) {
    periodEl.textContent =
      "Période non renseignée sur cette fiche (dates optionnelles).";
    return;
  }
  const df = formatIsoDateFrench(vf);
  const dt = formatIsoDateFrench(vt);
  if (vf && vt) {
    periodEl.textContent = `Du ${df} au ${dt}`;
  } else if (vf) {
    periodEl.textContent = `À partir du ${df}`;
  } else {
    periodEl.textContent = `Jusqu’au ${dt}`;
  }
}

/** Libellé + dates du formulaire alignés sur l’entrée sélectionnée (pas de dates résiduelles en changeant de variante). */
function syncDeviationEditorFieldsFromSelectedItem(item) {
  if (!savedDeviationValidFromEl || !savedDeviationValidToEl) {
    return;
  }
  if (!item) {
    savedDeviationValidFromEl.value = "";
    savedDeviationValidToEl.value = "";
    return;
  }
  const vf = String(item.valid_from || "").trim();
  const vt = String(item.valid_to || "").trim();
  savedDeviationValidFromEl.value = /^\d{4}-\d{2}-\d{2}$/.test(vf) ? vf : "";
  savedDeviationValidToEl.value = /^\d{4}-\d{2}-\d{2}$/.test(vt) ? vt : "";
}

function refreshSavedDeviationBannerAndDup(item) {
  syncDeviationEditorFieldsFromSelectedItem(item);
  if (savedDeviationStaleNoteEl) {
    savedDeviationStaleNoteEl.hidden = true;
    savedDeviationStaleNoteEl.textContent = "";
  }
  if (!item) {
    if (duplicateTargetVariantSelectEl) {
      duplicateTargetVariantSelectEl.innerHTML = "";
    }
    duplicateVariantChoices = [];
    refreshRecapDeviationMeta();
    return;
  }
  if (!savedDeviationStaleNoteEl) {
    refreshRecapDeviationMeta();
    return;
  }
  const anchor = data.patterns.find(
    (p) => (p.pattern_id || "") === item.pattern_id,
  );

  if (duplicateFromDeviationSelectEl) {
    duplicateFromDeviationSelectEl.value = item.id || "";
  }
  refreshDuplicateTargetsForSelectedSource();

  const warns = [];

  const dNow = String(datasetDigestLoaded || "");
  const dSaved = String(item.dataset_digest_snapshot || "");
  if (dSaved && dNow && dSaved !== dNow) {
    warns.push(
      "Le jeu de données GTFS / JSON chargé diffère du build sous lequel cet enregistrement a été sauvegardé — revérifier la déviation.",
    );
  }

  const sSaved = String(item.pattern_signature_snapshot || "");
  const sCur = anchor ? getPatternDigest(anchor) : "";
  if (
    sSaved &&
    sCur &&
    sSaved !== "legacy_missing" &&
    sCur !== "legacy_missing" &&
    sSaved !== sCur
  ) {
    warns.push(
      "La mission de référence (liste d’arrêts ou sens) semble avoir changé pour ce pattern — revérifier la déviation.",
    );
  }

  const today =
    typeof new Date().toISOString === "function"
      ? new Date().toISOString().slice(0, 10)
      : "";

  function hasRange() {
    return Boolean(item.valid_from || item.valid_to);
  }

  if (today && hasRange()) {
    if (item.valid_from && String(today) < String(item.valid_from)) {
      warns.push(
        `Période de validité : pas encore en vigueur (début le ${formatIsoDateFrench(item.valid_from)}).`,
      );
    }
    if (item.valid_to && String(today) > String(item.valid_to)) {
      warns.push(
        `Période de validité : peut-être hors plage affichée (fin le ${formatIsoDateFrench(item.valid_to)}).`,
      );
    }
  }

  if (warns.length) {
    savedDeviationStaleNoteEl.hidden = false;
    savedDeviationStaleNoteEl.textContent = warns.join(" ");
  }
  refreshRecapDeviationMeta();
}

/** Replacer la sélection du `<select>` sur une entrée du stockage après rebuild (ex. changement de ligne). */
function savedDeviationEnsureOptionSelectedForItemId(deviationItemId) {
  if (!savedDeviationSelectEl || !deviationItemId) return false;
  const id = String(deviationItemId);
  for (let i = 0; i < savedDeviationSelectEl.options.length; i++) {
    const oid = savedDeviationSelectEl.options[i]?.dataset?.deviationId;
    if (String(oid || "") === id) {
      savedDeviationSelectEl.selectedIndex = i;
      rebuildDuplicateFromOptions();
      return true;
    }
  }
  return false;
}

function refreshSavedDeviationSelectOptions() {
  if (!savedDeviationSelectEl) return;
  const prevSelectedId =
    savedDeviationSelectEl.selectedOptions?.[0]?.dataset?.deviationId || "";
  const st = readDeviationStore();
  savedDeviationSelectEl.innerHTML = "";
  const sorted = sortSavedDeviationsForUi(
    filterSavedDeviationsForCurrentMission(st.items),
  );
  sorted.forEach((it) => {
    const lab =
      normalizeDeviationLabel(it.label || "") ||
      String(it.pattern_id || "") ||
      "sans nom";
    const tag =
      datasetDigestLoaded &&
      it.dataset_digest_snapshot &&
      datasetDigestLoaded !== it.dataset_digest_snapshot
        ? " [jeu données ≠]"
        : "";
    const vt = getDeviationVariantTag(it.pattern_id);
    const opt = document.createElement("option");
    opt.value = String(it.id);
    opt.dataset.deviationId = it.id;
    opt.textContent = `${lab}${tag}`;
    savedDeviationSelectEl.appendChild(opt);
  });
  if (!sorted.length) {
    rebuildDuplicateVariantChoices(null);
    refreshSavedDeviationBannerAndDup(null);
    rebuildDuplicateFromOptions();
    return;
  }
  let pickIdx = 0;
  if (prevSelectedId) {
    const j = sorted.findIndex(
      (it) => String(it.id || "") === String(prevSelectedId),
    );
    if (j >= 0) pickIdx = j;
  }
  savedDeviationSelectEl.selectedIndex = pickIdx;
  refreshSavedDeviationBannerAndDup(sorted[pickIdx]);
  rebuildDuplicateFromOptions();
}

/** Entrée sélectionnée dans la liste (`storeCtx` = même objet que celui passé à writeDeviationStore après mutation). */
function getSelectedDeviationItem(storeCtx) {
  if (!savedDeviationSelectEl?.selectedOptions?.length) {
    return null;
  }
  const id =
    savedDeviationSelectEl.selectedOptions[0]?.dataset?.deviationId || "";
  const st = storeCtx || readDeviationStore();
  return st.items.find((i) => String(i.id) === String(id)) || null;
}

/**
 * Réécrit le payload de l'entrée sélectionnée si elle correspond à la mission courante (sans second clic « MàJ des dates… »).
 * Retourne true si une écriture locale a été effectuée.
 */
function autoUpdateSelectedDeviationPayloadIfPossible(reasonShort) {
  const p = selectedPattern();
  if (!p) return false;
  ensureOpsTargetPattern();
  const pl = deviationPayloadFromLiveState();
  const st = readDeviationStore();
  const cur = getSelectedDeviationItem(st);
  if (!cur) return false;
  if (String(cur.pattern_id || "") !== String(p.pattern_id || "")) {
    return false;
  }
  const nowIso = new Date().toISOString();
  stampDeviationItemPayloadMeta(cur, p, nowIso);
  cur.payload = pl;
  writeDeviationStore(st);
  refreshSavedDeviationSelectOptions();
  savedDeviationEnsureOptionSelectedForItemId(cur.id);
  refreshSavedDeviationBannerAndDup(cur);
  appendOpsLog("deviation_auto_updated", `${cur.id}|${reasonShort || ""}`);
  syncPlannedSaveBaselineFromLive();
  liveDeviationLoadedItemId = String(cur.id || "");
  return true;
}

async function restoreDeviationPayloadIntoLiveState(pl) {
  opsState.manualStopOverrides = tamCloneSerializable(
    {},
    pl.manualStopOverrides,
  );
  opsState.provisionalStops = tamCloneSerializable([], pl.provisionalStops);
  const mpIn = pl.manualProfile;
  opsState.manualProfile = null;
  if (mpIn && typeof mpIn === "object") {
    const mp = {
      startDistance: mpIn.startDistance,
      endDistance: mpIn.endDistance,
      detourCoords: tamMapLatLngPairs(mpIn.detourCoords),
      bypassedCoords: tamMapLatLngPairs(mpIn.bypassedCoords),
      mergedCoords: tamMapLatLngPairs(mpIn.mergedCoords),
    };
    if (Array.isArray(mpIn.baseBypassRanges) && mpIn.baseBypassRanges.length) {
      mp.baseBypassRanges = mpIn.baseBypassRanges.map((pair) => [
        Number(pair[0]),
        Number(pair[1]),
      ]);
    } else {
      mp.baseBypassRanges = normalizeBypassRangesOnBase(mp);
    }
    if (
      Array.isArray(mpIn.detourVisualChain) &&
      mpIn.detourVisualChain.length
    ) {
      mp.detourVisualChain = mpIn.detourVisualChain.map(
        normalizeDeviationChainSegmentFromStored,
      );
    } else if (Array.isArray(mp.detourCoords) && mp.detourCoords.length >= 2) {
      mp.detourVisualChain = [
        normalizeDeviationChainSegmentFromStored({
          detourCoords: mp.detourCoords,
          bypassedCoords: mp.bypassedCoords,
        }),
      ];
    }
    opsState.manualProfile = mp;
    fillMissingManualSegmentBaseAnchors(opsState.manualProfile);
  }
  const merged = pl.mergedCoordsManual;
  opsState.modeCoordinates.MANUEL_ACTIF = null;
  opsState.manualActive = false;
  if (Array.isArray(merged) && merged.length >= 2) {
    opsState.modeCoordinates.MANUEL_ACTIF = merged.map((xy) => [
      Number(xy[0]),
      Number(xy[1]),
    ]);
    opsState.manualActive = true;
    await applyTraceForOpsMode(OPS_MODE.MANUEL, { centerCamera: false });
    fillMissingManualSegmentBaseAnchors(opsState.manualProfile);
  } else {
    opsState.manualProfile = null;
    opsState.manualActive = false;
    await applyTraceForOpsMode(OPS_MODE.BASE, { centerCamera: false });
  }
  opsState.nonServedEditActive = false;
  opsState.provisionalEditActive = false;
  nonServedEditFocusStopId = null;
  stopManualDrawMode();
  refreshMissionStopVisualsAndStats();
  resyncVoixForPosition(distanceAlongPathMeters);
  refreshManualDrawUi();
  refreshProvisionalUi();
  applyOpsStateUi();
  plannedDeviationEditSnapshot = null;
}

async function loadDeviationItemIntoApp(item, opts) {
  const o = opts || {};
  tryDismissTemporaryDeviationIfUnchanged("pre_load_deviation");
  tryDismissPlannedDeviationIfUnchanged("pre_load_deviation");
  if (opsState.temporaryDeviationActive && snapshotBeforeTemporary) {
    window.alert(
      "Quittez la déviation temporaire (bouton « Rétablir le mode exploitation du début de mission ») avant de charger une déviation enregistrée.",
    );
    return false;
  }
  if (!item || !item.pattern_id) {
    window.alert("Aucune entrée sélectionnée.");
    return false;
  }
  const pat = data?.patterns?.find(
    (p) => (p.pattern_id || "") === item.pattern_id,
  );
  if (!pat) {
    window.alert("Mission inconnue : pattern_id absent du JSON chargé.");
    return false;
  }
  if (!selectMissionSelectorsForPattern(pat)) {
    window.alert("Impossible de positionner automatiquement la mission.");
    return false;
  }
  deviationIdsSavedDuringTemporarySession = [];
  deferPlannedSaveUntilEditedAfterTempRecorded = false;
  savedDeviationEnsureOptionSelectedForItemId(item.id);
  running = false;
  lastRafTime = 0;
  stopGpsTracking();
  previewOnlyMode = false;
  await setMission(pat, {
    previewOnly: false,
    forceOpsReset: !!o.forceOpsReset,
    skipPlannedBaselineSync: true,
  });
  await restoreDeviationPayloadIntoLiveState(item.payload || {});
  /* Point de rétablissement (= cette fiche sur la carte, pour Rétablir sous Temporaire). */
  snapshotBeforeTemporary = buildTemporaryRevertSnapshotFromMissionPattern(pat);
  refreshSavedDeviationBannerAndDup(item);
  appendOpsLog("deviation_loaded", item.pattern_id || "");
  syncPlannedSaveBaselineFromLive();
  if (driveMode === DRIVE_MODE.SIMULATION) {
    previewOnlyMode = false;
    stopGpsTracking();
    lastRafTime = 0;
    running = true;
    refreshDriveModeUi();
    setGpsStatus("Déviation chargée : simulation démarrée.");
  }
  mapMissionHudSessionActive = true;
  showMapMissionHud();
  liveDeviationLoadedItemId = String(item.id || "");
  return true;
}

/** JSON stable pour comparer deux payloads (sessions temporaire / planifiée). */
function deviationPayloadJsonForCompare(pl) {
  try {
    return JSON.stringify(tamCloneSerializable({}, pl || {}));
  } catch {
    return "";
  }
}

/** Réaligne la ligne de base du bouton « planifiée » sur l’état carte courant (chargement, sauvegarde, mission). */
function syncPlannedSaveBaselineFromLive() {
  plannedDeviationSaveBaselineJson = deviationPayloadJsonForCompare(
    deviationPayloadFromLiveState(),
  );
  refreshTemporaryDeviationUi();
}
/**
 * Si l’état carte / surcharge est encore identique au snapshot de début de session temporaire,
 * fermer la session (évite « Rétablir… » alors que l’utilisateur n’a fait qu’annuler un brouillon).
 */
function tryDismissTemporaryDeviationIfUnchanged(tag) {
  if (!opsState.temporaryDeviationActive || !snapshotBeforeTemporary) {
    return false;
  }
  const cur = deviationPayloadFromLiveState();
  const base = snapshotBeforeTemporary.payload || {};
  if (
    deviationPayloadJsonForCompare(cur) !== deviationPayloadJsonForCompare(base)
  ) {
    return false;
  }
  opsState.temporaryDeviationActive = false;
  /* Conserver snapshotBeforeTemporary : c’est encore le bon point de rétablissement carte. */
  deviationIdsSavedDuringTemporarySession = [];
  refreshTemporaryDeviationUi();
  applyOpsStateUi();
  appendOpsLog("temporary_session_dismissed_untouched", String(tag || ""));
  return true;
}

/**
 * Si l’état est encore identique au snapshot avant « Tracer » (onglet Planifiée, sans session Temporaire),
 * libère le snapshot (même intention que fermer une session sans changement réel).
 */
function tryDismissPlannedDeviationIfUnchanged(tag) {
  if (!plannedDeviationEditSnapshot) {
    return false;
  }
  if (opsState.temporaryDeviationActive) {
    return false;
  }
  const p = selectedPattern() || currentPattern;
  if (
    !p ||
    String(p.pattern_id || "") !==
      String(plannedDeviationEditSnapshot.pattern_id || "")
  ) {
    plannedDeviationEditSnapshot = null;
    appendOpsLog(
      "planned_trace_snapshot_cleared_mismatch_pattern",
      String(tag || ""),
    );
    return false;
  }
  const cur = deviationPayloadFromLiveState();
  const base = plannedDeviationEditSnapshot.payload || {};
  if (
    deviationPayloadJsonForCompare(cur) !== deviationPayloadJsonForCompare(base)
  ) {
    return false;
  }
  plannedDeviationEditSnapshot = null;
  appendOpsLog("planned_trace_snapshot_dismissed_untouched", String(tag || ""));
  return true;
}

function activateTemporaryDeviationMode() {
  if (opsState.temporaryDeviationActive) return;
  if (manualDrawActive && manualDraftPoints.length > 0) {
    window.alert(
      "Terminez ou annulez la saisie du tracé de la déviation planifiée avant d’ouvrir une session de déviation temporaire.",
    );
    return;
  }
  const p = selectedPattern() || currentPattern;
  if (!p) {
    window.alert("Choisissez une mission d'abord.");
    return;
  }
  ensureOpsTargetPattern();
  plannedDeviationEditSnapshot = null;
  snapshotBeforeTemporary = buildTemporaryRevertSnapshotFromMissionPattern(p);
  opsState.temporaryDeviationActive = true;
  refreshTemporaryDeviationUi();
  appendOpsLog(
    "temporary_deviation_on",
    `pattern=${snapshotBeforeTemporary.pattern_id}`,
  );
  setGpsStatus(
    "Session déviation temporaire : adaptez tracé et arrêts, puis utilisez « Enregistrer la déviation temporaire » pour garder une fiche en local ou « Rétablir le mode exploitation du début de mission » pour annuler avant enregistrement.",
  );
}

function commitTemporaryDeviationMode(opts) {
  const o = opts || {};
  if (!opsState.temporaryDeviationActive) return;
  /* conserve snapshotBeforeTemporary : « Rétablir » peut ramener carte + éviter les faux enregistrements locaux encore listés après sauvegarde */
  opsState.temporaryDeviationActive = false;
  plannedDeviationEditSnapshot = null;
  opsState.mode = recomputeOpsMode();
  opsState.initialMode = opsState.mode;
  opsState.returnMode = opsState.mode;
  applyOpsStateUi();
  syncPlannedSaveBaselineFromLive();
  appendOpsLog("temporary_deviation_commit", `mode=${opsState.mode}`);
  setGpsStatus(
    typeof o.statusMessage === "string" && o.statusMessage
      ? o.statusMessage
      : "Session déviation temporaire fermée : état conservé sur la carte.",
  );
}

async function restoreTemporaryMissionSnapshot() {
  const snap = snapshotBeforeTemporary;
  if (!snap || !snap.pattern_id) return;
  const pat = data?.patterns?.find(
    (x) => String(x.pattern_id || "") === String(snap.pattern_id || ""),
  );
  if (!pat) {
    window.alert("Mission du snapshot introuvable dans les données chargées.");
    return;
  }
  restoringTemporarySnapshot = true;
  try {
    if (!selectMissionSelectorsForPattern(pat)) {
      window.alert("Impossible de repositionner les sélecteurs de mission.");
      return;
    }
    running = false;
    lastRafTime = 0;
    stopGpsTracking();
    previewOnlyMode = false;
    await setMission(pat, {
      previewOnly: false,
      forceOpsReset: true,
      preserveTemporarySnapshot: true,
      skipPlannedBaselineSync: true,
    });
    await restoreDeviationPayloadIntoLiveState(snap.payload || {});
    opsState.returnMode = coerceOpsMode(snap.returnMode || OPS_MODE.BASE);
    opsState.initialMode = coerceOpsMode(snap.initialMode || OPS_MODE.BASE);
    opsState.temporaryDeviationActive = false;
    plannedDeviationEditSnapshot = null;
    /* Pas de bouton Planifiée bleu tant qu’aucun geste prévu sous Planifiée après ce retour carte. */
    deferPlannedSaveUntilEditedAfterTempRecorded = true;
    applyOpsStateUi();
    snapshotBeforeTemporary =
      buildTemporaryRevertSnapshotFromMissionPattern(pat);
    refreshMissionStopVisualsAndStats();
    syncPlannedSaveBaselineFromLive();
    appendOpsLog(
      "return_initial",
      "Restauration état avant déviation temporaire",
    );
    setGpsStatus("Mode d'exploitation rétabli (avant déviation temporaire).");
  } finally {
    restoringTemporarySnapshot = false;
    refreshTemporaryDeviationUi();
  }
}

async function deviationSaveOrUpdate(kind, opts) {
  if (deviationSaveOrUpdate._inFlight) {
    return null;
  }
  deviationSaveOrUpdate._inFlight = true;
  try {
    const o = opts || {};
    const p = selectedPattern();
    if (!p) {
      window.alert(
        "Choisissez une ligne (terminus et variante) puis la déviation avant d'enregistrer.",
      );
      return null;
    }
    if (
      opsState.temporaryDeviationActive &&
      !(o.allowDuringTemporaryDevSession && kind === "new")
    ) {
      window.alert(
        "Une déviation temporaire est en cours : utilisez « Enregistrer la déviation temporaire » ou « Rétablir » depuis le sous-onglet Temporaire avant d’enregistrer une déviation planifiée.",
      );
      return null;
    }
    ensureOpsTargetPattern();
    const plLive = deviationPayloadFromLiveState();
    const nowIso = new Date().toISOString();
    const st = readDeviationStore();
    const vf = savedDeviationValidFromEl?.value || "";
    const vt = savedDeviationValidToEl?.value || "";
    if (vf && vt && String(vf) > String(vt)) {
      window.alert("La date de fin doit être après la date de début.");
      return null;
    }
    if (kind === "update") {
      const cur = getSelectedDeviationItem(st);
      if (!cur) {
        window.alert("Sélectionnez une entrée à mettre à jour.");
        return null;
      }
      if (!o.allowDuringTemporaryDevSession) {
        const loaded =
          liveDeviationLoadedItemId != null
            ? String(liveDeviationLoadedItemId)
            : "";
        if (String(cur.id || "") !== loaded) {
          window.alert(
            "Pour mettre à jour cette entrée, chargez-la d’abord sur la carte avec « Charger la sélection » — sinon vous risquez d’écraser une fiche alors que l’affichage ne correspond pas.",
          );
          return null;
        }
      }
      const storedPayloadRaw =
        cur.payload && typeof cur.payload === "object" ? cur.payload : {};
      const patternMismatch =
        String(cur.pattern_id || "") !== String(p.pattern_id || "");
      const liveEmpty = deviationPayloadIsEmpty(plLive);
      const storedNonempty = !deviationPayloadIsEmpty(storedPayloadRaw);
      /** Dates / métadonnées locales uniquement : rien en session carte, payload conservé en stock. */
      const datesOnlyDifferentVariantOk =
        patternMismatch && liveEmpty && storedNonempty;

      let pl = plLive;
      if (liveEmpty) {
        if (storedNonempty) {
          pl = tamCloneSerializable(
            {
              manualProfile: null,
              mergedCoordsManual: null,
              manualStopOverrides: {},
              provisionalStops: [],
            },
            storedPayloadRaw,
          );
        } else {
          window.alert(
            "Rien à enregistrer : aucun tracé de déviation planifiée, aucun arrêt marqué non desservi, aucun arrêt provisoire.",
          );
          return null;
        }
      }

      if (patternMismatch && !datesOnlyDifferentVariantOk) {
        window.alert(
          "L’entrée sélectionnée ne correspond pas à la ligne affichée (ligne / sens / variante). Utilisez « Charger la sélection » ou repositionnez les sélecteurs.",
        );
        return null;
      }

      if (datesOnlyDifferentVariantOk) {
        cur.valid_from = vf || "";
        cur.valid_to = vt || "";
        cur.updated_at = nowIso;
        cur.payload = pl;
      } else {
        stampDeviationItemPayloadMeta(cur, p, nowIso);
        cur.valid_from = vf || "";
        cur.valid_to = vt || "";
        cur.payload = pl;
      }
      writeDeviationStore(st);
      refreshSavedDeviationSelectOptions();
      selectSavedDeviationSelectOptionByDeviationId(cur.id);
      refreshSavedDeviationBannerAndDup(cur);
      appendOpsLog("deviation_updated", cur.id);
      setGpsStatus(
        "Entrée sélectionnée mise à jour (stockage local) : dates et, le cas échéant, état planifié sauvegardés.",
      );
      if (!o.allowDuringTemporaryDevSession) {
        syncPlannedSaveBaselineFromLive();
      }
      liveDeviationLoadedItemId = String(cur.id || "");
      return cur.id;
    }
    if (deviationPayloadIsEmpty(plLive)) {
      window.alert(
        "Rien à enregistrer : aucun tracé de déviation planifiée, aucun arrêt marqué non desservi, aucun arrêt provisoire.",
      );
      return null;
    }
    const idNew = generateLocalDeviationRecordId();
    const rowNew = {
      id: idNew,
      created_at: nowIso,
      label: opsState.temporaryDeviationActive
        ? buildTemporaryDeviationDefaultLabel(p)
        : buildAutoDeviationLabel(p),
      origin_deviation_id: idNew,
      valid_from: vf || "",
      valid_to: vt || "",
      payload: plLive,
    };
    stampDeviationItemPayloadMeta(rowNew, p, nowIso);
    st.items.push(rowNew);
    writeDeviationStore(st);
    refreshSavedDeviationSelectOptions();
    selectSavedDeviationSelectOptionByDeviationId(idNew);
    refreshSavedDeviationBannerAndDup(getSelectedDeviationItem());
    appendOpsLog("deviation_saved", idNew);
    setGpsStatus("Déviation enregistrée en local.");
    if (!o.allowDuringTemporaryDevSession) {
      syncPlannedSaveBaselineFromLive();
    }
    liveDeviationLoadedItemId = String(idNew || "");
    return idNew;
  } finally {
    deviationSaveOrUpdate._inFlight = false;
  }
}

/**
 * « Enregistrer la déviation planifiée » : mise à jour seulement si la carte reflète la fiche
 * chargée (`liveDeviationLoadedItemId`). Sinon création — **interdite** s’il existe déjà une fiche
 * pour ce même `pattern_id` (pas de doublon depuis une ligne « vierge » sans charger la fiche).
 */
function deviationSaveOrUpdatePlannedFromToolbar() {
  const cur = getSelectedDeviationItem();
  const p = selectedPattern();
  if (!p) {
    window.alert(
      "Choisissez une ligne (terminus et variante) avant d’enregistrer.",
    );
    return null;
  }
  const sameMission = Boolean(
    cur && String(cur.pattern_id || "") === String(p.pattern_id || ""),
  );
  const selId = cur ? String(cur.id || "") : "";
  const loadedId =
    liveDeviationLoadedItemId != null ? String(liveDeviationLoadedItemId) : "";
  const mapMatchesSelection = sameMission && selId !== "" && selId === loadedId;

  const useUpdate = mapMatchesSelection;

  if (!useUpdate) {
    const st = readDeviationStore();
    const existingSamePattern = st.items.some(
      (it) => String(it.pattern_id || "") === String(p.pattern_id || ""),
    );
    if (existingSamePattern) {
      showAppMessageDialog(
        "Simulateur SAE TAM",
        "Enregistrement impossible : une déviation est déjà enregistrée pour cette ligne, ce sens et cette variante.\n\n" +
          "Allez sur « Déviation », puis « Enregistrée / Dupliquée » : sélectionnez la déviation dans la liste « Déviations enregistrées », " +
          "puis cliquez sur « Charger la sélection ».\n\n" +
          "Repassez sous le sous-onglet « Planifiée », puis répétez l’opération selon vos besoins " +
          "(ex. « Saisir arrêts provisoires », « Saisir arrêt non desservi », tracer la déviation), avant d’enregistrer.",
      );
      return null;
    }
  }

  return deviationSaveOrUpdate(useUpdate ? "update" : "new");
}

async function deviationDeleteSelected() {
  const cur = getSelectedDeviationItem();
  if (!cur) {
    window.alert("Rien à supprimer.");
    return;
  }
  if (
    !window.confirm(
      `Supprimer l'enregistrement « ${cur.label || cur.pattern_id} » ?`,
    )
  ) {
    return;
  }
  const st = readDeviationStore();
  st.items = st.items.filter((x) => x.id !== cur.id);
  writeDeviationStore(st);
  if (
    liveDeviationLoadedItemId != null &&
    String(cur.id) === String(liveDeviationLoadedItemId)
  ) {
    clearLiveDeviationLoadedSource();
  }
  refreshSavedDeviationSelectOptions();
  appendOpsLog("deviation_deleted", cur.id);
  setGpsStatus("Enregistrement supprimé.");
}

function deviationDuplicateSelectionToVariant() {
  const st = readDeviationStore();
  const srcId = duplicateFromDeviationSelectEl?.value || "";
  const cur = st.items.find((x) => x.id === srcId) || null;
  const vi = duplicateTargetVariantSelectEl
    ? Number(duplicateTargetVariantSelectEl.value)
    : NaN;
  const targetPat = duplicateVariantChoices[Number.isFinite(vi) ? vi : -1];
  if (!cur || !targetPat) {
    window.alert("Sélectionnez un enregistrement et une variante cible.");
    return;
  }
  const nowIso = new Date().toISOString();
  const idDup = generateLocalDeviationRecordId();
  const rowDup = {
    id: idDup,
    created_at: nowIso,
    label: duplicateDeviationLabelForVariant(cur, targetPat),
    origin_deviation_id: String(cur.origin_deviation_id || cur.id || ""),
    valid_from: cur.valid_from || "",
    valid_to: cur.valid_to || "",
    payload: tamCloneSerializable({}, cur.payload),
  };
  stampDeviationItemPayloadMeta(rowDup, targetPat, nowIso);
  st.items.push(rowDup);
  writeDeviationStore(st);
  refreshSavedDeviationSelectOptions();
  selectSavedDeviationSelectOptionByDeviationId(idDup);
  refreshSavedDeviationBannerAndDup(getSelectedDeviationItem());
  appendOpsLog("deviation_duplicated", idDup);
  setGpsStatus("Copie locale créée vers une autre variante.");
}
