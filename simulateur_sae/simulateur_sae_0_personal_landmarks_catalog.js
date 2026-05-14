/**
 * Catalogue repères personnels (icônes + couleurs).
 * Chargé avant simulateur_sae_1_state_mission.js — expose window.TAM_PLM_*.
 *
 * Icônes : Google Material Icons (ligatures), police chargée dans simulateur_sae.html.
 * Chaque entrée `material` est un nom de glyphe (voir codepoints du dépôt material-design-icons).
 * Recoloriage : `color` / currentColor sur le marqueur et les boutons du sélecteur.
 */
(function () {
  "use strict";

  window.TAM_PLM_COLORS = [
    { hex: "#005ca9", label: "Bleu TAM" },
    { hex: "#c62828", label: "Rouge" },
    { hex: "#2e7d32", label: "Vert" },
    { hex: "#ef6c00", label: "Orange" },
    { hex: "#6a1b9a", label: "Violet" },
    { hex: "#00838f", label: "Bleu-vert" },
    { hex: "#5d4037", label: "Brun" },
    { hex: "#37474f", label: "Gris ardoise" },
    { hex: "#000000", label: "Noir" },
    { hex: "#f9a825", label: "Jaune or" },
  ];

  window.TAM_PLM_ICONS = [
    { id: "pin", label: "Repère épingle", material: "place" },
    { id: "dir-ahead", label: "Direction tout droit", material: "straight" },
    { id: "dir-right", label: "Tourner à droite", material: "turn_right" },
    { id: "dir-left", label: "Tourner à gauche", material: "turn_left" },
    {
      id: "dir-merge-right",
      label: "S’insérer / bifurcation droite",
      material: "merge",
    },
    {
      id: "dir-roundabout",
      label: "Rond-point / giratoire",
      material: "roundabout_right",
    },
    { id: "tram", label: "Tramway", material: "tram" },
    { id: "bus", label: "Bus", material: "directions_bus" },
    { id: "train", label: "Train / TER", material: "train" },
    { id: "parking", label: "Parking", material: "local_parking" },
    { id: "shop", label: "Commerce", material: "storefront" },
    { id: "home", label: "Maison", material: "home" },
    { id: "hotel", label: "Hôtel", material: "hotel" },
    { id: "church", label: "Église / lieu de culte", material: "church" },
    { id: "eat", label: "Restauration", material: "restaurant" },
    { id: "hospital", label: "Santé / urgence", material: "local_hospital" },
    { id: "school", label: "École", material: "school" },
    { id: "work", label: "Travaux / chantier", material: "construction" },
    { id: "bike", label: "Vélo", material: "directions_bike" },
    {
      id: "pedestrian",
      label: "Piéton / accès",
      material: "directions_walk",
    },
    { id: "warn", label: "Attention", material: "warning" },
    {
      id: "cone",
      label: "Signalisation chantier",
      material: "edit_road",
    },
    { id: "num1", label: "Numéro 1", material: "looks_one" },
    { id: "num2", label: "Numéro 2", material: "looks_two" },
    { id: "num3", label: "Numéro 3", material: "looks_3" },
  ];
})();
