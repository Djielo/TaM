/**
 * Repères personnels : description structurée (vitesses, INDES, INDIR) et noms enregistrés.
 * Chargé avant simulateur_sae_1_state_mission.js
 */
(function () {
  "use strict";

  const LS_KEY = "tam_plm_structured_text_config_v1";
  const DEFAULT_LINE_NUMS = ["1", "2", "3", "4", "5"];
  const DEFAULT_INDEXES = ["MA", "OB", "RO", "PL", "SA", "LB", "H4"];

  /**
   * Catalogue CMR par ligne — uniquement les 16 libellés déjà présents dans
   * tam_plm_structured_text_config_v1 (aucun renommage). Classement selon votre
   * liste orale lignes 3 / 4 / 5.
   */
  const PLM_LINE_CMR_SEED = {
    1: [],
    2: [],
    3: [
      "CMR Pilory",
      "CMR Jules Guesde",
      "CMR République",
      "CMR Pont de Lattes Carnot",
      "CMR Port Marianne",
      "CMR Pablo Picasso",
    ],
    4: [
      "CMR Garcia Lorca",
      "CMR Pont de Sète",
      "CMR République",
      "CMR Henri IV",
      "CMR Pompignane",
      "CMR Georges Frêche HDV",
    ],
    5: [
      "CMR CNRS",
      "CMR Saint-Éloi Pezet",
      "CMR Henri IV",
      "CMR Clémenceau",
      "CMR Le Pic",
      "CMR Ovalie",
    ],
  };

  const DEFAULT_CONFIG = {
    lineSpeeds: {
      1: ["5", "10", "15", "40"],
      2: ["5", "10", "15", "40"],
      3: ["5", "10", "15", "40"],
      4: ["5", "10", "15", "40"],
      5: ["5", "10", "15", "40"],
    },
    lineIndexes: {
      1: [...DEFAULT_INDEXES],
      2: [...DEFAULT_INDEXES],
      3: [...DEFAULT_INDEXES],
      4: [...DEFAULT_INDEXES],
      5: [...DEFAULT_INDEXES],
    },
    /** Lignes INDIR : libellés libres par numéro (1, 2, 4B, …), vide au départ. */
    lineIndir: {},
    /** CMR / CMU par ligne (onglet CMR, exclusif avec le titre standard). */
    lineCmr: PLM_LINE_CMR_SEED,
    zones: ["Gare", "Moularès"],
    namePresets: [],
  };

  function cloneDefaults() {
    return {
      lineSpeeds: Object.fromEntries(
        DEFAULT_LINE_NUMS.map((n) => [
          n,
          [...(DEFAULT_CONFIG.lineSpeeds[n] || [])],
        ]),
      ),
      lineIndexes: Object.fromEntries(
        DEFAULT_LINE_NUMS.map((n) => [n, [...DEFAULT_CONFIG.lineIndexes[n]]]),
      ),
      lineIndir: {},
      lineCmr: Object.fromEntries(
        Object.keys(PLM_LINE_CMR_SEED).map((n) => [
          n,
          [...(PLM_LINE_CMR_SEED[n] || [])],
        ]),
      ),
      zones: [...DEFAULT_CONFIG.zones],
      namePresets: [],
    };
  }

  const PLM_CMR_CNRS = "CMR CNRS";
  const PLM_CMR_SAINT_ELOI = "CMR Saint-Éloi Pezet";

  /** CMR CNRS : ligne 5, immédiatement avant Saint-Éloi Pezet (plus dans « Autres »). */
  function migrateCnrsOnLine5(lineCmr) {
    if (!lineCmr || typeof lineCmr !== "object") return false;
    let changed = false;
    for (const key of Object.keys(lineCmr)) {
      if (key === "5") continue;
      const list = lineCmr[key];
      if (!Array.isArray(list) || !list.includes(PLM_CMR_CNRS)) continue;
      lineCmr[key] = list.filter((x) => x !== PLM_CMR_CNRS);
      changed = true;
      if (key === "other" && lineCmr.other.length === 0) delete lineCmr.other;
    }
    if (!lineCmr["5"]) lineCmr["5"] = [];
    let l5 = lineCmr["5"].filter((x) => x !== PLM_CMR_CNRS);
    const pezetIdx = l5.indexOf(PLM_CMR_SAINT_ELOI);
    if (pezetIdx >= 0) l5.splice(pezetIdx, 0, PLM_CMR_CNRS);
    else l5.unshift(PLM_CMR_CNRS);
    if (JSON.stringify(lineCmr["5"]) !== JSON.stringify(l5)) {
      lineCmr["5"] = l5;
      changed = true;
    }
    return changed;
  }

  function dedupeLineCmrList(list) {
    const out = [];
    const seen = new Set();
    for (const z of list) {
      const t = String(z).trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  function migrateCmrPresetsIntoLineCmr(base) {
    const { standard, cmr } = partitionNamePresets(base.namePresets || []);
    base.namePresets = standard;
    const lineCmr = base.lineCmr && typeof base.lineCmr === "object" ? base.lineCmr : {};
    const hasAny = getLineNums(lineCmr).some(
      (n) => (lineCmr[n] || []).length > 0,
    );
    if (!hasAny && cmr.length) {
      const n = getLineNums(lineCmr)[0] || "1";
      lineCmr[n] = dedupeLineCmrList(cmr);
      base.lineCmr = lineCmr;
    }
    return base;
  }

  function normalizeCode(raw) {
    return String(raw ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function normalizeIndirContent(raw) {
    return String(raw ?? "").trim();
  }

  /** Entre vitesses ou entre entrées « numéro : … » (ex. 1: 5 km/h, 2: CO, 1: LB). */
  const PLM_LIST_SEP = ", ";

  /** Entre plusieurs libellés INDIR sur une même ligne (ex. 2: D-G-TD). */
  const PLM_INDIR_MULTI_SEP = "-";

  /** Guillemets ajoutés à l’écriture seulement si le libellé contient une virgule structurelle. */
  function plmUserTokenNeedsQuoting(s) {
    const t = String(s ?? "").trim();
    if (!t) return false;
    return /[,;]/.test(t);
  }

  function plmQuoteUserToken(s) {
    const t = String(s ?? "").trim();
    if (!t) return "";
    if (!plmUserTokenNeedsQuoting(t)) return t;
    return `"${t.replace(/"/g, '""')}"`;
  }

  function plmUnquoteUserToken(bit) {
    const b = String(bit ?? "").trim();
    if (b.length >= 2 && b.startsWith('"') && b.endsWith('"')) {
      return b.slice(1, -1).replace(/""/g, '"');
    }
    if (b.length >= 2 && b.startsWith("'") && b.endsWith("'")) {
      return b.slice(1, -1).replace(/''/g, "'");
    }
    return b;
  }

  /**
   * Découpe la liste structurée (virgule + espace entre blocs), sans couper
   * à l’intérieur des guillemets ni des parenthèses.
   */
  function splitPlmStructuralList(raw) {
    const s = String(raw ?? "");
    if (!s.trim()) return [];
    const parts = [];
    let quote = null;
    let paren = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        if (c === quote && s[i + 1] === quote) {
          i++;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "(") paren++;
      else if (c === ")") paren = Math.max(0, paren - 1);
      else if (c === "," && paren === 0) {
        const bit = s.slice(start, i).trim();
        if (bit) parts.push(bit);
        start = i + 1;
      }
    }
    const tail = s.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
  }

  function joinPlmList(parts) {
    return (Array.isArray(parts) ? parts : [parts])
      .map((p) => String(p ?? "").trim())
      .filter(Boolean)
      .join(PLM_LIST_SEP);
  }

  function joinPlmIndirMulti(parts) {
    return (Array.isArray(parts) ? parts : [parts])
      .map((p) => String(p ?? "").trim())
      .filter(Boolean)
      .join(PLM_INDIR_MULTI_SEP);
  }

  function splitPlmIndirMulti(raw) {
    return String(raw ?? "")
      .split(PLM_INDIR_MULTI_SEP)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** Découpe en respectant les libellés connus (ex. « 10 m » et « 20 m » dans « 10 m-20 m »). */
  function splitPlmMultiByKnown(raw, known) {
    const s = String(raw ?? "").trim();
    if (!s) return [];
    const list = [...new Set((known || []).map(String).filter(Boolean))];
    if (!list.length) return splitPlmIndirMulti(s);
    const sorted = list.sort((a, b) => b.length - a.length);
    const parts = [];
    let rest = s;
    while (rest.length) {
      let matched = false;
      for (const k of sorted) {
        if (rest === k) {
          parts.push(k);
          rest = "";
          matched = true;
          break;
        }
        if (rest.startsWith(k + PLM_INDIR_MULTI_SEP)) {
          parts.push(k);
          rest = rest.slice(k.length + PLM_INDIR_MULTI_SEP.length);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const i = rest.indexOf(PLM_INDIR_MULTI_SEP);
        if (i === -1) {
          parts.push(rest.trim());
          break;
        }
        parts.push(rest.slice(0, i).trim());
        rest = rest.slice(i + 1);
      }
    }
    return parts.filter(Boolean);
  }

  function asPlmMultiArray(value) {
    if (value == null || value === "") return [];
    if (Array.isArray(value)) {
      return value.map((p) => String(p).trim()).filter(Boolean);
    }
    return splitPlmIndirMulti(String(value));
  }

  function asPlmSpeedArray(value) {
    if (value == null || value === "") return [];
    if (Array.isArray(value)) {
      return value.map((p) => normalizeSpeedLabel(p)).filter(Boolean);
    }
    const s = String(value).trim();
    if (!s) return [];
    if (/km\s*\/?\s*h/i.test(s) && s.includes(PLM_INDIR_MULTI_SEP)) {
      return splitPlmIndirMulti(s).map((p) => normalizeSpeedLabel(p)).filter(Boolean);
    }
    return splitPlmStructuralList(s)
      .map((p) => normalizeSpeedLabel(plmUnquoteUserToken(p)))
      .filter(Boolean);
  }

  function stripLegacyDescLinePrefix(line) {
    return String(line ?? "")
      .replace(/^V(?:ITESSE)?\s*:/i, "")
      .replace(/^L\s*:/i, "")
      .replace(/^INDES\s*:/i, "")
      .replace(/^INDIR(?:E)?\s*:/i, "")
      .trim();
  }

  /** Extrait numéro de ligne + valeur brute (INDES / INDIR). */
  function parsePlmLineSegmentRaw(bit) {
    const b = String(bit ?? "").trim();
    if (!b) return null;
    let m = b.match(/^(\d+[A-Za-z]?)\s*:\s*(.+)$/);
    if (!m) m = b.match(/^(\d+[A-Za-z]?)\s*-\s*(.+)$/);
    if (!m) return null;
    const num = normalizeLineNum(m[1]);
    const rawValue = plmUnquoteUserToken(String(m[2] ?? "").trim());
    return num && rawValue ? { num, rawValue } : null;
  }

  function resolveLineSegment(num, rawValue, config) {
    const val = plmUnquoteUserToken(String(rawValue ?? "").trim());
    const indirKnown = config?.lineIndir?.[num] || [];
    const indesKnown = config?.lineIndexes?.[num] || [];

    if (val.includes(PLM_INDIR_MULTI_SEP)) {
      return {
        kind: "indir",
        num,
        values: splitPlmMultiByKnown(val, indirKnown),
      };
    }

    const multiParts = splitPlmIndirMulti(val);
    if (multiParts.length > 1) {
      return {
        kind: "indir",
        num,
        values: splitPlmMultiByKnown(val, indirKnown),
      };
    }

    const code = normalizeCode(val);
    const inIndirCatalog = indirKnown.some(
      (k) => k === val || normalizeCode(k) === code,
    );
    if (inIndirCatalog && !indesKnown.includes(code)) {
      return { kind: "indir", num, values: [val] };
    }
    if (indesKnown.includes(code)) {
      return { kind: "indes", num, code };
    }
    if (/^[A-Za-z0-9]{1,8}$/.test(val.replace(/\s/g, "")) && val.length <= 8) {
      return { kind: "indes", num, code };
    }
    return { kind: "indir", num, values: [normalizeIndirContent(val)] };
  }

  function parseSpeedTokens(bit) {
    const b = plmUnquoteUserToken(String(bit ?? "").trim());
    if (!b || parsePlmLineSegmentRaw(b)) return [];
    if (/^(\d+[A-Za-z]?)\s*[:\-]/.test(b)) return [];
    if (/km\s*\/?\s*h/i.test(b) && b.includes(PLM_INDIR_MULTI_SEP)) {
      return splitPlmIndirMulti(b)
        .map((p) => normalizeSpeedLabel(plmUnquoteUserToken(p)))
        .filter(Boolean);
    }
    const one = normalizeSpeedLabel(b);
    return one ? [one] : [];
  }

  /** Valeur canonique enregistrée : « 5 km/h » (espace avant km/h). */
  function normalizeSpeedLabel(raw) {
    let t = String(raw ?? "").trim();
    if (!t) return "";
    if (/km\s*\/?\s*h/i.test(t)) {
      const m = t.match(/^(\d+(?:[.,]\d+)?)\s*km\s*\/?\s*h\s*$/i);
      if (m) return `${m[1].replace(",", ".")} km/h`;
      t = t
        .replace(/\s*km\s*\/?\s*h/gi, "")
        .trim()
        .replace(/(\d)\s+(?=km)/gi, "$1");
    }
    const num = t.match(/^(\d+(?:[.,]\d+)?)$/);
    if (num) return `${num[1].replace(",", ".")} km/h`;
    return t;
  }

  /** Affichage compact dans les cases (chiffre seul). */
  function plmSpeedChipLabel(speed) {
    const full = normalizeSpeedLabel(speed);
    const m = full.match(/^(\d+(?:\.\d+)?)\s+km\/h$/i);
    return m ? m[1] : full;
  }

  function plmSortSpeedLabels(a, b) {
    const na = parseFloat(plmSpeedChipLabel(a)) || 0;
    const nb = parseFloat(plmSpeedChipLabel(b)) || 0;
    if (na !== nb) return na - nb;
    return String(a).localeCompare(String(b), "fr", { sensitivity: "base" });
  }

  function isSpeedLabel(val) {
    const t = String(val ?? "").trim();
    return /km\s*\/?\s*h/i.test(t) || /^\d+(?:[.,]\d+)?\s*$/.test(t);
  }

  /** Corrige d’anciennes zones sans accent (ex. Moulares → Moularès). */
  function plmNormalizeZoneLabel(raw) {
    const t = String(raw ?? "").trim();
    if (t === "Moulares") return "Moularès";
    return t;
  }

  function sortAlpha(arr) {
    return [...arr].sort((a, b) =>
      String(a).localeCompare(String(b), "fr", { sensitivity: "base" }),
    );
  }

  /** Noms enregistrés : chiffres d’abord, puis ordre alphabétique. */
  function normalizeLineNum(raw) {
    const t = String(raw ?? "").trim();
    if (/^other$/i.test(t)) return "other";
    const n = t.toUpperCase();
    return /^\d+[A-Z]?$/.test(n) ? n : "";
  }

  function getLineNums(lineIndexes) {
    return Object.keys(lineIndexes || {})
      .filter((k) => normalizeLineNum(k))
      .sort((a, b) => {
        if (a === "other") return 1;
        if (b === "other") return -1;
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (na !== nb) return na - nb;
        return a.localeCompare(b);
      });
  }

  function sortNamePresets(arr) {
    return [...arr].sort((a, b) => {
      const na = String(a).trim();
      const nb = String(b).trim();
      const aLeadNum = /^[0-9]/.test(na);
      const bLeadNum = /^[0-9]/.test(nb);
      if (aLeadNum && !bLeadNum) return -1;
      if (!aLeadNum && bLeadNum) return 1;
      return na.localeCompare(nb, "fr", {
        sensitivity: "base",
        numeric: true,
      });
    });
  }

  /** Noms de type CMR / CMU (préfixe ou mention dans le libellé). */
  function isCmrStyleNamePreset(name) {
    return /CM[UR]/i.test(String(name ?? ""));
  }

  /** Lignes du catalogue où ce CMR est listé (1, 2, 3… — pas « Autres »). */
  function plmCmrCatalogLinesForName(name, cfg) {
    const t = String(name ?? "").trim();
    if (!t || !isCmrStyleNamePreset(t)) return [];
    const lineCmr = cfg?.lineCmr;
    if (!lineCmr || typeof lineCmr !== "object") return [];
    const lines = [];
    for (const key of Object.keys(lineCmr)) {
      const n = normalizeLineNum(key);
      if (!n || n === "other") continue;
      if (Array.isArray(lineCmr[key]) && lineCmr[key].includes(t)) {
        lines.push(n);
      }
    }
    return lines.sort(plmSortLineKeys);
  }

  function partitionNamePresets(arr) {
    const sorted = sortNamePresets(arr);
    const standard = [];
    const cmr = [];
    for (const preset of sorted) {
      if (isCmrStyleNamePreset(preset)) cmr.push(preset);
      else standard.push(preset);
    }
    return { standard, cmr };
  }

  function loadConfig() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return cloneDefaults();
      const p = JSON.parse(raw);
      const base = cloneDefaults();
      if (p.lineSpeeds && typeof p.lineSpeeds === "object") {
        const loadedSpeeds = {};
        for (const key of Object.keys(p.lineSpeeds)) {
          const n = normalizeLineNum(key);
          if (!n) continue;
          const list = p.lineSpeeds[key];
          loadedSpeeds[n] = Array.isArray(list)
            ? [
                ...new Set(list.map(normalizeSpeedLabel).filter(Boolean)),
              ].sort(plmSortSpeedLabels)
            : [];
        }
        base.lineSpeeds = loadedSpeeds;
      } else if (Array.isArray(p.speeds) && p.speeds.length) {
        const legacy = sortAlpha([
          ...new Set(p.speeds.map(normalizeSpeedLabel).filter(Boolean)),
        ]);
        for (const n of DEFAULT_LINE_NUMS) {
          base.lineSpeeds[n] = [...legacy];
        }
      }
      if (p.lineIndexes && typeof p.lineIndexes === "object") {
        const loaded = {};
        for (const key of Object.keys(p.lineIndexes)) {
          const n = normalizeLineNum(key);
          if (!n) continue;
          const list = p.lineIndexes[key];
          loaded[n] = Array.isArray(list)
            ? sortAlpha([
                ...new Set(list.map(normalizeCode).filter(Boolean)),
              ])
            : [];
        }
        base.lineIndexes = loaded;
      }
      if (p.lineIndir && typeof p.lineIndir === "object") {
        const loadedIndir = {};
        for (const key of Object.keys(p.lineIndir)) {
          const n = normalizeLineNum(key);
          if (!n) continue;
          const list = p.lineIndir[key];
          loadedIndir[n] = Array.isArray(list)
            ? [
                ...new Set(
                  list.map(normalizeIndirContent).filter(Boolean),
                ),
              ]
            : [];
        }
        base.lineIndir = loadedIndir;
      }
      if (Array.isArray(p.zones) && p.zones.length) {
        base.zones = sortAlpha([
          ...new Set(
            p.zones
              .map((z) => plmNormalizeZoneLabel(String(z).trim()))
              .filter(Boolean),
          ),
        ]);
      }
      const presetSrc = Array.isArray(p.namePresets)
        ? p.namePresets
        : Array.isArray(p.cmu)
          ? p.cmu
          : [];
      if (presetSrc.length) {
        base.namePresets = sortNamePresets([
          ...new Set(presetSrc.map((z) => String(z).trim()).filter(Boolean)),
        ]);
      }
      if (p.lineCmr && typeof p.lineCmr === "object") {
        const loadedCmr = {};
        for (const key of Object.keys(p.lineCmr)) {
          const n = normalizeLineNum(key);
          if (!n) continue;
          const list = p.lineCmr[key];
          loadedCmr[n] = Array.isArray(list)
            ? dedupeLineCmrList(list.map((z) => String(z).trim()))
            : [];
        }
        base.lineCmr = loadedCmr;
      } else if (!base.lineCmr) {
        base.lineCmr = Object.fromEntries(
          DEFAULT_LINE_NUMS.map((n) => [n, []]),
        );
      }
      const merged = migrateCmrPresetsIntoLineCmr(base);
      if (migrateCnrsOnLine5(merged.lineCmr)) saveConfig(merged);
      return merged;
    } catch (e) {
      return cloneDefaults();
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          lineSpeeds: cfg.lineSpeeds,
          lineIndexes: cfg.lineIndexes,
          lineIndir: cfg.lineIndir,
          lineCmr: cfg.lineCmr,
          zones: cfg.zones,
          namePresets: cfg.namePresets,
        }),
      );
    } catch (e) {
      // ignore
    }
    if (typeof window.plmScheduleAutoBackup === "function") {
      window.plmScheduleAutoBackup();
    }
  }

  function emptyDescState() {
    return { speeds: {}, lines: {}, indir: {}, sectionOrder: [] };
  }

  function plmNormalizeDescState(state, cfg) {
    if (!state.speeds || typeof state.speeds !== "object") {
      state.speeds = {};
    }
    if (Array.isArray(state.v) && state.v.length) {
      const legacy = [...new Set(state.v.map(normalizeSpeedLabel).filter(Boolean))];
      const nums = getLineNums(cfg?.lineSpeeds);
      legacy.forEach((sp, i) => {
        const n = nums[i] || nums[0];
        if (n) state.speeds[n] = sp;
      });
    }
    delete state.v;
    for (const key of Object.keys(state.speeds)) {
      const n = normalizeLineNum(key);
      const val = normalizeSpeedLabel(state.speeds[key]);
      if (!n || !val) delete state.speeds[key];
      else state.speeds[n] = val;
    }
    return state;
  }

  function plmSectionHasContent(state, kind) {
    if (kind === "v") {
      return Object.keys(state.speeds || {}).some((n) => state.speeds[n]);
    }
    if (kind === "lines") {
      return Object.keys(state.lines).some((n) => state.lines[n]);
    }
    if (kind === "indir") {
      return Object.keys(state.indir).some(
        (n) => asPlmMultiArray(state.indir[n]).length > 0,
      );
    }
    return false;
  }

  /** Ordre d’affichage : pas de lignes vides ; vitesse en tête si présente ; sinon ordre de saisie. */
  function plmEffectiveSectionOrder(state) {
    const raw = (state.sectionOrder || []).filter((k) =>
      plmSectionHasContent(state, k),
    );
    const hasV = plmSectionHasContent(state, "v");
    const hasL = plmSectionHasContent(state, "lines");
    const hasI = plmSectionHasContent(state, "indir");
    if (hasV && hasL && hasI) {
      return ["v", "lines", "indir"];
    }
    if (hasV) {
      const rest = raw.filter((k) => k !== "v");
      return ["v", ...rest];
    }
    return raw;
  }

  function plmFormatSectionLine(state, kind) {
    if (kind === "v") {
      const parts = Object.keys(state.speeds || {})
        .filter((k) => normalizeLineNum(k) && state.speeds[k])
        .sort(plmSortLineKeys)
        .map((n) => `${n}: ${plmQuoteUserToken(state.speeds[n])}`);
      return parts.length ? joinPlmList(parts) : "";
    }
    if (kind === "lines") {
      const parts = Object.keys(state.lines)
        .filter((k) => normalizeLineNum(k) && state.lines[k])
        .sort(plmSortLineKeys)
        .map((n) => `${n}: ${plmQuoteUserToken(state.lines[n])}`);
      return parts.length ? joinPlmList(parts) : "";
    }
    if (kind === "indir") {
      const parts = Object.keys(state.indir)
        .filter((k) => normalizeLineNum(k) && asPlmMultiArray(state.indir[k]).length)
        .sort(plmSortLineKeys)
        .map((n) => {
          const vals = asPlmMultiArray(state.indir[n]).map((x) =>
            plmQuoteUserToken(x),
          );
          return `${n}: ${joinPlmIndirMulti(vals)}`;
        });
      return parts.length ? joinPlmList(parts) : "";
    }
    return "";
  }

  function plmClassifyDescRow(line, cfg) {
    const bits = splitPlmStructuralList(line);
    if (!bits.length) return null;
    let speedBits = 0;
    let indesBits = 0;
    let indirBits = 0;
    for (const bit of bits) {
      const seg = parsePlmLineSegmentRaw(bit);
      if (!seg) {
        speedBits++;
        continue;
      }
      const val = plmUnquoteUserToken(seg.rawValue);
      if (isSpeedLabel(val)) {
        speedBits++;
        continue;
      }
      if (val.includes(PLM_INDIR_MULTI_SEP)) {
        indirBits++;
        continue;
      }
      const resolved = resolveLineSegment(seg.num, seg.rawValue, cfg);
      if (resolved?.kind === "indir") indirBits++;
      else indesBits++;
    }
    if (speedBits && !indesBits && !indirBits) return "v";
    if (indirBits && !speedBits && !indesBits) return "indir";
    if (indirBits > indesBits) return "indir";
    return "lines";
  }

  /** Retire les lignes ZM: héritées (zones gérées dans la modale zone). */
  function stripStructuredZmLines(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .filter((line) => !/^ZM\s*:/i.test(line.trim()))
      .join("\n")
      .trim();
  }

  function plmSortLineKeys(a, b) {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  }

  /** Évite le doublon titre / première ligne de description (données héritées). */
  function plmStripTitleFromDescriptionRaw(raw, title) {
    const t = String(title ?? "").trim();
    let body = String(raw ?? "").trim();
    if (!t || !body) return body;
    if (body === t) return "";
    const lines = body.split(/\r?\n/);
    if (lines[0]?.trim() === t) {
      return lines
        .slice(1)
        .join("\n")
        .trim();
    }
    return body;
  }

  function plmDescRowsFromBody(body) {
    const rows = String(body ?? "")
      .split(/\r?\n/)
      .map((raw) => stripLegacyDescLinePrefix(raw.trim()))
      .filter((line) => line && !/^ZM\s*:/i.test(line));
    return rows;
  }

  function plmParseSpeedsFromLine(line, state, cfg) {
    const lineNums = getLineNums(cfg?.lineSpeeds);
    let legacyIdx = 0;
    for (const bit of splitPlmStructuralList(line)) {
      const seg = parsePlmLineSegmentRaw(bit);
      if (seg) {
        const val = normalizeSpeedLabel(plmUnquoteUserToken(seg.rawValue));
        if (val && isSpeedLabel(val)) state.speeds[seg.num] = val;
        continue;
      }
      for (const t of parseSpeedTokens(bit)) {
        const n = lineNums[legacyIdx++] || lineNums[0];
        if (n) state.speeds[n] = t;
      }
    }
  }

  function plmParseIndesFromLine(line, state, cfg) {
    for (const bit of splitPlmStructuralList(line)) {
      const seg = parsePlmLineSegmentRaw(bit);
      if (!seg) continue;
      const val = plmUnquoteUserToken(seg.rawValue);
      if (isSpeedLabel(val)) continue;
      if (val.includes(PLM_INDIR_MULTI_SEP)) continue;
      const code = normalizeCode(val);
      const indesKnown = cfg?.lineIndexes?.[seg.num] || [];
      if (indesKnown.includes(code)) {
        state.lines[seg.num] = code;
        continue;
      }
      if (/^[A-Z0-9]{1,6}$/.test(code)) {
        state.lines[seg.num] = code;
      }
    }
  }

  function plmParseIndirFromLine(line, state, cfg) {
    for (const bit of splitPlmStructuralList(line)) {
      const seg = parsePlmLineSegmentRaw(bit);
      if (!seg) continue;
      const val = plmUnquoteUserToken(seg.rawValue);
      if (isSpeedLabel(val)) continue;
      const resolved = resolveLineSegment(seg.num, seg.rawValue, cfg);
      if (resolved?.kind === "indir" && resolved.values?.length) {
        state.indir[resolved.num] = resolved.values;
      } else if (resolved?.kind === "indes") {
        state.lines[resolved.num] = resolved.code;
      }
    }
  }

  function plmParseDescriptionFlat(body, state, cfg) {
    const parts = [];
    for (const line of plmDescRowsFromBody(body)) {
      parts.push(...splitPlmStructuralList(line));
    }
    for (const bit of parts) {
      const lineSeg = parsePlmLineSegmentRaw(bit);
      if (lineSeg) {
        const val = plmUnquoteUserToken(lineSeg.rawValue);
        if (isSpeedLabel(val)) {
          state.speeds[lineSeg.num] = normalizeSpeedLabel(val);
          continue;
        }
        const resolved = resolveLineSegment(lineSeg.num, lineSeg.rawValue, cfg);
        if (resolved?.kind === "indes") state.lines[resolved.num] = resolved.code;
        else if (resolved?.kind === "indir" && resolved.values?.length) {
          state.indir[resolved.num] = resolved.values;
        }
        continue;
      }
      const tokens = parseSpeedTokens(bit);
      const lineNums = getLineNums(cfg?.lineSpeeds);
      tokens.forEach((t, i) => {
        const n = lineNums[i] || lineNums[0];
        if (n) state.speeds[n] = t;
      });
    }
  }

  function parseDescription(text, config) {
    const state = emptyDescState();
    const cfg = config || loadConfig();
    const body = stripStructuredZmLines(text);
    if (!body) return state;

    if (body.includes("\n") || body.includes("\r")) {
      const rows = plmDescRowsFromBody(body);
      state.sectionOrder = [];
      for (const row of rows) {
        const kind = plmClassifyDescRow(row, cfg);
        if (!kind) continue;
        if (!state.sectionOrder.includes(kind)) {
          state.sectionOrder.push(kind);
        }
        if (kind === "v") plmParseSpeedsFromLine(row, state, cfg);
        else if (kind === "lines") plmParseIndesFromLine(row, state, cfg);
        else if (kind === "indir") plmParseIndirFromLine(row, state, cfg);
      }
    } else {
      plmParseDescriptionFlat(body, state, cfg);
      state.sectionOrder = [];
      if (plmSectionHasContent(state, "v")) state.sectionOrder.push("v");
      if (plmSectionHasContent(state, "lines")) state.sectionOrder.push("lines");
      if (plmSectionHasContent(state, "indir")) state.sectionOrder.push("indir");
    }

    return plmNormalizeDescState(state, cfg);
  }

  function formatDescription(state) {
    const out = [];
    for (const kind of plmEffectiveSectionOrder(state)) {
      const line = plmFormatSectionLine(state, kind);
      if (line) out.push(line);
    }
    return out.join("\n");
  }

  function splitBatchInput(raw) {
    return String(raw ?? "")
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * @param {{
   *   nameEl: HTMLInputElement,
   *   descEl: HTMLTextAreaElement,
   *   namePanel: HTMLElement,
   *   speedPanel: HTMLElement,
   *   cmrPanel: HTMLElement,
   *   indesPanel: HTMLElement,
   *   indirPanel: HTMLElement,
   *   descPreview: HTMLElement,
   *   prompt?: (message: string, defaultValue?: string) => Promise<string|null>,
   *   confirm?: (message: string) => Promise<boolean>,
   *   alert?: (message: string) => void,
   *   onLabelPreviewChange?: () => void,
   * }} opts
   */
  function createStructuredTextUi(opts) {
    const nameEl = opts.nameEl;
    const descEl = opts.descEl;
    const namePanel = opts.namePanel;
    const speedPanel = opts.speedPanel;
    const cmrPanel = opts.cmrPanel;
    const indesPanel = opts.indesPanel;
    const indirPanel = opts.indirPanel;
    const descPreview = opts.descPreview;
    const promptFn =
      opts.prompt ||
      (async (msg, def) => {
        const v = window.prompt(msg, def ?? "");
        return v == null ? null : v;
      });
    const confirmFn = opts.confirm || (async (msg) => window.confirm(msg));
    const alertFn =
      opts.alert ||
      ((msg) => {
        window.alert(msg);
      });
    const onLabelPreviewChange = opts.onLabelPreviewChange;

    function getCmrCatalogLines(preset) {
      return plmCmrCatalogLinesForName(preset, config);
    }

    function isCmrChecked(preset) {
      return cmrPick.kind === "cmr" && cmrPick.value === preset;
    }

    function pickCmr(preset) {
      cmrPick = {
        kind: "cmr",
        value: preset,
        lines: getCmrCatalogLines(preset),
      };
    }

    function unpickCmr(preset) {
      if (isCmrChecked(preset)) clearCmrPick();
    }

    function getCommittedTitle() {
      if (cmrPick.kind === "cmr" && cmrPick.value) {
        return String(cmrPick.value).trim();
      }
      if (namePick.kind === "preset" && namePick.value) {
        return String(namePick.value).trim();
      }
      return "";
    }

    /** Titre standard ↔ CMR uniquement (pas vitesse / INDES / INDIR). */
    function clearNamePick() {
      namePick = { kind: "none" };
    }

    function clearCmrPick() {
      cmrPick = { kind: "none" };
    }

    function notifyLabelPreview() {
      if (onLabelPreviewChange) onLabelPreviewChange();
    }

    const MSG_COCHER =
      "Cochez l’élément concerné, puis utilisez S, M ou D.";
    const MSG_COCHER_INDES =
      "Cochez la destination sur cette ligne, puis utilisez S ou M.";
    const MSG_COCHER_INDIR =
      "Cochez un ou plusieurs libellés sur cette ligne INDIR, puis utilisez S ou M.";
    const MSG_COCHER_VITESSE =
      "Cochez la vitesse sur cette ligne, puis utilisez S ou M.";
    const MSG_COCHER_CMR =
      "Cochez un CMR sur cette ligne, puis utilisez S ou M.";

    function getIndirSelected(num) {
      const known = config.lineIndir[num] || [];
      const raw = asPlmMultiArray(descState.indir[num]);
      if (!raw.length) return [];
      if (!known.length) return raw;
      return splitPlmMultiByKnown(joinPlmIndirMulti(raw), known);
    }

    function setIndirSelected(num, arr) {
      if (arr.length) descState.indir[num] = [...arr];
      else delete descState.indir[num];
    }

    function reconcileDescState() {
      plmNormalizeDescState(descState, config);
      for (const n of Object.keys(descState.indir)) {
        const known = config.lineIndir[n] || [];
        const normalized = splitPlmMultiByKnown(
          joinPlmIndirMulti(asPlmMultiArray(descState.indir[n])),
          known,
        );
        if (normalized.length) descState.indir[n] = normalized;
        else delete descState.indir[n];
      }
    }

    async function pickOneFromSelected(message, selected, defaultVal) {
      if (!selected.length) return null;
      if (selected.length === 1) return selected[0];
      return promptPickOne(message, selected, defaultVal ?? selected[0]);
    }

    async function confirmEffacer(label) {
      return confirmFn(`Êtes-vous sûr de vouloir effacer « ${label} » ?`);
    }

    async function confirmModifier(label) {
      return confirmFn(`Êtes-vous sûr de vouloir modifier « ${label} » ?`);
    }

    async function promptPickOne(message, choices, defaultVal) {
      if (!choices.length) return null;
      const raw = await promptFn(
        `${message}\n${choices.join(", ")}`,
        defaultVal != null ? String(defaultVal) : choices[0],
      );
      if (raw == null) return null;
      const t = String(raw).trim();
      return choices.includes(t) ? t : null;
    }

    let config = loadConfig();
    let descState = emptyDescState();
    let namePick = { kind: "none" };
    /** @type {{ kind: 'none' } | { kind: 'line', line: string, value: string }} */
    let cmrPick = { kind: "none" };
    /** Description libre héritée tant qu’aucune case structurée n’est utilisée. */
    let legacyDescRaw = null;

    function migrateDescLineKey(from, to) {
      if (!from || !to || from === to) return;
      if (descState.lines[from]) {
        descState.lines[to] = descState.lines[from];
        delete descState.lines[from];
      }
    }

    function migrateDescIndirLineKey(from, to) {
      if (!from || !to || from === to) return;
      if (descState.indir[from]) {
        descState.indir[to] = descState.indir[from];
        delete descState.indir[from];
      }
    }

    function migrateDescSpeedLineKey(from, to) {
      if (!from || !to || from === to) return;
      if (descState.speeds[from]) {
        descState.speeds[to] = descState.speeds[from];
        delete descState.speeds[from];
      }
    }

    function renameLineInConfig(from, to, overwrite) {
      if (from === to) return true;
      const next = { ...config.lineIndexes };
      if (next[to] && !overwrite) return false;
      next[to] = [...(next[from] || [])];
      delete next[from];
      config.lineIndexes = next;
      migrateDescLineKey(from, to);
      return true;
    }

    function renameIndirLineInConfig(from, to, overwrite) {
      if (from === to) return true;
      const next = { ...config.lineIndir };
      if (next[to] && !overwrite) return false;
      next[to] = [...(next[from] || [])];
      delete next[from];
      config.lineIndir = next;
      migrateDescIndirLineKey(from, to);
      return true;
    }

    function clearLegacyDesc() {
      legacyDescRaw = null;
    }

    function plmSectionHasContentLocal(kind) {
      if (kind === "v") {
        return Object.keys(descState.speeds || {}).some(
          (n) => descState.speeds[n],
        );
      }
      if (kind === "lines") {
        return Object.keys(descState.lines).some((n) => descState.lines[n]);
      }
      if (kind === "indir") {
        return Object.keys(descState.indir).some(
          (n) => getIndirSelected(n).length > 0,
        );
      }
      return false;
    }

    function afterDescSelectionChange(kind) {
      clearLegacyDesc();
      if (!descState.sectionOrder) descState.sectionOrder = [];
      if (plmSectionHasContentLocal(kind) && !descState.sectionOrder.includes(kind)) {
        descState.sectionOrder.push(kind);
      }
      descState.sectionOrder = descState.sectionOrder.filter((k) =>
        plmSectionHasContentLocal(k),
      );
      syncDescField();
    }

    function isDescStateEmpty() {
      for (const n of Object.keys(descState.speeds || {})) {
        if (descState.speeds[n]) return false;
      }
      for (const n of Object.keys(descState.lines)) {
        if (descState.lines[n]) return false;
      }
      for (const n of Object.keys(descState.indir)) {
        if (getIndirSelected(n).length) return false;
      }
      return true;
    }

    function isPreviewEmpty() {
      if (getCommittedTitle()) return false;
      if (legacyDescRaw != null) return !String(legacyDescRaw).trim();
      return isDescStateEmpty();
    }

    function applyCmrTitlePillStyle(pill, title) {
      const full = String(title ?? "").trim();
      if (!full || !isCmrStyleNamePreset(full)) return;
      const lines =
        cmrPick.kind === "cmr" && cmrPick.value === full
          ? cmrPick.lines
          : getCmrCatalogLines(full);
      if (
        !lines.length ||
        typeof window.tamPlmCmrTitlePillInlineStyle !== "function"
      ) {
        return;
      }
      const st = window.tamPlmCmrTitlePillInlineStyle(lines);
      if (!st) return;
      pill.classList.add("tam-plm-desc-title-pill--cmr");
      if (lines.length > 1) {
        pill.classList.add("tam-plm-desc-title-pill--cmr-multi");
      }
      pill.setAttribute("style", `${st};display:block;width:100%`);
      pill.dataset.plmCmrLines = lines.join(",");
    }

    function appendTitlePill(row, title) {
      const full = String(title ?? "").trim();
      if (!full) return;
      const pill = document.createElement("span");
      pill.className = "tam-plm-desc-title-pill";
      pill.textContent = full;
      pill.title = full;
      applyCmrTitlePillStyle(pill, full);
      row.appendChild(pill);
    }

    function appendDescPreviewLinePills(row, segments) {
      row.classList.add("tam-plm-desc-preview-row--pills");
      segments.forEach((seg) => {
        const pill = document.createElement("span");
        pill.className = "tam-plm-desc-line-pill";
        const label = `${seg.num}: ${seg.label}`;
        pill.textContent = label;
        pill.title = label;
        if (typeof window.tamApplyPlmDescLinePill === "function") {
          window.tamApplyPlmDescLinePill(pill, seg.num);
        } else {
          pill.classList.add("tam-plm-desc-line-pill--fallback");
        }
        row.appendChild(pill);
      });
    }

    function renderDescPreviewFromState() {
      if (!descPreview) return;
      const title = getCommittedTitle();
      descPreview.dataset.empty = isPreviewEmpty() ? "1" : "0";
      descPreview.innerHTML = "";
      if (legacyDescRaw != null) {
        const legacyBody = plmStripTitleFromDescriptionRaw(
          legacyDescRaw,
          title,
        );
        if (title) {
          const row = document.createElement("div");
          row.className =
            "tam-plm-desc-preview-row tam-plm-desc-preview-row--title";
          appendTitlePill(row, title);
          descPreview.appendChild(row);
        }
        if (legacyBody) {
          const row = document.createElement("div");
          row.className = "tam-plm-desc-preview-row";
          row.textContent = legacyBody;
          descPreview.appendChild(row);
        }
        return;
      }
      if (title) {
        const titleRow = document.createElement("div");
        titleRow.className =
          "tam-plm-desc-preview-row tam-plm-desc-preview-row--title";
        appendTitlePill(titleRow, title);
        descPreview.appendChild(titleRow);
      }
      if (isDescStateEmpty()) return;

      const order = plmEffectiveSectionOrder(descState);
      for (const kind of order) {
        const row = document.createElement("div");
        row.className = "tam-plm-desc-preview-row";

        if (kind === "v") {
          const segs = Object.keys(descState.speeds || {})
            .filter((n) => normalizeLineNum(n) && descState.speeds[n])
            .sort(plmSortLineKeys)
            .map((n) => ({ num: n, label: descState.speeds[n] }));
          appendDescPreviewLinePills(row, segs);
        } else if (kind === "lines") {
          const segs = Object.keys(descState.lines)
            .filter((n) => normalizeLineNum(n) && descState.lines[n])
            .sort(plmSortLineKeys)
            .map((n) => ({ num: n, label: descState.lines[n] }));
          appendDescPreviewLinePills(row, segs);
        } else if (kind === "indir") {
          const segs = Object.keys(descState.indir)
            .filter(
              (n) =>
                normalizeLineNum(n) &&
                asPlmMultiArray(descState.indir[n]).length,
            )
            .sort(plmSortLineKeys)
            .map((n) => ({
              num: n,
              label: joinPlmIndirMulti(asPlmMultiArray(descState.indir[n])),
            }));
          appendDescPreviewLinePills(row, segs);
        }

        if (row.childNodes.length || row.textContent) {
          descPreview.appendChild(row);
        }
      }
    }

    function syncDescField() {
      if (isDescStateEmpty()) {
        legacyDescRaw = null;
        descState.sectionOrder = [];
      } else if (legacyDescRaw == null) {
        descState.sectionOrder = (descState.sectionOrder || []).filter((k) =>
          plmSectionHasContent(descState, k),
        );
      }
      if (legacyDescRaw != null) {
        if (descPreview) {
          descPreview.textContent = legacyDescRaw;
          descPreview.dataset.empty = legacyDescRaw ? "0" : "1";
        }
        notifyLabelPreview();
        return;
      }
      const text = isDescStateEmpty() ? "" : formatDescription(descState);
      descEl.value = text;
      renderDescPreviewFromState();
      notifyLabelPreview();
    }

    function syncNameFromPick() {
      if (cmrPick.kind === "cmr" && cmrPick.value) {
        nameEl.value = String(cmrPick.value);
      } else {
        nameEl.value =
          namePick.kind === "preset" && namePick.value
            ? String(namePick.value)
            : "";
      }
      if (descPreview && legacyDescRaw == null) {
        renderDescPreviewFromState();
      }
      notifyLabelPreview();
    }

    function asmTools(handlers, { showDup = true } = {}) {
      const tools = document.createElement("div");
      tools.className = "tam-plm-struct-tools tam-plm-struct-tools--asm";
      const mk = (letter, fn, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tam-plm-asm-btn";
        b.textContent = letter;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", () => void fn());
        return b;
      };
      tools.append(
        mk("A", handlers.a, "Ajouter"),
        mk("S", handlers.s, "Supprimer"),
        mk("M", handlers.m, "Modifier"),
      );
      if (showDup && handlers.d) {
        tools.append(mk("D", handlers.d, "Dupliquer"));
      }
      return tools;
    }

    function sectionHead(title, handlers, opts) {
      const head = document.createElement("div");
      head.className = "tam-plm-struct-section__head";
      const titleEl = document.createElement("span");
      titleEl.className = "tam-plm-struct-section__title";
      titleEl.textContent = title;
      head.appendChild(titleEl);
      head.appendChild(asmTools(handlers, opts));
      return head;
    }

    function appendNamePresetChip(box, preset) {
      const row = document.createElement("div");
      row.className = "tam-plm-struct-chip";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const cid = `plm-name-${preset.replace(/\W/g, "_")}`;
      cb.id = cid;
      cb.checked = namePick.kind === "preset" && namePick.value === preset;
      cb.addEventListener("change", () => {
        if (cb.checked) {
          clearCmrPick();
          namePick = { kind: "preset", value: preset };
        } else if (
          namePick.kind === "preset" &&
          namePick.value === preset
        ) {
          clearNamePick();
        }
        syncNameFromPick();
        syncDescField();
        renderNamePanel();
        renderCmrPanel();
      });
      const lbl = document.createElement("label");
      lbl.htmlFor = cid;
      lbl.textContent = preset;
      row.append(cb, lbl);
      box.appendChild(row);
    }

    function appendNamePresetBox(parent, presets) {
      if (!presets.length) return;
      const box = document.createElement("div");
      box.className = "tam-plm-struct-box tam-plm-struct-box--grid2";
      for (const preset of presets) {
        appendNamePresetChip(box, preset);
      }
      parent.appendChild(box);
    }

    function appendNamePresetDivider(parent) {
      const hr = document.createElement("hr");
      hr.className = "tam-plm-name-divider";
      hr.setAttribute("aria-hidden", "true");
      parent.appendChild(hr);
    }

    function renderNamePanel() {
      namePanel.innerHTML = "";
      namePanel.appendChild(
        sectionHead("Titre :", {
          a: addNamePreset,
          s: delNamePreset,
          m: modNamePreset,
          d: dupNamePreset,
        }),
      );

      if (config.namePresets.length) {
        const groups = document.createElement("div");
        groups.className = "tam-plm-name-preset-groups";
        appendNamePresetBox(groups, config.namePresets);
        namePanel.appendChild(groups);
      }
    }

    function renderCmrPanel() {
      if (!cmrPanel) return;
      cmrPanel.innerHTML = "";
      const sec = document.createElement("section");
      sec.className = "tam-plm-struct-section tam-plm-struct-section--cmr";
      sec.appendChild(
        sectionHead("CMR :", {
          a: addCmrLine,
          s: delCmrLine,
          m: modCmrLine,
          d: dupCmrLine,
        }),
      );
      for (const num of getLineNums(config.lineCmr)) {
        const presets = config.lineCmr[num] || [];
        const lineGroup = document.createElement("div");
        lineGroup.className = "tam-plm-line-group";
        const bar = document.createElement("div");
        bar.className = "tam-plm-line-group__bar";
        const numEl = document.createElement("span");
        numEl.className = "tam-plm-line-group__label";
        numEl.textContent =
          num === "other" ? "Autres" : `Ligne ${num}`;
        bar.appendChild(numEl);
        bar.appendChild(
          asmTools(
            {
              a: () => addCmrDest(num),
              s: () => delCmrDest(num),
              m: () => modCmrDest(num),
            },
            { showDup: false },
          ),
        );
        lineGroup.appendChild(bar);
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box tam-plm-struct-box--chips";
        if (!presets.length) {
          const empty = document.createElement("span");
          empty.className = "tam-plm-line-group__empty";
          empty.textContent = "Aucun CMR sur cette ligne";
          box.appendChild(empty);
        }
        for (const preset of presets) {
          const id = `plm-cmr${num}-${preset.replace(/\W/g, "_")}`;
          renderChipCheckbox(box, {
            id,
            labelText: preset,
            checked: isCmrChecked(preset),
            onChange: (cb) => {
              if (cb.checked) {
                clearNamePick();
                pickCmr(preset);
              } else {
                unpickCmr(preset);
              }
              syncNameFromPick();
              renderNamePanel();
              renderCmrPanel();
            },
          });
        }
        lineGroup.appendChild(box);
        if (typeof window.tamApplyPlmCmrLineGroup === "function") {
          window.tamApplyPlmCmrLineGroup(lineGroup, num);
        } else {
          lineGroup.classList.add("tam-plm-line-group--neutral");
        }
        sec.appendChild(lineGroup);
      }
      cmrPanel.appendChild(sec);
    }

    async function addNamePreset() {
      const raw = await promptFn(
        "Noms à ajouter (séparés par des virgules, ex. Auto, CMU Hornière) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw);
      if (!batch.length) return;
      const cmrBatch = batch.filter((x) => isCmrStyleNamePreset(x));
      const stdBatch = batch.filter((x) => !isCmrStyleNamePreset(x));
      if (stdBatch.length) {
        config.namePresets = sortNamePresets([
          ...new Set([...config.namePresets, ...stdBatch]),
        ]);
      }
      if (cmrBatch.length) {
        const lineNum = getLineNums(config.lineCmr)[0] || "1";
        if (!config.lineCmr[lineNum]) config.lineCmr[lineNum] = [];
        config.lineCmr[lineNum] = sortNamePresets([
          ...new Set([...(config.lineCmr[lineNum] || []), ...cmrBatch]),
        ]);
      }
      saveConfig(config);
      renderNamePanel();
      renderCmrPanel();
    }

    async function dupNamePreset() {
      if (namePick.kind !== "preset" || !namePick.value) {
        alertFn(MSG_COCHER);
        return;
      }
      const src = namePick.value;
      const newV = await promptFn("Libellé du doublon :", src);
      if (newV == null || !String(newV).trim()) return;
      const newT = String(newV).trim();
      config.namePresets = sortNamePresets([
        ...new Set([...config.namePresets, newT]),
      ]);
      namePick = { kind: "preset", value: newT };
      syncNameFromPick();
      saveConfig(config);
      renderNamePanel();
    }

    async function delNamePreset() {
      if (!config.namePresets.length) return;
      if (namePick.kind !== "preset" || !namePick.value) {
        alertFn(MSG_COCHER);
        return;
      }
      const t = namePick.value;
      if (!(await confirmEffacer(t))) return;
      config.namePresets = config.namePresets.filter((x) => x !== t);
      namePick = { kind: "none" };
      nameEl.value = "";
      saveConfig(config);
      renderNamePanel();
    }

    async function modNamePreset() {
      if (!config.namePresets.length) return;
      if (namePick.kind !== "preset" || !namePick.value) {
        alertFn(MSG_COCHER);
        return;
      }
      const oldT = namePick.value;
      if (!(await confirmModifier(oldT))) return;
      const newV = await promptFn("Nouveau nom :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = String(newV).trim();
      config.namePresets = sortNamePresets(
        config.namePresets.map((x) => (x === oldT ? newT : x)),
      );
      namePick = { kind: "preset", value: newT };
      syncNameFromPick();
      saveConfig(config);
      renderNamePanel();
    }

    function renderChipCheckbox(
      container,
      { id, groupName, labelText, checked, onChange },
    ) {
      const row = document.createElement("div");
      row.className = "tam-plm-struct-chip";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      if (groupName) cb.name = groupName;
      cb.id = id;
      cb.checked = !!checked;
      cb.addEventListener("change", () => onChange(cb));
      const lbl = document.createElement("label");
      lbl.htmlFor = id;
      lbl.textContent = labelText;
      lbl.title = labelText;
      row.append(cb, lbl);
      container.appendChild(row);
      return row;
    }

    function renderIndexCell(container, { id, code, checked, onChange }) {
      const cell = document.createElement("div");
      cell.className = "tam-plm-index-cell";
      const lbl = document.createElement("label");
      lbl.htmlFor = id;
      lbl.textContent = code;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = !!checked;
      cb.addEventListener("change", () => onChange(cb));
      cell.append(lbl, cb);
      container.appendChild(cell);
    }

    function renderRadioGroup({
      container,
      groupName,
      items,
      selected,
      onSelect,
      formatLabel,
    }) {
      for (const item of items) {
        const labelText = formatLabel ? formatLabel(item) : String(item);
        const id = `${groupName}-${String(item).replace(/\W/g, "_")}`;
        renderChipCheckbox(container, {
          id,
          groupName,
          labelText,
          checked: selected === labelText || selected === item,
          onChange: (cb) => {
            if (cb.checked) onSelect(item, labelText);
            else onSelect(null, null);
            renderDescPanel();
          },
        });
      }
    }

    function renderDescPanelSection(kind) {
      const panel =
        kind === "v"
          ? speedPanel
          : kind === "lines"
            ? indesPanel
            : kind === "indir"
              ? indirPanel
              : null;
      if (!panel) return;
      panel.innerHTML = "";

      if (kind === "v") {
      const secV = document.createElement("section");
      secV.className = "tam-plm-struct-section";
      secV.appendChild(
        sectionHead("Vitesse :", {
          a: addSpeedLine,
          s: delSpeedLine,
          m: modSpeedLine,
          d: dupSpeedLine,
        }),
      );
      for (const num of getLineNums(config.lineSpeeds)) {
        const speeds = config.lineSpeeds[num] || [];
        const lineRow = document.createElement("div");
        lineRow.className = "tam-plm-line-row";
        const numEl = document.createElement("span");
        numEl.className = "tam-plm-line-num";
        numEl.textContent = `${num} :`;
        lineRow.appendChild(numEl);
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box tam-plm-struct-box--chips";
        for (const item of speeds) {
          const id = `plm-v${num}-${String(item).replace(/\W/g, "_")}`;
          renderChipCheckbox(box, {
            id,
            labelText: plmSpeedChipLabel(item),
            checked: descState.speeds[num] === item,
            onChange: (cb) => {
              if (cb.checked) descState.speeds[num] = item;
              else if (descState.speeds[num] === item) {
                delete descState.speeds[num];
              }
              afterDescSelectionChange("v");
              renderDescPanelSection("v");
            },
          });
        }
        lineRow.appendChild(box);
        lineRow.appendChild(
          asmTools(
            {
              a: () => addSpeedDest(num),
              s: () => delSpeedDest(num),
              m: () => modSpeedDest(num),
            },
            { showDup: false },
          ),
        );
        secV.appendChild(lineRow);
      }
      panel.appendChild(secV);
      return;
      }

      if (kind === "lines") {
      const secL = document.createElement("section");
      secL.className = "tam-plm-struct-section";
      secL.appendChild(
        sectionHead("Lignes (INDES) :", {
          a: addLine,
          s: delLine,
          m: modLine,
          d: dupLine,
        }),
      );
      for (const num of getLineNums(config.lineIndexes)) {
        const indexes = config.lineIndexes[num] || [];
        const lineRow = document.createElement("div");
        lineRow.className = "tam-plm-line-row";
        const numEl = document.createElement("span");
        numEl.className = "tam-plm-line-num";
        numEl.textContent = `${num} :`;
        lineRow.appendChild(numEl);
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box tam-plm-struct-box--index";
        for (const code of indexes) {
          const id = `plm-L${num}-${code}`;
          renderIndexCell(box, {
            id,
            code,
            checked: descState.lines[num] === code,
            onChange: (cb) => {
              if (cb.checked) descState.lines[num] = code;
              else if (descState.lines[num] === code) {
                delete descState.lines[num];
              }
              afterDescSelectionChange("lines");
              renderDescPanelSection("lines");
            },
          });
        }
        lineRow.appendChild(box);
        lineRow.appendChild(
          asmTools(
            {
              a: () => addLineDest(num),
              s: () => delLineDest(num),
              m: () => modLineDest(num),
            },
            { showDup: false },
          ),
        );
        secL.appendChild(lineRow);
      }
      panel.appendChild(secL);
      return;
      }

      if (kind === "indir") {
      const secIndir = document.createElement("section");
      secIndir.className = "tam-plm-struct-section";
      secIndir.appendChild(
        sectionHead("Lignes (INDIR) :", {
          a: addIndirLine,
          s: delIndirLine,
          m: modIndirLine,
          d: dupIndirLine,
        }),
      );
      const indirNums = getLineNums(config.lineIndir);
      if (!indirNums.length) {
        const emptyHint = document.createElement("p");
        emptyHint.className = "tam-plm-struct-line-label";
        emptyHint.textContent =
          "Aucune ligne INDIR : utilisez A pour ajouter 1, 2, 3, 4B, 5, etc.";
        secIndir.appendChild(emptyHint);
      }
      for (const num of indirNums) {
        const entries = config.lineIndir[num] || [];
        const indirSelected = getIndirSelected(num);
        const lineRow = document.createElement("div");
        lineRow.className = "tam-plm-line-row";
        const numEl = document.createElement("span");
        numEl.className = "tam-plm-line-num";
        numEl.textContent = `${num} :`;
        lineRow.appendChild(numEl);
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box tam-plm-struct-box--chips";
        for (const entry of entries) {
          const id = `plm-INDIR${num}-${String(entry).replace(/\W/g, "_")}`;
          renderChipCheckbox(box, {
            id,
            labelText: entry,
            checked: indirSelected.includes(entry),
            onChange: (cb) => {
              let sel = getIndirSelected(num);
              if (cb.checked) {
                if (!sel.includes(entry)) sel = [...sel, entry];
              } else {
                sel = sel.filter((x) => x !== entry);
              }
              setIndirSelected(num, sel);
              afterDescSelectionChange("indir");
              renderDescPanelSection("indir");
            },
          });
        }
        lineRow.appendChild(box);
        lineRow.appendChild(
          asmTools(
            {
              a: () => addIndirDest(num),
              s: () => delIndirDest(num),
              m: () => modIndirDest(num),
            },
            { showDup: false },
          ),
        );
        secIndir.appendChild(lineRow);
      }
      panel.appendChild(secIndir);
      }
    }

    /** Vitesse / INDES / INDIR seulement (ne pas reconstruire l’onglet CMR). */
    function renderDescPanel() {
      renderDescPanelSection("v");
      renderDescPanelSection("lines");
      renderDescPanelSection("indir");
      syncDescField();
    }

    async function addCmrLine() {
      const raw = await promptFn("Numéro de la nouvelle ligne CMR :", "6");
      if (raw == null) return;
      const n = normalizeLineNum(raw);
      if (!n) return;
      if (config.lineCmr[n]) {
        alertFn(`La ligne CMR ${n} existe déjà.`);
        return;
      }
      config.lineCmr[n] = [];
      saveConfig(config);
      renderCmrPanel();
    }

    async function delCmrLine() {
      const lines = getLineNums(config.lineCmr);
      if (!lines.length) return;
      const n = normalizeLineNum(
        await promptPickOne("Ligne CMR à supprimer :", lines, lines[0]),
      );
      if (!n) return;
      if (
        !(await confirmEffacer(
          `la ligne CMR ${n} et tous ses libellés du catalogue`,
        ))
      ) {
        return;
      }
      if (cmrPick.kind === "cmr" && cmrPick.lines.includes(n)) {
        cmrPick.lines = getCmrCatalogLines(cmrPick.value);
        if (!cmrPick.lines.length) clearCmrPick();
      }
      delete config.lineCmr[n];
      saveConfig(config);
      syncNameFromPick();
      renderCmrPanel();
    }

    async function modCmrLine() {
      const lines = getLineNums(config.lineCmr);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Ligne CMR à renommer :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn(`Nouveau numéro pour la ligne CMR ${from} :`, from);
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (to !== from && config.lineCmr[to]) {
        if (
          !(await confirmFn(
            `La ligne CMR ${to} existe déjà. Remplacer ses libellés par ceux de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      config.lineCmr[to] = [...(config.lineCmr[from] || [])];
      delete config.lineCmr[from];
      if (cmrPick.kind === "cmr") {
        cmrPick.lines = getCmrCatalogLines(cmrPick.value);
        if (!cmrPick.lines.length) clearCmrPick();
      }
      saveConfig(config);
      renderCmrPanel();
    }

    async function dupCmrLine() {
      const lines = getLineNums(config.lineCmr);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Dupliquer la ligne CMR :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn("Vers le numéro de ligne CMR :", "");
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (config.lineCmr[to]) {
        if (
          !(await confirmFn(
            `La ligne CMR ${to} existe déjà. Écraser ses libellés par ceux de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      config.lineCmr[to] = [...(config.lineCmr[from] || [])];
      saveConfig(config);
      renderCmrPanel();
    }

    async function addCmrDest(lineNum) {
      const raw = await promptFn(
        `CMR à ajouter sur la ligne ${lineNum} (séparés par des virgules) :`,
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map((z) => String(z).trim()).filter(Boolean);
      if (!batch.length) return;
      const cur = config.lineCmr[lineNum] || [];
      config.lineCmr[lineNum] = sortNamePresets([...new Set([...cur, ...batch])]);
      saveConfig(config);
      renderCmrPanel();
    }

    async function delCmrDest(lineNum) {
      const t = cmrPick.kind === "cmr" ? cmrPick.value : "";
      if (!t || !(config.lineCmr[lineNum] || []).includes(t)) {
        alertFn(MSG_COCHER_CMR);
        return;
      }
      if (!(await confirmEffacer(`ligne ${lineNum} — ${t}`))) return;
      config.lineCmr[lineNum] = (config.lineCmr[lineNum] || []).filter(
        (x) => x !== t,
      );
      clearCmrPick();
      syncNameFromPick();
      saveConfig(config);
      renderNamePanel();
      renderCmrPanel();
    }

    async function modCmrDest(lineNum) {
      const oldT = cmrPick.kind === "cmr" ? cmrPick.value : "";
      if (!oldT || !(config.lineCmr[lineNum] || []).includes(oldT)) {
        alertFn(MSG_COCHER_CMR);
        return;
      }
      if (!(await confirmModifier(`ligne ${lineNum} — ${oldT}`))) return;
      const newV = await promptFn("Nouveau libellé CMR :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = String(newV).trim();
      config.lineCmr[lineNum] = sortNamePresets(
        (config.lineCmr[lineNum] || []).map((x) => (x === oldT ? newT : x)),
      );
      if (isCmrChecked(oldT)) pickCmr(newT);
      syncNameFromPick();
      saveConfig(config);
      renderCmrPanel();
    }

    async function addSpeedLine() {
      const raw = await promptFn("Numéro de la nouvelle ligne vitesse :", "6");
      if (raw == null) return;
      const n = normalizeLineNum(raw);
      if (!n) return;
      if (config.lineSpeeds[n]) {
        alertFn(`La ligne vitesse ${n} existe déjà.`);
        return;
      }
      config.lineSpeeds[n] = [];
      saveConfig(config);
      renderDescPanel();
    }

    async function delSpeedLine() {
      const lines = getLineNums(config.lineSpeeds);
      if (!lines.length) return;
      const n = normalizeLineNum(
        await promptPickOne("Ligne vitesse à supprimer :", lines, lines[0]),
      );
      if (!n) return;
      if (
        !(await confirmEffacer(
          `la ligne vitesse ${n} et toutes ses vitesses du catalogue`,
        ))
      ) {
        return;
      }
      delete config.lineSpeeds[n];
      delete descState.speeds[n];
      saveConfig(config);
      renderDescPanel();
    }

    async function modSpeedLine() {
      const lines = getLineNums(config.lineSpeeds);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Ligne vitesse à renommer :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn(
        `Nouveau numéro pour la ligne vitesse ${from} :`,
        from,
      );
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (to !== from && config.lineSpeeds[to]) {
        if (
          !(await confirmFn(
            `La ligne vitesse ${to} existe déjà. Remplacer ses vitesses par celles de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      renameSpeedLineInConfig(from, to, true);
      saveConfig(config);
      renderDescPanel();
    }

    async function dupSpeedLine() {
      const lines = getLineNums(config.lineSpeeds);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Dupliquer la ligne vitesse :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn("Vers le numéro de ligne :", "");
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (config.lineSpeeds[to]) {
        if (
          !(await confirmFn(
            `La ligne vitesse ${to} existe déjà. Écraser ses vitesses par celles de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      config.lineSpeeds[to] = [...(config.lineSpeeds[from] || [])];
      if (descState.speeds[from]) descState.speeds[to] = descState.speeds[from];
      saveConfig(config);
      renderDescPanel();
    }

    function renameSpeedLineInConfig(from, to, overwrite) {
      if (from === to) return true;
      const next = { ...config.lineSpeeds };
      if (next[to] && !overwrite) return false;
      next[to] = [...(next[from] || [])];
      delete next[from];
      config.lineSpeeds = next;
      migrateDescSpeedLineKey(from, to);
      return true;
    }

    async function addSpeedDest(lineNum) {
      const raw = await promptFn(
        `Vitesses à ajouter sur la ligne ${lineNum} (chiffres séparés par des virgules, ex. 5, 10, 40) :`,
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeSpeedLabel).filter(Boolean);
      if (!batch.length) return;
      const cur = config.lineSpeeds[lineNum] || [];
      config.lineSpeeds[lineNum] = [...new Set([...cur, ...batch])].sort(
        plmSortSpeedLabels,
      );
      saveConfig(config);
      renderDescPanel();
    }

    async function delSpeedDest(lineNum) {
      const t = descState.speeds[lineNum];
      if (!t) {
        alertFn(MSG_COCHER_VITESSE);
        return;
      }
      const label = `ligne ${lineNum} — ${plmSpeedChipLabel(t)}`;
      if (!(await confirmEffacer(label))) return;
      config.lineSpeeds[lineNum] = (config.lineSpeeds[lineNum] || []).filter(
        (x) => x !== t,
      );
      delete descState.speeds[lineNum];
      saveConfig(config);
      renderDescPanel();
    }

    async function modSpeedDest(lineNum) {
      const oldT = descState.speeds[lineNum];
      if (!oldT) {
        alertFn(MSG_COCHER_VITESSE);
        return;
      }
      const label = `ligne ${lineNum} — ${plmSpeedChipLabel(oldT)}`;
      if (!(await confirmModifier(label))) return;
      const newV = await promptFn(
        "Nouvelle vitesse (chiffre seul) :",
        plmSpeedChipLabel(oldT),
      );
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      const list = config.lineSpeeds[lineNum] || [];
      config.lineSpeeds[lineNum] = list
        .map((x) => (x === oldT ? newT : x))
        .sort(plmSortSpeedLabels);
      descState.speeds[lineNum] = newT;
      saveConfig(config);
      renderDescPanel();
    }

    async function addLine() {
      const raw = await promptFn("Numéro de la nouvelle ligne :", "6");
      if (raw == null) return;
      const n = normalizeLineNum(raw);
      if (!n) return;
      if (config.lineIndexes[n]) {
        alertFn(`La ligne ${n} existe déjà.`);
        return;
      }
      config.lineIndexes[n] = [];
      saveConfig(config);
      renderDescPanel();
    }

    async function delLine() {
      const lines = getLineNums(config.lineIndexes);
      if (!lines.length) return;
      const n = normalizeLineNum(
        await promptPickOne("Ligne à supprimer :", lines, lines[0]),
      );
      if (!n) return;
      if (!(await confirmEffacer(`la ligne ${n} et toutes ses destinations`)))
        return;
      delete config.lineIndexes[n];
      delete descState.lines[n];
      saveConfig(config);
      renderDescPanel();
    }

    async function modLine() {
      const lines = getLineNums(config.lineIndexes);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Ligne à renommer :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn(
        `Nouveau numéro pour la ligne ${from} :`,
        from,
      );
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (to !== from && config.lineIndexes[to]) {
        if (
          !(await confirmFn(
            `La ligne ${to} existe déjà. Remplacer ses destinations par celles de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      renameLineInConfig(from, to, true);
      saveConfig(config);
      renderDescPanel();
    }

    async function dupLine() {
      const lines = getLineNums(config.lineIndexes);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Dupliquer la ligne :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn("Vers le numéro de ligne :", "");
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (config.lineIndexes[to]) {
        if (
          !(await confirmFn(
            `La ligne ${to} existe déjà. Écraser ses destinations par celles de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      config.lineIndexes[to] = [...(config.lineIndexes[from] || [])];
      if (descState.lines[from]) descState.lines[to] = descState.lines[from];
      saveConfig(config);
      renderDescPanel();
    }

    async function addLineDest(lineNum) {
      const raw = await promptFn(
        `Destinations à ajouter sur la ligne ${lineNum} (séparées par des virgules) :`,
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeCode).filter(Boolean);
      if (!batch.length) return;
      const cur = config.lineIndexes[lineNum] || [];
      config.lineIndexes[lineNum] = sortAlpha([
        ...new Set([...cur, ...batch]),
      ]);
      saveConfig(config);
      renderDescPanel();
    }

    async function delLineDest(lineNum) {
      const code = descState.lines[lineNum];
      if (!code) {
        alertFn(MSG_COCHER_INDES);
        return;
      }
      const label = `ligne ${lineNum} — ${code}`;
      if (!(await confirmEffacer(label))) return;
      config.lineIndexes[lineNum] = (config.lineIndexes[lineNum] || []).filter(
        (x) => x !== code,
      );
      delete descState.lines[lineNum];
      saveConfig(config);
      renderDescPanel();
    }

    async function modLineDest(lineNum) {
      const oldC = descState.lines[lineNum];
      if (!oldC) {
        alertFn(MSG_COCHER_INDES);
        return;
      }
      const label = `ligne ${lineNum} — ${oldC}`;
      if (!(await confirmModifier(label))) return;
      const newV = await promptFn("Nouvel indice (majuscules) :", oldC);
      if (newV == null || !String(newV).trim()) return;
      const newC = normalizeCode(newV);
      const list = config.lineIndexes[lineNum] || [];
      config.lineIndexes[lineNum] = sortAlpha(
        list.map((x) => (x === oldC ? newC : x)),
      );
      descState.lines[lineNum] = newC;
      saveConfig(config);
      renderDescPanel();
    }

    async function addIndirLine() {
      const raw = await promptFn(
        "Numéro de la nouvelle ligne INDIR (ex. 1, 4B) :",
        "",
      );
      if (raw == null) return;
      const n = normalizeLineNum(raw);
      if (!n) return;
      if (config.lineIndir[n]) {
        alertFn(`La ligne INDIR ${n} existe déjà.`);
        return;
      }
      config.lineIndir[n] = [];
      saveConfig(config);
      renderDescPanel();
    }

    async function delIndirLine() {
      const lines = getLineNums(config.lineIndir);
      if (!lines.length) return;
      const n = normalizeLineNum(
        await promptPickOne("Ligne INDIR à supprimer :", lines, lines[0]),
      );
      if (!n) return;
      if (
        !(await confirmEffacer(
          `la ligne INDIR ${n} et tous ses libellés`,
        ))
      ) {
        return;
      }
      delete config.lineIndir[n];
      delete descState.indir[n];
      saveConfig(config);
      renderDescPanel();
    }

    async function modIndirLine() {
      const lines = getLineNums(config.lineIndir);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Ligne INDIR à renommer :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn(
        `Nouveau numéro pour la ligne INDIR ${from} :`,
        from,
      );
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (to !== from && config.lineIndir[to]) {
        if (
          !(await confirmFn(
            `La ligne INDIR ${to} existe déjà. Remplacer ses libellés par ceux de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      if (!renameIndirLineInConfig(from, to, true)) return;
      saveConfig(config);
      renderDescPanel();
    }

    async function dupIndirLine() {
      const lines = getLineNums(config.lineIndir);
      if (!lines.length) return;
      const from = normalizeLineNum(
        await promptPickOne("Dupliquer la ligne INDIR :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn("Vers le numéro de ligne INDIR :", "");
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (config.lineIndir[to]) {
        if (
          !(await confirmFn(
            `La ligne INDIR ${to} existe déjà. Écraser ses libellés par ceux de la ligne ${from} ?`,
          ))
        ) {
          return;
        }
      }
      config.lineIndir[to] = [...(config.lineIndir[from] || [])];
      const fromSel = getIndirSelected(from);
      if (fromSel.length) setIndirSelected(to, fromSel);
      saveConfig(config);
      renderDescPanel();
    }

    async function addIndirDest(lineNum) {
      const raw = await promptFn(
        `Libellés à ajouter sur la ligne INDIR ${lineNum} (séparés par des virgules, ex. 10 m, via gare) :`,
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeIndirContent).filter(Boolean);
      if (!batch.length) return;
      const cur = config.lineIndir[lineNum] || [];
      config.lineIndir[lineNum] = [...new Set([...cur, ...batch])];
      saveConfig(config);
      renderDescPanel();
    }

    async function delIndirDest(lineNum) {
      const sel = getIndirSelected(lineNum);
      if (!sel.length) {
        alertFn(MSG_COCHER_INDIR);
        return;
      }
      const content = await pickOneFromSelected(
        `Libellé coché à retirer (ligne INDIR ${lineNum}) :`,
        sel,
        sel[0],
      );
      if (!content) return;
      const label = `ligne INDIR ${lineNum} — ${content}`;
      if (!(await confirmEffacer(label))) return;
      config.lineIndir[lineNum] = (config.lineIndir[lineNum] || []).filter(
        (x) => x !== content,
      );
      setIndirSelected(
        lineNum,
        sel.filter((x) => x !== content),
      );
      saveConfig(config);
      renderDescPanel();
    }

    async function modIndirDest(lineNum) {
      const sel = getIndirSelected(lineNum);
      if (!sel.length) {
        alertFn(MSG_COCHER_INDIR);
        return;
      }
      const oldC = await pickOneFromSelected(
        `Libellé coché à modifier (ligne INDIR ${lineNum}) :`,
        sel,
        sel[0],
      );
      if (!oldC) return;
      const label = `ligne INDIR ${lineNum} — ${oldC}`;
      if (!(await confirmModifier(label))) return;
      const newV = await promptFn("Nouveau libellé :", oldC);
      if (newV == null || !String(newV).trim()) return;
      const newC = normalizeIndirContent(newV);
      const list = config.lineIndir[lineNum] || [];
      config.lineIndir[lineNum] = list.map((x) => (x === oldC ? newC : x));
      setIndirSelected(
        lineNum,
        sel.map((x) => (x === oldC ? newC : x)),
      );
      saveConfig(config);
      renderDescPanel();
    }

    return {
      setInitial(name, description) {
        const n = String(name ?? "").trim();
        clearNamePick();
        clearCmrPick();
        if (n) {
          if (isCmrStyleNamePreset(n) && getCmrCatalogLines(n).length) {
            pickCmr(n);
          }
          if (cmrPick.kind === "none" && config.namePresets.includes(n)) {
            namePick = { kind: "preset", value: n };
          }
        }
        nameEl.value = getCommittedTitle() || "";
        legacyDescRaw = null;
        const raw = plmStripTitleFromDescriptionRaw(
          stripStructuredZmLines(String(description ?? "").trim()),
          n,
        );
        descState = parseDescription(raw, config);
        reconcileDescState();
        if (raw && !formatDescription(descState)) {
          legacyDescRaw = raw;
          descEl.value = raw;
        }
        renderNamePanel();
        renderCmrPanel();
        renderDescPanel();
        syncDescField();
      },
      getCommittedTitle,
      getCommittedName: getCommittedTitle,
      syncNameFieldFromPick() {
        syncNameFromPick();
      },
      flush() {
        syncDescField();
        if (
          legacyDescRaw != null &&
          !isDescStateEmpty() &&
          !formatDescription(descState)
        ) {
          descEl.value = legacyDescRaw;
        }
        syncNameFromPick();
      },
      destroy() {
        namePanel.innerHTML = "";
        if (speedPanel) speedPanel.innerHTML = "";
        if (cmrPanel) cmrPanel.innerHTML = "";
        if (indesPanel) indesPanel.innerHTML = "";
        if (indirPanel) indirPanel.innerHTML = "";
      },
    };
  }

  /**
   * Cases à cocher « Zones M » pour la modale zone (liste partagée avec la config locale).
   * @param {{
   *   nameEl: HTMLInputElement,
   *   panelEl: HTMLElement,
   *   prompt?: (message: string, defaultValue?: string) => Promise<string|null>,
   *   confirm?: (message: string) => Promise<boolean>,
   *   alert?: (message: string) => void,
   * }} opts
   */
  function createZoneNamePickerUi(opts) {
    const nameEl = opts.nameEl;
    const panelEl = opts.panelEl;
    const promptFn =
      opts.prompt ||
      (async (msg, def) => {
        const v = window.prompt(msg, def ?? "");
        return v == null ? null : v;
      });
    const confirmFn = opts.confirm || (async (msg) => window.confirm(msg));
    const alertFn =
      opts.alert ||
      ((msg) => {
        window.alert(msg);
      });

    const MSG_COCHER =
      "Cochez l’élément concerné, puis utilisez S, M ou D.";

    async function confirmEffacer(label) {
      return confirmFn(`Êtes-vous sûr de vouloir effacer « ${label} » ?`);
    }

    async function confirmModifier(label) {
      return confirmFn(`Êtes-vous sûr de vouloir modifier « ${label} » ?`);
    }

    let config = loadConfig();
    let zonePick = null;

    function syncNameFromPick() {
      if (zonePick) nameEl.value = zonePick;
    }

    function onNameInput() {
      const v = plmNormalizeZoneLabel(nameEl.value);
      zonePick = config.zones.includes(v) ? v : null;
      renderPanel();
    }

    function asmTools(handlers) {
      const tools = document.createElement("div");
      tools.className = "tam-plm-struct-tools tam-plm-struct-tools--asm";
      const mk = (letter, fn, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tam-plm-asm-btn";
        b.textContent = letter;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.addEventListener("click", () => void fn());
        return b;
      };
      tools.append(
        mk("A", handlers.a, "Ajouter"),
        mk("S", handlers.s, "Supprimer"),
        mk("M", handlers.m, "Modifier"),
        mk("D", handlers.d, "Dupliquer"),
      );
      return tools;
    }

    function sectionHead(title, handlers) {
      const head = document.createElement("div");
      head.className = "tam-plm-struct-section__head";
      const titleEl = document.createElement("span");
      titleEl.className = "tam-plm-struct-section__title";
      titleEl.textContent = title;
      head.appendChild(titleEl);
      head.appendChild(asmTools(handlers));
      return head;
    }

    function renderChipCheckbox(container, { id, groupName, labelText, checked, onChange }) {
      const row = document.createElement("div");
      row.className = "tam-plm-struct-chip";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      if (groupName) cb.name = groupName;
      cb.id = id;
      cb.checked = !!checked;
      cb.addEventListener("change", () => onChange(cb));
      const lbl = document.createElement("label");
      lbl.htmlFor = id;
      lbl.textContent = labelText;
      lbl.title = labelText;
      row.append(cb, lbl);
      container.appendChild(row);
    }

    function renderPanel() {
      panelEl.innerHTML = "";
      panelEl.appendChild(
        sectionHead("Zones M :", {
          a: addZone,
          s: delZone,
          m: modZone,
          d: dupZone,
        }),
      );
      const boxZ = document.createElement("div");
      boxZ.className = "tam-plm-struct-box tam-plm-struct-box--chips";
      for (const item of config.zones) {
        const labelText = String(item);
        const id = `plm-zone-name-${labelText.replace(/\W/g, "_")}`;
        renderChipCheckbox(boxZ, {
          id,
          groupName: "plm-zone-name",
          labelText,
          checked: zonePick === item,
          onChange: (cb) => {
            if (cb.checked) {
              zonePick = item;
              syncNameFromPick();
            } else if (zonePick === item) {
              zonePick = null;
              nameEl.value = "";
            }
            renderPanel();
          },
        });
      }
      panelEl.appendChild(boxZ);
    }

    async function addZone() {
      const raw = await promptFn(
        "Zones à ajouter (séparées par des virgules) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw);
      if (!batch.length) return;
      config.zones = sortAlpha([
        ...new Set(
          [...config.zones, ...batch].map((z) => plmNormalizeZoneLabel(z)),
        ),
      ]);
      saveConfig(config);
      renderPanel();
    }

    async function dupZone() {
      if (!zonePick) {
        alertFn(MSG_COCHER);
        return;
      }
      const src = zonePick;
      const newV = await promptFn("Libellé du doublon :", src);
      if (newV == null || !String(newV).trim()) return;
      const newT = plmNormalizeZoneLabel(newV);
      config.zones = sortAlpha([...new Set([...config.zones, newT])]);
      zonePick = newT;
      syncNameFromPick();
      saveConfig(config);
      renderPanel();
    }

    async function delZone() {
      if (!config.zones.length) return;
      if (!zonePick) {
        alertFn(MSG_COCHER);
        return;
      }
      const t = zonePick;
      if (!(await confirmEffacer(t))) return;
      config.zones = config.zones.filter((x) => x !== t);
      zonePick = null;
      nameEl.value = "";
      saveConfig(config);
      renderPanel();
    }

    async function modZone() {
      if (!config.zones.length) return;
      if (!zonePick) {
        alertFn(MSG_COCHER);
        return;
      }
      const oldT = zonePick;
      if (!(await confirmModifier(oldT))) return;
      const newV = await promptFn("Nouveau nom :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = plmNormalizeZoneLabel(newV);
      config.zones = sortAlpha(
        config.zones.map((x) => (x === oldT ? newT : x)),
      );
      zonePick = newT;
      syncNameFromPick();
      saveConfig(config);
      renderPanel();
    }

    nameEl.addEventListener("input", onNameInput);

    return {
      setInitial(name) {
        const n = plmNormalizeZoneLabel(name);
        nameEl.value = n;
        zonePick = config.zones.includes(n) ? n : null;
        renderPanel();
      },
      flush() {
        if (zonePick) nameEl.value = zonePick;
      },
      destroy() {
        nameEl.removeEventListener("input", onNameInput);
        panelEl.innerHTML = "";
      },
    };
  }

  function plmTitlePillHtmlString(title) {
    const full = String(title ?? "").trim();
    if (!full) return "";
    const escFull = plmEscapeHtmlForDisplay(full);
    if (isCmrStyleNamePreset(full)) {
      const lines = plmCmrCatalogLinesForName(full, loadConfig());
      if (
        lines.length &&
        typeof window.tamPlmCmrTitlePillInlineStyle === "function"
      ) {
        const st = window.tamPlmCmrTitlePillInlineStyle(lines);
        if (st) {
          const multiCls =
            lines.length > 1
              ? " tam-plm-desc-title-pill--cmr-multi"
              : "";
          return `<span class="tam-plm-desc-title-pill tam-plm-desc-title-pill--cmr${multiCls}" style="${st}" title="${escFull}" data-plm-cmr-lines="${plmEscapeHtmlForDisplay(lines.join(","))}">${escFull}</span>`;
        }
      }
    }
    return `<span class="tam-plm-desc-title-pill" title="${escFull}">${escFull}</span>`;
  }

  function plmEscapeHtmlForDisplay(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function plmLinePillHtmlString(num, label) {
    const text = `${num}: ${label}`;
    const style =
      typeof window.tamPlmLinePillInlineStyle === "function"
        ? window.tamPlmLinePillInlineStyle(num)
        : "display:inline-block;padding:2px 8px;border-radius:6px;font-weight:600;background:#e8ecf1;color:#1b1f24;border:1px solid #ccd3db;white-space:nowrap";
    return `<span class="tam-plm-desc-line-pill tam-plm-map-desc-pill" style="${style}" title="${plmEscapeHtmlForDisplay(text)}">${plmEscapeHtmlForDisplay(text)}</span>`;
  }

  function plmSegmentsFromSectionLine(state, kind) {
    const line = plmFormatSectionLine(state, kind);
    if (!line) return [];
    const segs = [];
    for (const bit of splitPlmStructuralList(line)) {
      const seg = parsePlmLineSegmentRaw(bit);
      if (seg) {
        segs.push({
          num: seg.num,
          label: plmUnquoteUserToken(seg.rawValue),
        });
      } else {
        const label = plmUnquoteUserToken(bit).trim();
        if (label) segs.push({ num: null, label });
      }
    }
    return segs;
  }

  function plmBuildPillsRowHtmlString(segments) {
    if (!segments.length) return "";
    const parts = segments.map((seg) => {
      if (seg.num) return plmLinePillHtmlString(seg.num, seg.label);
      return `<span class="tam-plm-map-desc-pill tam-plm-map-desc-pill--plain">${plmEscapeHtmlForDisplay(seg.label)}</span>`;
    });
    return `<div class="tam-plm-map-desc-row">${parts.join("")}</div>`;
  }

  /** HTML description structurée (pastilles couleur) pour libellés carte repère. */
  function buildDescriptionDisplayHtml(text) {
    const raw = String(text ?? "").trim();
    if (!raw) return "";

    const state = parseDescription(raw, loadConfig());
    const hasStructured =
      plmSectionHasContent(state, "v") ||
      plmSectionHasContent(state, "lines") ||
      plmSectionHasContent(state, "indir");

    if (!hasStructured) {
      return plmEscapeHtmlForDisplay(raw).replace(/\n/g, "<br>");
    }

    const rows = [];
    for (const kind of plmEffectiveSectionOrder(state)) {
      if (kind === "v" || kind === "lines") {
        const row = plmBuildPillsRowHtmlString(
          plmSegmentsFromSectionLine(state, kind),
        );
        if (row) rows.push(row);
      } else if (kind === "indir") {
        const segs = Object.keys(state.indir)
          .filter(
            (n) =>
              normalizeLineNum(n) &&
              asPlmMultiArray(state.indir[n]).length,
          )
          .sort(plmSortLineKeys)
          .map((n) => ({
            num: n,
            label: joinPlmIndirMulti(asPlmMultiArray(state.indir[n])),
          }));
        const row = plmBuildPillsRowHtmlString(segs);
        if (row) rows.push(row);
      }
    }
    return rows.join("");
  }

  window.plmParseStructuredDescription = parseDescription;
  window.plmFormatStructuredDescription = formatDescription;
  window.plmBuildDescriptionDisplayHtml = buildDescriptionDisplayHtml;
  window.plmTitlePillHtmlString = plmTitlePillHtmlString;
  window.plmCmrCatalogLinesForName = plmCmrCatalogLinesForName;
  window.plmStripTitleFromDescriptionRaw = plmStripTitleFromDescriptionRaw;
  window.plmCreateStructuredTextUi = createStructuredTextUi;
  window.plmCreateZoneNamePickerUi = createZoneNamePickerUi;
})();
