/**
 * Catalogue repères personnels (icônes + couleurs).
 * Chargé avant simulateur_sae_1_state_mission.js — expose window.TAM_PLM_*.
 *
 * Icônes : Google Material Icons (ligatures), police chargée dans simulateur_sae.html.
 * Chaque entrée `material` est un nom de glyphe (voir codepoints du dépôt material-design-icons).
 * Entrée `letter` (une lettre A–Z) : affichage typographique à la place d’un glyphe Material.
 * Recoloriage : `color` / currentColor sur le marqueur et les boutons du sélecteur.
 */
(function () {
  "use strict";

  window.TAM_PLM_COLORS = [
    { hex: "#005ca9", label: "Bleu TAM" },
    { hex: "#c62828", label: "Rouge" },
    { hex: "#2e7d32", label: "Vert" },
    { hex: "#ef6c00", label: "Orange" },
    { hex: "#c8d400", label: "Vert ligne 3" },
    { hex: "#6a1b9a", label: "Violet" },
    { hex: "#00838f", label: "Bleu-vert" },
    { hex: "#5d4037", label: "Brun" },
    { hex: "#37474f", label: "Gris ardoise" },
    { hex: "#000000", label: "Noir" },
    { hex: "#f9a825", label: "Jaune or" },
  ];

  window.TAM_PLM_ICONS = [
    { id: "pin", label: "Repère épingle", material: "place" },
    { id: "dir-ahead", label: "Tout droit", material: "straight" },
    {
      id: "dir-slight-left",
      label: "Léger écart à gauche",
      material: "turn_slight_left",
    },
    {
      id: "dir-slight-right",
      label: "Léger écart à droite",
      material: "turn_slight_right",
    },
    { id: "rail-tracks", label: "Voie ferrée / rails", material: "directions_railway" },
    {
      id: "speed-generic",
      label: "Vitesse (compteur)",
      material: "speed",
    },
    {
      id: "chantier",
      label: "Chantier / attention",
      material: "warning",
    },
    { id: "tram", label: "Tramway", material: "tram" },
    { id: "bus", label: "Bus", material: "directions_bus" },
    {
      id: "pedestrian",
      label: "Piéton / accès",
      material: "directions_walk",
    },
    { id: "warn", label: "Attention", material: "warning_amber" },
    { id: "num1", label: "Numéro 1", material: "looks_one" },
    { id: "num2", label: "Numéro 2", material: "looks_two" },
    { id: "num3", label: "Numéro 3", material: "looks_3" },
    { id: "num4", label: "Numéro 4", material: "looks_4" },
    { id: "num5", label: "Numéro 5", material: "looks_5" },
    { id: "num6", label: "Numéro 6", material: "looks_6" },
    { id: "letter-a", label: "Lettre A", letter: "A" },
    { id: "letter-b", label: "Lettre B", letter: "B" },
    { id: "letter-c", label: "Lettre C", letter: "C" },
    { id: "letter-z", label: "Lettre Z", letter: "Z" },
    { id: "traffic", label: "Circulation dense", material: "traffic" },
    { id: "info", label: "Information", material: "info" },
    { id: "flag", label: "Repère / jalonnement", material: "flag" },
    { id: "star", label: "Point à retenir", material: "star" },
    { id: "megaphone", label: "Communication", material: "campaign" },
  ];
})();
