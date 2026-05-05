/**
 * Module temporaire de guidage : affiche uniquement le tronçon actif
 * entre l'arrêt courant et l'arrêt suivant.
 */
(function (global) {
  "use strict";

  function pointAtDistance(coords, cum, d) {
    if (!coords || coords.length < 2 || !cum || !cum.length) {
      return coords && coords[0] ? coords[0] : [43.61, 3.88];
    }
    if (d <= 0) return coords[0];
    const total = cum[cum.length - 1];
    if (d >= total) return coords[coords.length - 1];

    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (cum[mid] < d) lo = mid;
      else hi = mid;
    }

    const i = lo;
    const a = coords[i];
    const b = coords[i + 1];
    const d0 = cum[i];
    const d1 = cum[i + 1];
    const t = d1 - d0 < 1e-6 ? 0 : (d - d0) / (d1 - d0);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }

  function pathBetweenDistances(coords, cum, dStart, dEnd) {
    if (!coords || coords.length < 2 || !cum || !cum.length) return [];
    const total = cum[cum.length - 1];
    const from = Math.max(0, Math.min(total, dStart));
    const to = Math.max(0, Math.min(total, dEnd));
    if (to <= from) return [];

    const pts = [pointAtDistance(coords, cum, from)];
    for (let i = 1; i < coords.length - 1; i++) {
      if (cum[i] > from && cum[i] < to) pts.push(coords[i]);
    }
    pts.push(pointAtDistance(coords, cum, to));
    return pts;
  }

  function currentStopIdx(stopMetersAlong, d) {
    let k = 0;
    for (let i = 0; i < stopMetersAlong.length; i++) {
      if (stopMetersAlong[i] <= d + 0.5) k = i;
    }
    return k;
  }

  function tamUpdateStopToStopGuide(map, layerGroup, coords, pathCumMeters, stopMetersAlong, dNow) {
    if (!map || !layerGroup || !layerGroup.clearLayers) {
      return { segmentIndex: -1, totalSegments: 0 };
    }
    if (!coords || coords.length < 2 || !pathCumMeters || pathCumMeters.length < 2) {
      layerGroup.clearLayers();
      layerGroup.__tamSegIdx = -1;
      return { segmentIndex: -1, totalSegments: 0 };
    }
    if (!stopMetersAlong || stopMetersAlong.length < 2) {
      layerGroup.clearLayers();
      layerGroup.__tamSegIdx = -1;
      return { segmentIndex: -1, totalSegments: 0 };
    }

    const totalSegments = stopMetersAlong.length - 1;
    const idx = Math.min(currentStopIdx(stopMetersAlong, dNow), totalSegments - 1);
    const startM = stopMetersAlong[idx];
    const endM = stopMetersAlong[idx + 1];

    if (layerGroup.__tamSegIdx !== idx) {
      layerGroup.clearLayers();
      const seg = pathBetweenDistances(coords, pathCumMeters, startM, endM);
      if (seg.length >= 2) {
        global.L.polyline(seg, {
          color: "#00a152",
          weight: 7,
          opacity: 0.95
        }).addTo(layerGroup);
      }
      layerGroup.__tamSegIdx = idx;
    }

    return { segmentIndex: idx, totalSegments };
  }

  global.tamUpdateStopToStopGuide = tamUpdateStopToStopGuide;
})(typeof window !== "undefined" ? window : globalThis);
