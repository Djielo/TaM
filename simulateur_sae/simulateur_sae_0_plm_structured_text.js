/**
 * Repères personnels : description structurée (vitesses, INDES, INDIRE) et noms enregistrés.
 * Chargé avant simulateur_sae_1_state_mission.js
 */
(function () {
  "use strict";

  const LS_KEY = "tam_plm_structured_text_config_v1";
  const DEFAULT_LINE_NUMS = ["1", "2", "3", "4", "5"];
  const DEFAULT_INDEXES = ["MA", "OB", "RO", "PL", "SA", "LB", "H4"];

  const DEFAULT_CONFIG = {
    speeds: ["10km/h", "15km/h", "40km/h"],
    lineIndexes: {
      1: [...DEFAULT_INDEXES],
      2: [...DEFAULT_INDEXES],
      3: [...DEFAULT_INDEXES],
      4: [...DEFAULT_INDEXES],
      5: [...DEFAULT_INDEXES],
    },
    /** Lignes INDIR : libellés libres par numéro (1, 2, 4B, …), vide au départ. */
    lineIndir: {},
    zones: ["Gare", "Moularès"],
    namePresets: [],
  };

  function cloneDefaults() {
    return {
      speeds: [...DEFAULT_CONFIG.speeds],
      lineIndexes: Object.fromEntries(
        DEFAULT_LINE_NUMS.map((n) => [n, [...DEFAULT_CONFIG.lineIndexes[n]]]),
      ),
      lineIndir: {},
      zones: [...DEFAULT_CONFIG.zones],
      namePresets: [],
    };
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

  /** Entre vitesses ou entre entrées « numéro : … » (ex. 50 km/h, 2: CO, 1: LB). */
  const PLM_LIST_SEP = ", ";

  /** Entre plusieurs libellés INDIRE sur une même ligne (ex. 2: D-G-TD). */
  const PLM_INDIR_MULTI_SEP = "-";

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
    return s
      .split(",")
      .map((p) => normalizeSpeedLabel(p))
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

  /** Extrait numéro de ligne + valeur brute (INDES / INDIRE). */
  function parsePlmLineSegmentRaw(bit) {
    const b = String(bit ?? "").trim();
    if (!b) return null;
    let m = b.match(/^(\d+[A-Za-z]?)\s*:\s*(.+)$/);
    if (!m) m = b.match(/^(\d+[A-Za-z]?)\s*-\s*(.+)$/);
    if (!m) return null;
    const num = normalizeLineNum(m[1]);
    const rawValue = String(m[2] ?? "").trim();
    return num && rawValue ? { num, rawValue } : null;
  }

  function resolveLineSegment(num, rawValue, config) {
    const val = String(rawValue ?? "").trim();
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
    const b = String(bit ?? "").trim();
    if (!b || parsePlmLineSegmentRaw(b)) return [];
    if (/^(\d+[A-Za-z]?)\s*[:\-]/.test(b)) return [];
    if (/km\s*\/?\s*h/i.test(b) && b.includes(PLM_INDIR_MULTI_SEP)) {
      return splitPlmIndirMulti(b)
        .map((p) => normalizeSpeedLabel(p))
        .filter(Boolean);
    }
    const one = normalizeSpeedLabel(b);
    return one ? [one] : [];
  }

  function normalizeSpeedLabel(raw) {
    return String(raw ?? "")
      .trim()
      .replace(/\s*km\s*\/\s*h/gi, "km/h")
      .replace(/(\d)\s+(?=km)/gi, "$1");
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
    const n = String(raw ?? "")
      .trim()
      .toUpperCase();
    return /^\d+[A-Z]?$/.test(n) ? n : "";
  }

  function getLineNums(lineIndexes) {
    return Object.keys(lineIndexes || {})
      .filter((k) => normalizeLineNum(k))
      .sort((a, b) => {
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
      if (Array.isArray(p.speeds) && p.speeds.length) {
        base.speeds = p.speeds.map(normalizeSpeedLabel).filter(Boolean);
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
      return base;
    } catch (e) {
      return cloneDefaults();
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({
          speeds: cfg.speeds,
          lineIndexes: cfg.lineIndexes,
          lineIndir: cfg.lineIndir,
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
    return { v: [], lines: {}, indir: {} };
  }

  /** Retire les lignes ZM: héritées (zones gérées dans la modale zone). */
  function stripStructuredZmLines(text) {
    return String(text ?? "")
      .split(/\r?\n/)
      .filter((line) => !/^ZM\s*:/i.test(line.trim()))
      .join("\n")
      .trim();
  }

  function parseDescription(text, config) {
    const state = emptyDescState();
    const cfg = config || loadConfig();
    const body = stripStructuredZmLines(text);
    if (!body) return state;

    const parts = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const line = stripLegacyDescLinePrefix(rawLine.trim());
      if (!line || /^ZM\s*:/i.test(line)) continue;
      parts.push(...line.split(",").map((p) => p.trim()).filter(Boolean));
    }

    for (const bit of parts) {
      const lineSeg = parsePlmLineSegmentRaw(bit);
      if (lineSeg) {
        const resolved = resolveLineSegment(lineSeg.num, lineSeg.rawValue, cfg);
        if (resolved?.kind === "indes") state.lines[resolved.num] = resolved.code;
        else if (resolved?.kind === "indir" && resolved.values?.length) {
          state.indir[resolved.num] = resolved.values;
        }
        continue;
      }
      state.v.push(...parseSpeedTokens(bit));
    }
    state.v = [...new Set(state.v.map(normalizeSpeedLabel).filter(Boolean))];
    return state;
  }

  function formatDescription(state) {
    const sortLineKeys = (a, b) => {
      const na = parseInt(a, 10);
      const nb = parseInt(b, 10);
      if (na !== nb) return na - nb;
      return a.localeCompare(b);
    };
    const chunks = [];
    chunks.push(...asPlmSpeedArray(state.v));
    for (const n of Object.keys(state.lines)
      .filter((k) => normalizeLineNum(k) && state.lines[k])
      .sort(sortLineKeys)) {
      chunks.push(`${n}: ${state.lines[n]}`);
    }
    for (const n of Object.keys(state.indir)
      .filter((k) => normalizeLineNum(k) && asPlmMultiArray(state.indir[k]).length)
      .sort(sortLineKeys)) {
      chunks.push(
        `${n}: ${joinPlmIndirMulti(asPlmMultiArray(state.indir[n]))}`,
      );
    }
    return joinPlmList(chunks);
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
   *   descPanel: HTMLElement,
   *   descPreview: HTMLElement,
   *   prompt?: (message: string, defaultValue?: string) => Promise<string|null>,
   *   confirm?: (message: string) => Promise<boolean>,
   *   alert?: (message: string) => void,
   *   onNameActiveChange?: (hasName: boolean) => void,
   * }} opts
   */
  function createStructuredTextUi(opts) {
    const nameEl = opts.nameEl;
    const descEl = opts.descEl;
    const namePanel = opts.namePanel;
    const descPanel = opts.descPanel;
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
    const onNameActiveChange = opts.onNameActiveChange;

    function notifyNameActive() {
      if (!onNameActiveChange) return;
      onNameActiveChange(String(nameEl.value || "").trim().length > 0);
    }

    const MSG_COCHER =
      "Cochez l’élément concerné, puis utilisez S, M ou D.";
    const MSG_COCHER_INDES =
      "Cochez la destination sur cette ligne, puis utilisez S ou M.";
    const MSG_COCHER_INDIRE =
      "Cochez un ou plusieurs libellés sur cette ligne INDIRE, puis utilisez S ou M.";

    function getVSelected() {
      return asPlmSpeedArray(descState.v);
    }

    function setVSelected(arr) {
      descState.v = arr.length ? [...arr] : [];
    }

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
      descState.v = asPlmSpeedArray(descState.v);
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
    let namePick = { kind: "manual" };
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

    function syncDescField() {
      if (legacyDescRaw != null) return;
      const text = formatDescription(descState);
      descEl.value = text;
      if (descPreview) {
        descPreview.textContent = text;
        descPreview.dataset.empty = text ? "0" : "1";
      }
    }

    function syncNameFromPick() {
      if (namePick.kind === "preset" && namePick.value) {
        nameEl.value = namePick.value;
      }
    }

    function onNameInput() {
      const v = String(nameEl.value || "").trim();
      if (config.namePresets.includes(v)) {
        namePick = { kind: "preset", value: v };
      } else namePick = { kind: "manual" };
      renderNamePanel();
      notifyNameActive();
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
          namePick = { kind: "preset", value: preset };
          syncNameFromPick();
          notifyNameActive();
        } else if (
          namePick.kind === "preset" &&
          namePick.value === preset
        ) {
          namePick = { kind: "manual" };
          nameEl.value = "Groupe";
          notifyNameActive();
        }
        renderNamePanel();
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
        sectionHead("Nom :", {
          a: addNamePreset,
          s: delNamePreset,
          m: modNamePreset,
          d: dupNamePreset,
        }),
      );

      if (config.namePresets.length) {
        const { standard, cmr } = partitionNamePresets(config.namePresets);
        const groups = document.createElement("div");
        groups.className = "tam-plm-name-preset-groups";
        if (standard.length) {
          appendNamePresetBox(groups, standard);
        }
        if (standard.length && cmr.length) {
          appendNamePresetDivider(groups);
        }
        if (cmr.length) {
          appendNamePresetBox(groups, cmr);
        }
        namePanel.appendChild(groups);
      }
    }

    async function addNamePreset() {
      const raw = await promptFn(
        "Noms à ajouter (séparés par des virgules, ex. Auto, CMU Hornière) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw);
      if (!batch.length) return;
      config.namePresets = sortNamePresets([
        ...new Set([...config.namePresets, ...batch]),
      ]);
      saveConfig(config);
      renderNamePanel();
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
      namePick = { kind: "manual" };
      nameEl.value = "Groupe";
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

    function renderDescPanel() {
      descPanel.innerHTML = "";

      const secV = document.createElement("section");
      secV.className = "tam-plm-struct-section";
      secV.appendChild(
        sectionHead("Vitesse :", {
          a: addSpeed,
          s: delSpeed,
          m: modSpeed,
          d: dupSpeed,
        }),
      );
      const boxV = document.createElement("div");
      boxV.className = "tam-plm-struct-box tam-plm-struct-box--chips";
      const vSelected = getVSelected();
      for (const item of config.speeds) {
        const id = `plm-v-${String(item).replace(/\W/g, "_")}`;
        renderChipCheckbox(boxV, {
          id,
          labelText: item,
          checked: vSelected.includes(item),
          onChange: (cb) => {
            clearLegacyDesc();
            let sel = getVSelected();
            if (cb.checked) {
              if (!sel.includes(item)) sel = [...sel, item];
            } else {
              sel = sel.filter((x) => x !== item);
            }
            setVSelected(sel);
            syncDescField();
          },
        });
      }
      secV.appendChild(boxV);
      descPanel.appendChild(secV);

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
              clearLegacyDesc();
              if (cb.checked) descState.lines[num] = code;
              else if (descState.lines[num] === code) {
                delete descState.lines[num];
              }
              syncDescField();
              renderDescPanel();
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
      descPanel.appendChild(secL);

      const secIndir = document.createElement("section");
      secIndir.className = "tam-plm-struct-section";
      secIndir.appendChild(
        sectionHead("Lignes (INDIRE) :", {
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
          "Aucune ligne INDIRE : utilisez A pour ajouter 1, 2, 3, 4B, 5, etc.";
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
              clearLegacyDesc();
              let sel = getIndirSelected(num);
              if (cb.checked) {
                if (!sel.includes(entry)) sel = [...sel, entry];
              } else {
                sel = sel.filter((x) => x !== entry);
              }
              setIndirSelected(num, sel);
              syncDescField();
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
      descPanel.appendChild(secIndir);

      syncDescField();
    }

    async function addSpeed() {
      const raw = await promptFn(
        "Vitesses à ajouter (séparées par des virgules, ex. 10km/h, 25km/h) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeSpeedLabel);
      if (!batch.length) return;
      config.speeds = sortAlpha([...new Set([...config.speeds, ...batch])]);
      saveConfig(config);
      renderDescPanel();
    }

    async function dupSpeed() {
      const sel = getVSelected();
      if (!sel.length) {
        alertFn(MSG_COCHER);
        return;
      }
      const src = await pickOneFromSelected(
        "Vitesse à dupliquer dans le catalogue :",
        sel,
        sel[0],
      );
      if (!src) return;
      const newV = await promptFn("Libellé du doublon :", src);
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      config.speeds = sortAlpha([...new Set([...config.speeds, newT])]);
      setVSelected([newT]);
      saveConfig(config);
      renderDescPanel();
    }

    async function delSpeed() {
      if (!config.speeds.length) return;
      const sel = getVSelected();
      if (!sel.length) {
        alertFn(MSG_COCHER);
        return;
      }
      const t = await pickOneFromSelected(
        "Vitesse à retirer du catalogue :",
        sel,
        sel[0],
      );
      if (!t) return;
      if (!(await confirmEffacer(t))) return;
      config.speeds = config.speeds.filter((x) => x !== t);
      setVSelected(sel.filter((x) => x !== t));
      saveConfig(config);
      renderDescPanel();
    }

    async function modSpeed() {
      if (!config.speeds.length) return;
      const sel = getVSelected();
      if (!sel.length) {
        alertFn(MSG_COCHER);
        return;
      }
      const oldT = await pickOneFromSelected(
        "Vitesse à modifier :",
        sel,
        sel[0],
      );
      if (!oldT) return;
      if (!(await confirmModifier(oldT))) return;
      const newV = await promptFn("Nouveau libellé :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      config.speeds = sortAlpha(
        config.speeds.map((x) => (x === oldT ? newT : x)),
      );
      setVSelected(sel.map((x) => (x === oldT ? newT : x)));
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
        "Numéro de la nouvelle ligne INDIRE (ex. 1, 4B) :",
        "",
      );
      if (raw == null) return;
      const n = normalizeLineNum(raw);
      if (!n) return;
      if (config.lineIndir[n]) {
        alertFn(`La ligne INDIRE ${n} existe déjà.`);
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
        await promptPickOne("Ligne INDIRE à supprimer :", lines, lines[0]),
      );
      if (!n) return;
      if (
        !(await confirmEffacer(
          `la ligne INDIRE ${n} et tous ses libellés`,
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
        await promptPickOne("Ligne INDIRE à renommer :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn(
        `Nouveau numéro pour la ligne INDIRE ${from} :`,
        from,
      );
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (to !== from && config.lineIndir[to]) {
        if (
          !(await confirmFn(
            `La ligne INDIRE ${to} existe déjà. Remplacer ses libellés par ceux de la ligne ${from} ?`,
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
        await promptPickOne("Dupliquer la ligne INDIRE :", lines, lines[0]),
      );
      if (!from) return;
      const rawTo = await promptFn("Vers le numéro de ligne INDIRE :", "");
      if (rawTo == null) return;
      const to = normalizeLineNum(rawTo);
      if (!to) return;
      if (config.lineIndir[to]) {
        if (
          !(await confirmFn(
            `La ligne INDIRE ${to} existe déjà. Écraser ses libellés par ceux de la ligne ${from} ?`,
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
        `Libellés à ajouter sur la ligne INDIRE ${lineNum} (séparés par des virgules, ex. 10 m, via gare) :`,
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
        alertFn(MSG_COCHER_INDIRE);
        return;
      }
      const content = await pickOneFromSelected(
        `Libellé coché à retirer (ligne INDIRE ${lineNum}) :`,
        sel,
        sel[0],
      );
      if (!content) return;
      const label = `ligne INDIRE ${lineNum} — ${content}`;
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
        alertFn(MSG_COCHER_INDIRE);
        return;
      }
      const oldC = await pickOneFromSelected(
        `Libellé coché à modifier (ligne INDIRE ${lineNum}) :`,
        sel,
        sel[0],
      );
      if (!oldC) return;
      const label = `ligne INDIRE ${lineNum} — ${oldC}`;
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

    nameEl.addEventListener("input", onNameInput);

    return {
      setInitial(name, description) {
        const n = String(name ?? "").trim();
        if (config.namePresets.includes(n)) {
          namePick = { kind: "preset", value: n };
        } else namePick = { kind: "manual" };
        nameEl.value = n;
        legacyDescRaw = null;
        const raw = stripStructuredZmLines(String(description ?? "").trim());
        descState = parseDescription(raw, config);
        reconcileDescState();
        if (raw && !formatDescription(descState)) {
          legacyDescRaw = raw;
          descEl.value = raw;
          if (descPreview) {
            descPreview.textContent = raw;
            descPreview.dataset.empty = "0";
          }
        }
        renderNamePanel();
        renderDescPanel();
        notifyNameActive();
      },
      getCommittedName() {
        if (namePick.kind === "preset" && namePick.value) {
          return String(namePick.value).trim();
        }
        return String(nameEl.value || "").trim();
      },
      syncNameFieldFromPick() {
        syncNameFromPick();
      },
      flush(opts) {
        syncDescField();
        if (legacyDescRaw != null && !formatDescription(descState)) {
          descEl.value = legacyDescRaw;
        }
        if (!opts?.hideName && namePick.kind === "preset" && namePick.value) {
          nameEl.value = namePick.value;
        }
      },
      destroy() {
        nameEl.removeEventListener("input", onNameInput);
        namePanel.innerHTML = "";
        descPanel.innerHTML = "";
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

  window.plmParseStructuredDescription = parseDescription;
  window.plmFormatStructuredDescription = formatDescription;
  window.plmCreateStructuredTextUi = createStructuredTextUi;
  window.plmCreateZoneNamePickerUi = createZoneNamePickerUi;
})();
