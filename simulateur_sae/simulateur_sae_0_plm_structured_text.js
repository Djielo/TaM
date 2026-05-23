/**
 * Repères personnels : description structurée (V / L / ZM) et presets nom (G, CMU).
 * Chargé avant simulateur_sae_1_state_mission.js
 */
(function () {
  "use strict";

  const LS_KEY = "tam_plm_structured_text_config_v1";
  const LINE_NUMS = ["1", "2", "3", "4", "5"];
  const DEFAULT_INDEXES = ["MA", "OB", "RO", "PL", "SA", "LB", "H4"];

  const DEFAULT_CONFIG = {
    speeds: ["10 km/h", "15 km/h", "40 km/h"],
    lineIndexes: {
      1: [...DEFAULT_INDEXES],
      2: [...DEFAULT_INDEXES],
      3: [...DEFAULT_INDEXES],
      4: [...DEFAULT_INDEXES],
      5: [...DEFAULT_INDEXES],
    },
    zones: ["Gare", "Moularès"],
    cmu: [],
  };

  function cloneDefaults() {
    return {
      speeds: [...DEFAULT_CONFIG.speeds],
      lineIndexes: Object.fromEntries(
        LINE_NUMS.map((n) => [n, [...DEFAULT_CONFIG.lineIndexes[n]]]),
      ),
      zones: [...DEFAULT_CONFIG.zones],
      cmu: [],
    };
  }

  function normalizeCode(raw) {
    return String(raw ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function normalizeSpeedLabel(raw) {
    return String(raw ?? "").trim();
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
        for (const n of LINE_NUMS) {
          const list = p.lineIndexes[n];
          if (Array.isArray(list) && list.length) {
            base.lineIndexes[n] = sortAlpha(
              [...new Set(list.map(normalizeCode).filter(Boolean))],
            );
          }
        }
      }
      if (Array.isArray(p.zones) && p.zones.length) {
        base.zones = sortAlpha(
          [
            ...new Set(
              p.zones
                .map((z) => plmNormalizeZoneLabel(String(z).trim()))
                .filter(Boolean),
            ),
          ],
        );
      }
      if (Array.isArray(p.cmu)) {
        base.cmu = sortAlpha(
          [...new Set(p.cmu.map((z) => String(z).trim()).filter(Boolean))],
        );
      }
      return base;
    } catch (e) {
      return cloneDefaults();
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch (e) {
      // ignore
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
          const m = bit.match(/^(\d)\s*-\s*([A-Za-z0-9]+)$/);
          if (m) {
            const num = m[1];
            const code = normalizeCode(m[2]);
            if (LINE_NUMS.includes(num) && code) state.lines[num] = code;
          }
        }
      }
    }
    return state;
  }

  function formatDescription(state) {
    const out = [];
    if (state.v) out.push(`V: ${state.v}`);
    const lineParts = LINE_NUMS.filter((n) => state.lines[n]).map(
      (n) => `${n}-${state.lines[n]}`,
    );
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
    const confirmFn =
      opts.confirm ||
      (async (msg) => window.confirm(msg));

    let config = loadConfig();
    let descState = emptyDescState();
    let namePick = { kind: "manual" };
    /** Description libre héritée tant qu’aucune case structurée n’est utilisée. */
    let legacyDescRaw = null;

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
      if (namePick.kind === "cmu" && namePick.value) nameEl.value = namePick.value;
    }

    function onNameInput() {
      const v = String(nameEl.value || "").trim();
      if (config.cmu.includes(v)) namePick = { kind: "cmu", value: v };
      else namePick = { kind: "manual" };
      renderNamePanel();
    }

    function renderNamePanel() {
      namePanel.innerHTML = "";
      const head = document.createElement("div");
      head.className = "tam-plm-struct-section__head";
      head.innerHTML =
        '<span class="tam-plm-struct-section__title">CMU</span>';
      const tools = document.createElement("div");
      tools.className = "tam-plm-struct-tools";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tam-plm-struct-tool-btn";
      addBtn.textContent = "Ajouter";
      addBtn.addEventListener("click", () => void addCmu());
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tam-plm-struct-tool-btn";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => void delCmu());
      const modBtn = document.createElement("button");
      modBtn.type = "button";
      modBtn.className = "tam-plm-struct-tool-btn";
      modBtn.textContent = "Modifier";
      modBtn.addEventListener("click", () => void modCmu());
      tools.append(addBtn, delBtn, modBtn);
      head.appendChild(tools);
      namePanel.appendChild(head);

      if (config.cmu.length) {
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box";
        for (const cmu of config.cmu) {
          const row = document.createElement("div");
          row.className = "tam-plm-struct-checkrow";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          const cid = `plm-cmu-${cmu.replace(/\W/g, "_")}`;
          cb.id = cid;
          cb.checked = namePick.kind === "cmu" && namePick.value === cmu;
          cb.addEventListener("change", () => {
            if (cb.checked) {
              namePick = { kind: "cmu", value: cmu };
              syncNameFromPick();
            } else if (namePick.kind === "cmu" && namePick.value === cmu) {
              namePick = { kind: "manual" };
            }
            renderNamePanel();
          });
          const lbl = document.createElement("label");
          lbl.htmlFor = cid;
          lbl.textContent = cmu;
          row.append(cb, lbl);
          box.appendChild(row);
        }
        namePanel.appendChild(box);
      }
    }

    async function addCmu() {
      const raw = await promptFn(
        "Noms CMU à ajouter (séparés par des virgules) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw);
      if (!batch.length) return;
      config.cmu = sortAlpha([...new Set([...config.cmu, ...batch])]);
      saveConfig(config);
      renderNamePanel();
    }

    async function delCmu() {
      if (!config.cmu.length) return;
      const raw = await promptFn(
        `CMU à supprimer (texte exact) :\n${config.cmu.join(", ")}`,
        "",
      );
      if (raw == null || !String(raw).trim()) return;
      const t = String(raw).trim();
      if (!(await confirmFn(`Supprimer la CMU « ${t} » ?`))) return;
      config.cmu = config.cmu.filter((x) => x !== t);
      if (namePick.kind === "cmu" && namePick.value === t) {
        namePick = { kind: "manual" };
        nameEl.value = "";
      }
      saveConfig(config);
      renderNamePanel();
    }

    async function modCmu() {
      if (!config.cmu.length) return;
      const oldV = await promptFn(
        `CMU à renommer :\n${config.cmu.join(", ")}`,
        "",
      );
      if (oldV == null || !String(oldV).trim()) return;
      const oldT = String(oldV).trim();
      if (!config.cmu.includes(oldT)) return;
      const newV = await promptFn("Nouveau nom :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = String(newV).trim();
      config.cmu = sortAlpha(
        config.cmu.map((x) => (x === oldT ? newT : x)),
      );
      if (namePick.kind === "cmu" && namePick.value === oldT) {
        namePick = { kind: "cmu", value: newT };
        syncNameFromPick();
      }
      saveConfig(config);
      renderNamePanel();
    }

    function sectionTools(onAdd, onDel, onMod) {
      const tools = document.createElement("div");
      tools.className = "tam-plm-struct-tools";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tam-plm-struct-tool-btn";
      addBtn.textContent = "Ajouter";
      addBtn.addEventListener("click", () => void onAdd());
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "tam-plm-struct-tool-btn";
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => void onDel());
      const modBtn = document.createElement("button");
      modBtn.type = "button";
      modBtn.className = "tam-plm-struct-tool-btn";
      modBtn.textContent = "Modifier";
      modBtn.addEventListener("click", () => void onMod());
      tools.append(addBtn, delBtn, modBtn);
      return tools;
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
        const row = document.createElement("div");
        row.className = "tam-plm-struct-checkrow";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = groupName;
        const id = `${groupName}-${String(item).replace(/\W/g, "_")}`;
        cb.id = id;
        const labelText = formatLabel ? formatLabel(item) : String(item);
        cb.checked = selected === labelText || selected === item;
        cb.addEventListener("change", () => {
          if (cb.checked) onSelect(item, labelText);
          else onSelect(null, null);
          renderDescPanel();
        });
        const lbl = document.createElement("label");
        lbl.htmlFor = id;
        lbl.textContent = labelText;
        row.append(cb, lbl);
        container.appendChild(row);
      }
    }

    function renderDescPanel() {
      descPanel.innerHTML = "";

      const secV = document.createElement("section");
      secV.className = "tam-plm-struct-section";
      const headV = document.createElement("div");
      headV.className = "tam-plm-struct-section__head";
      headV.innerHTML =
        '<span class="tam-plm-struct-section__title">Vitesse</span>';
      secV.appendChild(headV);
      secV.appendChild(
        sectionTools(addSpeed, delSpeed, modSpeed),
      );
      const boxV = document.createElement("div");
      boxV.className = "tam-plm-struct-box";
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
      const headL = document.createElement("div");
      headL.className = "tam-plm-struct-section__head";
      headL.innerHTML =
        '<span class="tam-plm-struct-section__title">Lignes (INDES)</span>';
      secL.appendChild(headL);
      secL.appendChild(
        sectionTools(addLineIndex, delLineIndex, modLineIndex),
      );
      for (const num of LINE_NUMS) {
        const indexes = config.lineIndexes[num] || [];
        if (!indexes.length) continue;
        const rowTitle = document.createElement("p");
        rowTitle.className = "tam-plm-struct-line-label";
        rowTitle.textContent = `${num} :`;
        secL.appendChild(rowTitle);
        const box = document.createElement("div");
        box.className = "tam-plm-struct-box tam-plm-struct-box--line";
        for (const code of indexes) {
          const r = document.createElement("div");
          r.className = "tam-plm-struct-checkrow tam-plm-struct-checkrow--inline";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          const id = `plm-L${num}-${code}`;
          cb.id = id;
          cb.checked = descState.lines[num] === code;
          cb.addEventListener("change", () => {
            clearLegacyDesc();
            if (cb.checked) descState.lines[num] = code;
            else if (descState.lines[num] === code) delete descState.lines[num];
            syncDescField();
            renderDescPanel();
          });
          const lbl = document.createElement("label");
          lbl.htmlFor = id;
          lbl.textContent = code;
          r.append(cb, lbl);
          box.appendChild(r);
        }
        secL.appendChild(box);
      }
      descPanel.appendChild(secL);

      const secZ = document.createElement("section");
      secZ.className = "tam-plm-struct-section";
      const headZ = document.createElement("div");
      headZ.className = "tam-plm-struct-section__head";
      headZ.innerHTML =
        '<span class="tam-plm-struct-section__title">Zones manœuvre</span>';
      secZ.appendChild(headZ);
      secZ.appendChild(sectionTools(addZone, delZone, modZone));
      const boxZ = document.createElement("div");
      boxZ.className = "tam-plm-struct-box";
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
        "Vitesses à ajouter (séparées par des virgules, ex. 10 km/h, 25 km/h) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeSpeedLabel);
      if (!batch.length) return;
      config.speeds = sortAlpha([...new Set([...config.speeds, ...batch])]);
      saveConfig(config);
      renderDescPanel();
    }

    async function delSpeed() {
      if (!config.speeds.length) return;
      const raw = await promptFn(
        `Vitesse à supprimer :\n${config.speeds.join(", ")}`,
        "",
      );
      if (raw == null || !String(raw).trim()) return;
      const t = normalizeSpeedLabel(raw);
      if (!(await confirmFn(`Supprimer « ${t} » ?`))) return;
      config.speeds = config.speeds.filter((x) => x !== t);
      if (descState.v === t) descState.v = null;
      saveConfig(config);
      renderDescPanel();
    }

    async function modSpeed() {
      if (!config.speeds.length) return;
      const oldV = await promptFn(
        `Vitesse à renommer :\n${config.speeds.join(", ")}`,
        "",
      );
      if (oldV == null || !String(oldV).trim()) return;
      const oldT = normalizeSpeedLabel(oldV);
      if (!config.speeds.includes(oldT)) return;
      const newV = await promptFn("Nouveau libellé :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = normalizeSpeedLabel(newV);
      config.speeds = sortAlpha(
        config.speeds.map((x) => (x === oldT ? newT : x)),
      );
      if (descState.v === oldT) descState.v = newT;
      saveConfig(config);
      renderDescPanel();
    }

    async function addLineIndex() {
      const num = await promptFn("Numéro de ligne (1 à 5) :", "1");
      if (num == null || !LINE_NUMS.includes(String(num).trim())) return;
      const n = String(num).trim();
      const raw = await promptFn(
        "Indices de destination à ajouter (séparés par des virgules, ex. SA, RO, PL) :",
        "",
      );
      if (raw == null) return;
      const batch = splitBatchInput(raw).map(normalizeCode).filter(Boolean);
      if (!batch.length) return;
      const cur = config.lineIndexes[n] || [];
      config.lineIndexes[n] = sortAlpha([...new Set([...cur, ...batch])]);
      saveConfig(config);
      renderDescPanel();
    }

    async function delLineIndex() {
      const num = await promptFn("Numéro de ligne (1 à 5) :", "1");
      if (num == null || !LINE_NUMS.includes(String(num).trim())) return;
      const n = String(num).trim();
      const list = config.lineIndexes[n] || [];
      if (!list.length) return;
      const raw = await promptFn(
        `Indice à supprimer sur la ligne ${n} :\n${list.join(", ")}`,
        "",
      );
      if (raw == null || !String(raw).trim()) return;
      const code = normalizeCode(raw);
      if (!(await confirmFn(`Supprimer l’indice « ${code} » sur la ligne ${n} ?`)))
        return;
      config.lineIndexes[n] = list.filter((x) => x !== code);
      if (descState.lines[n] === code) delete descState.lines[n];
      saveConfig(config);
      renderDescPanel();
    }

    async function modLineIndex() {
      const num = await promptFn("Numéro de ligne (1 à 5) :", "1");
      if (num == null || !LINE_NUMS.includes(String(num).trim())) return;
      const n = String(num).trim();
      const list = config.lineIndexes[n] || [];
      if (!list.length) return;
      const oldV = await promptFn(
        `Indice à renommer (ligne ${n}) :\n${list.join(", ")}`,
        "",
      );
      if (oldV == null || !String(oldV).trim()) return;
      const oldC = normalizeCode(oldV);
      if (!list.includes(oldC)) return;
      const newV = await promptFn("Nouvel indice (majuscules) :", oldC);
      if (newV == null || !String(newV).trim()) return;
      const newC = normalizeCode(newV);
      config.lineIndexes[n] = sortAlpha(
        list.map((x) => (x === oldC ? newC : x)),
      );
      if (descState.lines[n] === oldC) descState.lines[n] = newC;
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
      config.zones = sortAlpha(
        [
          ...new Set(
            [...config.zones, ...batch].map((z) => plmNormalizeZoneLabel(z)),
          ),
        ],
      );
      saveConfig(config);
      renderDescPanel();
    }

    async function delZone() {
      if (!config.zones.length) return;
      const raw = await promptFn(
        `Zone à supprimer :\n${config.zones.join(", ")}`,
        "",
      );
      if (raw == null || !String(raw).trim()) return;
      const t = String(raw).trim();
      if (!(await confirmFn(`Supprimer la zone « ${t} » ?`))) return;
      config.zones = config.zones.filter((x) => x !== t);
      if (descState.zm === t) descState.zm = null;
      saveConfig(config);
      renderDescPanel();
    }

    async function modZone() {
      if (!config.zones.length) return;
      const oldV = await promptFn(
        `Zone à renommer :\n${config.zones.join(", ")}`,
        "",
      );
      if (oldV == null || !String(oldV).trim()) return;
      const oldT = String(oldV).trim();
      if (!config.zones.includes(oldT)) return;
      const newV = await promptFn("Nouveau nom :", oldT);
      if (newV == null || !String(newV).trim()) return;
      const newT = String(newV).trim();
      config.zones = sortAlpha(
        config.zones.map((x) => (x === oldT ? newT : x)),
      );
      if (descState.zm === oldT) descState.zm = newT;
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
        if (config.cmu.includes(n)) namePick = { kind: "cmu", value: n };
        else namePick = { kind: "manual" };
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
        if (namePick.kind === "cmu" && namePick.value) {
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
