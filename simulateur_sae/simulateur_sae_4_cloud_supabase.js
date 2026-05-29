/**
 * Sauvegarde partagée Supabase : maître (écriture) / lecteurs (lecture seule).
 * Nécessite tam_cloud_config.js (voir tam_cloud_config.example.js).
 */
(function tamCloudSupabaseModule() {
  const LS_AUTH = "tam_cloud_supabase_auth_v1";
  const LS_REMOTE_UPDATED = "tam_cloud_remote_updated_at";
  const LS_READER_INTRO = "tam_cloud_reader_intro_v4";
  const CLOUD_ROW_ID = "main";
  const PUSH_DEBOUNCE_MS = 2000;

  let cloudPushTimer = 0;
  let cloudPushInFlight = false;
  let cloudPushLastJson = "";

  /** Racine projet uniquement : https://xxx.supabase.co (sans /rest/v1). */
  function tamCloudNormalizeProjectUrl(raw) {
    let url = String(raw || "")
      .trim()
      .replace(/\/+$/, "");
    url = url.replace(/\/rest\/v1$/i, "");
    url = url.replace(/\/auth\/v1$/i, "");
    return url;
  }

  function tamCloudGetConfig() {
    const c =
      typeof window !== "undefined" && window.TAM_CLOUD_CONFIG
        ? window.TAM_CLOUD_CONFIG
        : {};
    const url = tamCloudNormalizeProjectUrl(c.supabaseUrl || "");
    const publishableKey = String(c.publishableKey || "").trim();
    const enabled = c.enabled !== false && !!url && !!publishableKey;
    return { enabled, supabaseUrl: url, publishableKey };
  }

  function tamCloudHeaders(extra, accessToken) {
    const cfg = tamCloudGetConfig();
    const h = {
      apikey: cfg.publishableKey,
      "Content-Type": "application/json",
      ...(extra || {}),
    };
    if (accessToken) {
      h.Authorization = "Bearer " + accessToken;
    } else {
      h.Authorization = "Bearer " + cfg.publishableKey;
    }
    return h;
  }

  function tamCloudLoadAuth() {
    try {
      const raw = localStorage.getItem(LS_AUTH);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.access_token) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function tamCloudSaveAuth(session) {
    try {
      if (!session) localStorage.removeItem(LS_AUTH);
      else localStorage.setItem(LS_AUTH, JSON.stringify(session));
    } catch (e) {
      // ignore
    }
    tamCloudRefreshUi();
  }

  function tamCloudSessionExpiryMs(session) {
    if (!session) return 0;
    if (session.expires_at) return Number(session.expires_at);
    if (session.expires_in) {
      return Date.now() + Number(session.expires_in) * 1000 - 60000;
    }
    return 0;
  }

  function tamCloudIsMasterSessionActive() {
    const s = tamCloudLoadAuth();
    if (!s || !s.access_token) return false;
    const exp = tamCloudSessionExpiryMs(s);
    return !exp || Date.now() < exp;
  }

  /** Cloud actif et cet appareil n’est pas connecté en maître (lecteur). */
  function tamCloudIsReaderMode() {
    const cfg = tamCloudGetConfig();
    return cfg.enabled && !tamCloudIsMasterSessionActive();
  }

  function tamCloudBlocksLandmarkZoneEdits() {
    return tamCloudIsReaderMode();
  }

  async function tamCloudRefreshSessionIfNeeded() {
    const s = tamCloudLoadAuth();
    if (!s || !s.refresh_token) return null;
    const exp = tamCloudSessionExpiryMs(s);
    if (exp && Date.now() < exp) return s.access_token;

    const cfg = tamCloudGetConfig();
    if (!cfg.enabled) return null;

    try {
      const resp = await fetch(
        cfg.supabaseUrl + "/auth/v1/token?grant_type=refresh_token",
        {
          method: "POST",
          headers: tamCloudHeaders(),
          body: JSON.stringify({ refresh_token: s.refresh_token }),
        },
      );
      if (!resp.ok) {
        tamCloudSaveAuth(null);
        return null;
      }
      const data = await resp.json();
      const next = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || s.refresh_token,
        expires_in: data.expires_in,
        expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
      };
      tamCloudSaveAuth(next);
      return next.access_token;
    } catch (e) {
      return null;
    }
  }

  async function tamCloudGetMasterAccessToken() {
    if (!tamCloudIsMasterSessionActive()) {
      return (await tamCloudRefreshSessionIfNeeded()) || null;
    }
    const s = tamCloudLoadAuth();
    return s ? s.access_token : null;
  }

  async function tamCloudMasterSignIn(email, password) {
    const cfg = tamCloudGetConfig();
    if (!cfg.enabled) throw new Error("cloud_disabled");

    const resp = await fetch(
      cfg.supabaseUrl + "/auth/v1/token?grant_type=password",
      {
        method: "POST",
        headers: tamCloudHeaders(),
        body: JSON.stringify({ email: String(email).trim(), password }),
      },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error_description || err.msg || "auth_failed");
    }
    const data = await resp.json();
    tamCloudSaveAuth({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: Date.now() + Number(data.expires_in || 3600) * 1000,
    });
    cloudPushLastJson = "";
    void tamCloudPushNow();
  }

  function tamCloudMasterSignOut() {
    tamCloudSaveAuth(null);
    cloudPushLastJson = "";
  }

  async function tamCloudFetchRemoteRow() {
    const cfg = tamCloudGetConfig();
    if (!cfg.enabled) return null;

    const url =
      cfg.supabaseUrl +
      "/rest/v1/tam_cloud_backup?id=eq." +
      encodeURIComponent(CLOUD_ROW_ID) +
      "&select=payload,updated_at";

    const resp = await fetch(url, { headers: tamCloudHeaders() });
    if (!resp.ok) throw new Error("fetch_failed");
    const rows = await resp.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    return rows[0];
  }

  function tamCloudGetKnownRemoteUpdatedAt() {
    try {
      return localStorage.getItem(LS_REMOTE_UPDATED) || "";
    } catch (e) {
      return "";
    }
  }

  function tamCloudSetKnownRemoteUpdatedAt(iso) {
    try {
      if (iso) localStorage.setItem(LS_REMOTE_UPDATED, iso);
      else localStorage.removeItem(LS_REMOTE_UPDATED);
    } catch (e) {
      // ignore
    }
  }

  async function tamCloudPullFromRemote(opts) {
    const o = opts || {};
    const cfg = tamCloudGetConfig();
    if (!cfg.enabled) {
      if (!o.silent && typeof tamAppAlert === "function") {
        tamAppAlert(
          "Cloud non configuré. Copiez tam_cloud_config.example.js en tam_cloud_config.js et renseignez l’URL et la clé publishable.",
        );
      }
      return false;
    }

    try {
      const row = await tamCloudFetchRemoteRow();
      if (!row || row.payload == null) {
        if (!o.silent && typeof tamAppAlert === "function") {
          tamAppAlert("Aucune sauvegarde sur le cloud pour l’instant.");
        }
        return false;
      }

      const remoteUpdated = String(row.updated_at || "");
      if (
        o.onlyIfNewer &&
        remoteUpdated &&
        remoteUpdated === tamCloudGetKnownRemoteUpdatedAt()
      ) {
        return false;
      }

      if (typeof tamApplyBackupFromObject !== "function") {
        throw new Error("no_apply");
      }

      tamApplyBackupFromObject(row.payload, {
        silent: !!o.silent,
        skipFileBackup: true,
        statusMessage: o.silent
          ? "Données cloud à jour."
          : "Sauvegarde cloud restaurée.",
      });
      tamCloudSetKnownRemoteUpdatedAt(remoteUpdated);
      tamCloudRefreshUi();
      return true;
    } catch (e) {
      if (!o.silent && typeof tamAppAlert === "function") {
        tamAppAlert(
          "Impossible de récupérer la sauvegarde cloud. Vérifiez la connexion et la configuration.",
        );
      }
      return false;
    }
  }

  async function tamCloudPushNow() {
    const cfg = tamCloudGetConfig();
    if (!cfg.enabled || cloudPushInFlight) return false;

    const token = await tamCloudGetMasterAccessToken();
    if (!token) return false;

    if (typeof tamCollectBackupPayload !== "function") return false;

    const payload = tamCollectBackupPayload();
    const json = JSON.stringify(payload);
    if (json === cloudPushLastJson) return false;

    cloudPushInFlight = true;
    try {
      const updatedAt = new Date().toISOString();
      const resp = await fetch(cfg.supabaseUrl + "/rest/v1/tam_cloud_backup", {
        method: "POST",
        headers: tamCloudHeaders(
          { Prefer: "resolution=merge-duplicates,return=representation" },
          token,
        ),
        body: JSON.stringify({
          id: CLOUD_ROW_ID,
          payload,
          updated_at: updatedAt,
        }),
      });

      if (!resp.ok) throw new Error("push_failed");

      cloudPushLastJson = json;
      tamCloudSetKnownRemoteUpdatedAt(updatedAt);
      tamCloudRefreshUi();
      if (typeof setGpsStatus === "function") {
        setGpsStatus("Sauvegarde cloud envoyée.");
      }
      return true;
    } catch (e) {
      if (typeof setGpsStatus === "function") {
        setGpsStatus("Échec envoi cloud.");
      }
      return false;
    } finally {
      cloudPushInFlight = false;
    }
  }

  function tamCloudSchedulePush() {
    if (!tamCloudIsMasterSessionActive()) return;
    if (cloudPushTimer) clearTimeout(cloudPushTimer);
    cloudPushTimer = setTimeout(() => {
      cloudPushTimer = 0;
      void tamCloudPushNow();
    }, PUSH_DEBOUNCE_MS);
  }

  async function tamCloudMaybeAutoPullOnStartup() {
    const cfg = tamCloudGetConfig();
    if (!cfg.enabled) return;

    if (!tamCloudIsMasterSessionActive()) {
      await tamCloudPullFromRemote({ silent: true, onlyIfNewer: true });
      tamCloudMaybeShowReaderIntro();
    }

    tamCloudApplyReaderUi();
  }

  function tamCloudMaybeShowReaderIntro() {
    if (!tamCloudIsReaderMode()) return;
    try {
      if (localStorage.getItem(LS_READER_INTRO) === "1") return;
      localStorage.setItem(LS_READER_INTRO, "1");
    } catch (e) {
      return;
    }
    if (typeof tamAppAlert === "function") {
      tamAppAlert(
        "Repères, zones et réglages partagés se mettent à jour automatiquement depuis le cloud (téléphone maître). Vous n’avez pas besoin de les recréer sur cet appareil.\n\nSi une zone ou un repère manque, vous pouvez toujours le signaler au développeur : cela ne vous empêche pas de partager ce qu’il aurait pu oublier.",
      );
    }
  }

  function tamCloudApplyReaderUi() {
    const reader = tamCloudIsReaderMode();
    if (document.body) {
      document.body.classList.toggle("tam-cloud-reader-mode", reader);
    }
    const lmAdd =
      typeof personalLandmarkPlacementToggleEl !== "undefined"
        ? personalLandmarkPlacementToggleEl
        : null;
    const zoneAdd =
      typeof personalZoneToolToggleEl !== "undefined"
        ? personalZoneToolToggleEl
        : null;
    if (lmAdd) lmAdd.style.display = reader ? "none" : "";
    if (zoneAdd) zoneAdd.style.display = reader ? "none" : "";
    if (reader && typeof setPersonalLandmarkPlacementActive === "function") {
      setPersonalLandmarkPlacementActive(false);
    }
  }

  function tamCloudRefreshUi() {
    const section = document.getElementById("tamCloudSection");
    const note = document.getElementById("tamCloudStatusNote");
    const loginBtn = document.getElementById("tamCloudMasterLoginBtn");
    const logoutBtn = document.getElementById("tamCloudMasterLogoutBtn");
    const cfg = tamCloudGetConfig();

    if (!section) return;

    if (!cfg.enabled) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    const master = tamCloudIsMasterSessionActive();
    const known = tamCloudGetKnownRemoteUpdatedAt();

    const reader = tamCloudIsReaderMode();

    if (note) {
      if (master) {
        note.textContent =
          "Mode maître : vos changements sont envoyés automatiquement vers le cloud.";
      } else if (reader) {
        note.textContent =
          "Mode lecture : repères et zones se mettent à jour depuis le cloud au chargement.";
      } else if (known) {
        note.textContent =
          "Dernière récupération cloud : " +
          known.replace("T", " ").replace(/\.\d+Z$/, " (UTC)");
      } else {
        note.textContent =
          "Récupérez la sauvegarde partagée pour aligner cet appareil sur le cloud.";
      }
    }

    if (loginBtn) loginBtn.hidden = master;
    if (logoutBtn) logoutBtn.hidden = !master;
    tamCloudApplyReaderUi();
  }

  function tamCloudOpenLoginDialog() {
    const dlg = document.getElementById("tamCloudMasterLoginDialog");
    if (!dlg) return;
    const emailEl = document.getElementById("tamCloudMasterEmail");
    const passEl = document.getElementById("tamCloudMasterPassword");
    if (emailEl && !emailEl.value) emailEl.value = "";
    if (passEl) passEl.value = "";
    dlg.showModal();
    emailEl?.focus();
  }

  function tamCloudWireUi() {
    const pullBtn = document.getElementById("tamCloudPullBtn");
    const loginBtn = document.getElementById("tamCloudMasterLoginBtn");
    const logoutBtn = document.getElementById("tamCloudMasterLogoutBtn");
    const dlg = document.getElementById("tamCloudMasterLoginDialog");
    const form = document.getElementById("tamCloudMasterLoginForm");
    const cancelBtn = document.getElementById("tamCloudMasterLoginCancel");

    pullBtn?.addEventListener("click", () => {
      void tamCloudPullFromRemote({ silent: false, onlyIfNewer: false });
    });

    loginBtn?.addEventListener("click", () => tamCloudOpenLoginDialog());

    logoutBtn?.addEventListener("click", () => {
      tamCloudMasterSignOut();
      tamCloudApplyReaderUi();
      if (typeof tamAppAlert === "function") {
        tamAppAlert("Déconnexion maître effectuée.");
      }
    });

    cancelBtn?.addEventListener("click", () => dlg?.close());

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = document.getElementById("tamCloudMasterEmail")?.value;
      const password = document.getElementById("tamCloudMasterPassword")?.value;
      void (async () => {
        try {
          await tamCloudMasterSignIn(email, password);
          dlg?.close();
          tamCloudApplyReaderUi();
          if (typeof tamAppAlert === "function") {
            tamAppAlert(
              "Connexion maître réussie. Les prochaines modifications seront envoyées vers le cloud.",
            );
          }
        } catch (err) {
          if (typeof tamAppAlert === "function") {
            tamAppAlert(
              "Connexion impossible. Vérifiez l’e-mail et le mot de passe du compte maître Supabase.",
            );
          }
        }
      })();
    });

    tamCloudRefreshUi();
  }

  window.tamCloudSchedulePush = tamCloudSchedulePush;
  window.tamCloudPullFromRemote = tamCloudPullFromRemote;
  window.tamCloudMaybeAutoPullOnStartup = tamCloudMaybeAutoPullOnStartup;
  window.tamCloudRefreshUi = tamCloudRefreshUi;
  window.tamCloudIsReaderMode = tamCloudIsReaderMode;
  window.tamCloudBlocksLandmarkZoneEdits = tamCloudBlocksLandmarkZoneEdits;
  window.tamCloudApplyReaderUi = tamCloudApplyReaderUi;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tamCloudWireUi);
  } else {
    tamCloudWireUi();
  }
})();
