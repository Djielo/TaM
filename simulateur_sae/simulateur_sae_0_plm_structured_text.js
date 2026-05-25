/**
 * Repères personnels : description structurée (V / L / ZM) et noms enregistrés.
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
    zones: ["Gare", "Moularès"],
    namePresets: [],
  };

  function cloneDefaults() {
    return {
      speeds: [...DEFAULT_CONFIG.speeds],
      lineIndexes: Object.fromEntries(
        DEFAULT_LINE_NUMS.map((n) => [n, [...DEFAULT_CONFIG.lineIndexes[n]]]),
      ),
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
    return { v: null, lines: {}, zm: null };
  }

  function parseDescription(text) {
    const state = emptyDescState();
    const lines = String(text ?? "").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^V\s*:/i.test(line)) {
        state.v = line.replace(/^V\s*:/i, "").trim() || null;
        continue;
      }
      if (/^ZM\s*:/i.test(line)) {
        state.zm = line.replace(/^ZM\s*:/i, "").trim() || null;
        continue;
      }
      if (/^L\s*:/i.test(line)) {
        const body = line.replace(/^L\s*:/i, "").trim();
        for (const part of body.split(",")) {
          const bit = part.trim();
          const m = bit.match(/^(\d+[A-Za-z]?)\s*-\s*([A-Za-z0-9]+)$/);
          if (m) {
            const num = normalizeLineNum(m[1]);
            const code = normalizeCode(m[2]);
            if (num && code) state.lines[num] = code;
          }
        }
      }
    }
    return state;
  }

  function formatDescription(state) {
    const out = [];
    if (state.v) out.push(`V: ${state.v}`);
    const lineParts = Object.keys(state.lines)
      .filter((n) => normalizeLineNum(n) && state.lines[n])
      .sort((a, b) => {
        const na = parseInt(a, 10);
        const nb = parseInt(b, 10);
        if (na !== nb) return na - nb;
        return a.localeCompare(b);
      })
      .map((n) => `${n}-${state.lines[n]}`);
    if (lineParts.length) out.push(`L: ${lineParts.join(", ")}`);
    if (state.zm) out.push(`ZM: ${state.zm}`);
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
   *   descPanel: HTMLElement,
   *   descPreview: HTMLElement,
   *   prompt?: (message: string, defaultValue?: string) => Promise<string|null>,
   *   confirm?: (message: string) => Promise<boolean>,
   *   alert?: (message: string) => void,
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

    const MSG_COCHER =
      "Cochez l’élément concerné, puis utilisez S, M ou D.";
    const MSG_COCHER_INDES =
      "Cochez la destination sur cette ligne, puis utilisez S ou M.";

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
        } else if (
          namePick.kind === "preset" &&
          namePick.value === preset
        ) {
          namePick = { kind: "manual" };
          nameEl.value = "Groupe";
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
      renderRadioGroup({
        container: boxV,
        groupName: "plm-v",
        items: config.speeds,
        selected: descState.v,
        onSelect: (item) => {
          clearLegacyDesc();
          descState.v = item || null;
          syncDescField();
        },
      });
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

      const secZ = document.createElement("section");
      secZ.className = "tam-plm-struct-section";
      secZ.appendChild(
        sectionHead("Zones M :", {
          a: addZone,
          s: delZone,
          m: modZone,
          d: dupZone,
        }),
      );
      const boxZ = document.createElement("div");
      boxZ.className = "tam-plm-struct-box tam-plm-struct-box--chips";
      renderRadioGroup({
        container: boxZ,
        groupName: "plm-zm",
        items: config.zones,
        selected: descState.zm,
        onSelect: (item) => {
          clearLegacyDesc();
          descState.zm = item || null;
          syncDescField();
        },
      });
      secZ.appendChild(boxZ);
      descPanel.appendChild(secZ);

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
      if (!descState.v) {
        alertFn(MSG_COCHER);
        return;
      }
      const src = descState.v;
      const newV = await promptFn("Libellé du doublon :", src);
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      config.speeds = sortAlpha([...new Set([...config.speeds, newT])]);
      descState.v = newT;
      saveConfig(config);
      renderDescPanel();
    }

    async function delSpeed() {
      if (!config.speeds.length) return;
      if (!descState.v) {
        alertFn(MSG_COCHER);
        return;
      }
      const t = descState.v;
      if (!(await confirmEffacer(t))) return;
      config.speeds = config.speeds.filter((x) => x !== t);
      descState.v = null;
      saveConfig(config);
      renderDescPanel();
    }

    async function modSpeed() {
      if (!config.speeds.length) return;
      if (!descState.v) {
        alertFn(MSG_COCHER);
        return;
      }
      const oldT = descState.v;
      if (!(await confirmModifier(oldT))) return;
      const newV = await promptFn("Nouveau libellé :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      config.speeds = sortAlpha(
        config.speeds.map((x) => (x === oldT ? newT : x)),
      );
      descState.v = newT;
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
      renderDescPanel();
    }

    async function dupZone() {
      if (!descState.zm) {
        alertFn(MSG_COCHER);
        return;
      }
      const src = descState.zm;
      const newV = await promptFn("Libellé du doublon :", src);
      if (newV == null || !String(newV).trim()) return;
      const newT = plmNormalizeZoneLabel(newV);
      config.zones = sortAlpha([...new Set([...config.zones, newT])]);
      descState.zm = newT;
      saveConfig(config);
      renderDescPanel();
    }

    async function delZone() {
      if (!config.zones.length) return;
      if (!descState.zm) {
        alertFn(MSG_COCHER);
        return;
      }
      const t = descState.zm;
      if (!(await confirmEffacer(t))) return;
      config.zones = config.zones.filter((x) => x !== t);
      descState.zm = null;
      saveConfig(config);
      renderDescPanel();
    }

    async function modZone() {
      if (!config.zones.length) return;
      if (!descState.zm) {
        alertFn(MSG_COCHER);
        return;
      }
      const oldT = descState.zm;
      if (!(await confirmModifier(oldT))) return;
      const newV = await promptFn("Nouveau nom :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = plmNormalizeZoneLabel(newV);
      config.zones = sortAlpha(
        config.zones.map((x) => (x === oldT ? newT : x)),
      );
      descState.zm = newT;
      saveConfig(config);
      renderDescPanel();
    }

    function migrateZoneLabelsInState() {
      if (descState.zm === "Moulares") descState.zm = "Moularès";
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
        const raw = String(description ?? "").trim();
        descState = parseDescription(raw);
        migrateZoneLabelsInState();
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
      },
      flush() {
        syncDescField();
        if (legacyDescRaw != null && !formatDescription(descState)) {
          descEl.value = legacyDescRaw;
        }
        if (namePick.kind === "preset" && namePick.value) {
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

  window.plmParseStructuredDescription = parseDescription;
  window.plmFormatStructuredDescription = formatDescription;
  window.plmCreateStructuredTextUi = createStructuredTextUi;
})();
