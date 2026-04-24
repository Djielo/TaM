/**
 * DEBUG TEMPORAIRE — intersections de conduite.
 * Objectif : marquer uniquement les vrais croisements du tracé (pas les repassages sur la même voie),
 * puis afficher un segment de guidage [-50 m ; +50 m] autour de chaque intersection.
 */
(function (global) {
  "use strict";

  const MIN_SEG_START_GAP = 2;
  const CROSSING_MIN_ANGLE_DEG = 24;
  const CLUSTER_RADIUS_M = 14;
  const INTERSECTION_WINDOW_BEFORE_M = 50;
  const INTERSECTION_WINDOW_AFTER_M = 50;

  function distM(a, b) {
    if (global.L && global.L.latLng) {
      return global.L.latLng(a).distanceTo(global.L.latLng(b));
    }
    const R = 6371000;
    const t1 = (a[0] * Math.PI) / 180;
    const t2 = (b[0] * Math.PI) / 180;
    const dt = t2 - t1;
    const dl = ((b[1] - a[1]) * Math.PI) / 180;
    const s =
      Math.sin(dt / 2) ** 2 +
      Math.cos(t1) * Math.cos(t2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function clampAngle180(a) {
    let x = Math.abs(a) % 360;
    if (x > 180) x = 360 - x;
    return x;
  }

  function headingDeg(p1, p2) {
    const y = p2[0] - p1[0];
    const x = p2[1] - p1[1];
    const deg = (Math.atan2(x, y) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  function segAngleDeg(a0, a1, b0, b1) {
    const h1 = headingDeg(a0, a1);
    const h2 = headingDeg(b0, b1);
    const d = clampAngle180(h2 - h1);
    return Math.min(d, 180 - d);
  }

  function cumulativeMeters(coords) {
    const out = [0];
    for (let i = 0; i < coords.length - 1; i++) {
      out.push(out[i] + distM(coords[i], coords[i + 1]));
    }
    return out;
  }

  function pointAtDistance(coords, cum, d) {
    if (!coords || coords.length < 2) return coords[0] || [0, 0];
    if (d <= 0) return coords[0];
    const total = cum[cum.length - 1] || 0;
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

  /**
   * Intersection de segments p1p2 et p3p4.
   * Retourne {latlng, t, u} où t/u sont les positions (0..1) sur chaque segment.
   */
  function segmentIntersection(p1, p2, p3, p4) {
    const x1 = p1[1],
      y1 = p1[0],
      x2 = p2[1],
      y2 = p2[0];
    const x3 = p3[1],
      y3 = p3[0],
      x4 = p4[1],
      y4 = p4[0];
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 1e-16) {
      return null;
    }
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    const u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
    const e = 1e-10;
    if (t < -e || t > 1 + e || u < -e || u > 1 + e) {
      return null;
    }
    return {
      latlng: [y1 + t * (y2 - y1), x1 + t * (x2 - x1)],
      t,
      u,
    };
  }

  function segBbox2d(p1, p2) {
    return {
      minX: Math.min(p1[1], p2[1]),
      maxX: Math.max(p1[1], p2[1]),
      minY: Math.min(p1[0], p2[0]),
      maxY: Math.max(p1[0], p2[0]),
    };
  }

  function bboxesOverlap2d(a, b) {
    return (
      a.minX <= b.maxX &&
      a.maxX >= b.minX &&
      a.minY <= b.maxY &&
      a.maxY >= b.minY
    );
  }

  function collectCrossings(coords, cum) {
    const n = coords.length;
    if (n < 4) {
      return [];
    }
    const out = [];
    for (let i = 0; i < n - 1; i++) {
      const a0 = coords[i];
      const a1 = coords[i + 1];
      const ba = segBbox2d(a0, a1);
      for (let j = i + MIN_SEG_START_GAP; j < n - 1; j++) {
        const b0 = coords[j];
        const b1 = coords[j + 1];
        if (!bboxesOverlap2d(ba, segBbox2d(b0, b1))) {
          continue;
        }
        const inter = segmentIntersection(a0, a1, b0, b1);
        if (!inter) {
          continue;
        }
        // On évite les quasi-parallèles (cas des voies proches).
        if (segAngleDeg(a0, a1, b0, b1) < CROSSING_MIN_ANGLE_DEG) {
          continue;
        }
        const segA = distM(a0, a1);
        const meter = cum[i] + inter.t * segA;
        out.push({ latlng: inter.latlng, kind: "croisement", meter });
      }
    }
    return out;
  }

  function clusterItems(items) {
    if (!items.length) {
      return [];
    }
    const clusters = [];
    for (const it of items) {
      let placed = false;
      for (const c of clusters) {
        if (distM(c.center, it.latlng) <= CLUSTER_RADIUS_M) {
          c.kinds.add(it.kind);
          c.items.push(it.latlng);
          if (typeof it.meter === "number") {
            c.meters.push(it.meter);
          }
          // IMPORTANT : on ne moyenne plus le centre, pour éviter le décalage visuel.
          // Le marqueur reste sur le premier point détecté.
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({
          center: it.latlng.slice(),
          kinds: new Set([it.kind]),
          items: [it.latlng],
          meters: typeof it.meter === "number" ? [it.meter] : [],
        });
      }
    }
    return clusters;
  }

  function median(values) {
    if (!values || !values.length) return 0;
    const v = values.slice().sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  function pathWindow(coords, cum, d0, d1) {
    if (!coords || coords.length < 2 || !cum || !cum.length) {
      return [];
    }
    const total = cum[cum.length - 1] || 0;
    const from = Math.max(0, Math.min(total, d0));
    const to = Math.max(0, Math.min(total, d1));
    if (to <= from) return [];

    const pts = [pointAtDistance(coords, cum, from)];
    for (let i = 1; i < coords.length - 1; i++) {
      if (cum[i] > from && cum[i] < to) {
        pts.push(coords[i]);
      }
    }
    pts.push(pointAtDistance(coords, cum, to));
    return pts;
  }

  /**
   * Met à jour le calque de marqueurs. Retourne le nombre de pastilles.
   */
  function tamUpdateMultiPassDebug(_map, layerGroup, coordinates) {
    if (!layerGroup || !layerGroup.clearLayers) {
      return 0;
    }
    layerGroup.clearLayers();
    if (!coordinates || coordinates.length < 4) {
      return 0;
    }

    const cum = cumulativeMeters(coordinates);
    const raw = collectCrossings(coordinates, cum);
    const clusters = clusterItems(raw);

    for (const c of clusters) {
      const d = median(c.meters);
      const guide = pathWindow(
        coordinates,
        cum,
        d - INTERSECTION_WINDOW_BEFORE_M,
        d + INTERSECTION_WINDOW_AFTER_M,
      );
      if (guide.length >= 2) {
        global.L.polyline(guide, {
          color: "#00a152",
          weight: 7,
          opacity: 0.95,
        }).addTo(layerGroup);
      }
      const m = global.L.circleMarker(c.center, {
        radius: 7,
        color: "#b71c1c",
        weight: 2,
        fillColor: "#e53935",
        fillOpacity: 0.85,
      });
      m.bindPopup(
        "<b>Intersection du tracé</b><br>Fenêtre guidage: -50m / +50m",
      );
      m.addTo(layerGroup);
    }

    return clusters.length;
  }

  global.tamUpdateMultiPassDebug = tamUpdateMultiPassDebug;
})(typeof window !== "undefined" ? window : globalThis);
