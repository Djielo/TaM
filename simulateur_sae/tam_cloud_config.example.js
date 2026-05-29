/**
 * Cloud Supabase — copiez ce fichier en tam_cloud_config.js (non versionné)
 * et renseignez supabaseUrl + publishableKey depuis Project Settings → API.
 * supabaseUrl = API URL sans /rest/v1 (ex. https://abcdef.supabase.co).
 */
(function (global) {
  global.TAM_CLOUD_CONFIG = {
    enabled: false,
    supabaseUrl: "https://VOTRE-PROJET.supabase.co",
    publishableKey: "VOTRE_CLE_PUBLISHABLE",
  };
})(typeof window !== "undefined" ? window : globalThis);
