const MQ_KEY = "BxF0Bf72yRAXrag1CMmFGWYKUq1zZUFn";

let map;
let routeLayers = [];
let markerA;
let markerB;

function initMap() {
  map = L.map("map", { zoomControl: false }).setView([10, 20], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);
  L.control.zoom({ position: "topleft" }).addTo(map);
}

function updateClock() {
  document.getElementById("clock").textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

function makeIcon(color, label) {
  return L.divIcon({
    html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;">
             <span style="transform:rotate(45deg);color:#fff;font-size:10px;font-weight:700;">${label}</span>
           </div>`,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -30]
  });
}

function showToast(msg) {
  const t = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
}

function setLoading(which, on) {
  if (which !== "dir") return;
  document.getElementById("spinner-dir").style.display = on ? "block" : "none";
  document.getElementById("btn-icon").style.display = on ? "none" : "block";
  document.getElementById("btn-directions").disabled = on;
}

function decodeShapePoints(shapePoints) {
  const points = [];
  for (let i = 0; i < shapePoints.length; i += 2) {
    points.push([shapePoints[i], shapePoints[i + 1]]);
  }
  return points;
}

async function fetchRoute(from, to, routeType) {
  const url =
    `https://www.mapquestapi.com/directions/v2/route?key=${MQ_KEY}` +
    `&from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}` +
    `&routeType=${routeType}` +
    "&unit=k" +
    "&fullShape=true" +
    "&generalize=0" +
    "&maxRoutes=3" +
    "&ambiguities=ignore" +
    "&outFormat=json" +
    "&narrativeType=text" +
    "&enhancedNarrative=false";

  const res = await fetch(url);
  const data = await res.json();
  const route = data.route;
  const error = route?.routeError;

  if (!route || (error && error.errorCode !== 0)) {
    return null;
  }
  return route;
}

async function getDirections() {
  const from = document.getElementById("origin").value.trim();
  const to = document.getElementById("destination").value.trim();

  if (!from || !to) {
    showToast("Please enter both a starting location and a destination.");
    return;
  }

  setLoading("dir", true);
  clearDrawnRouteOnly();

  try {
    const routeResults = await Promise.all([
      fetchRouteWithAlternatives(from, to, "shortest", "Car (Shortest)", "val-amber"),
      fetchRouteWithAlternatives(from, to, "fastest", "Car (Fastest)", "val-cyan"),
      fetchRouteWithAlternatives(from, to, "pedestrian", "Walking", "val-green"),
      fetchRouteWithAlternatives(from, to, "bicycle", "Bike", "val-cyan")
    ]);

    const candidates = routeResults.flat().filter((item) => item && item.route);

    if (!candidates.length) {
      showToast("Route not found. Check your locations and try again.");
      return;
    }

    renderRouteCandidates(candidates, from, to);
  } catch (error) {
    showToast("Network error. Please check your connection.");
  } finally {
    setLoading("dir", false);
  }
}

async function fetchRouteWithAlternatives(from, to, routeType, baseLabel, className) {
  const primary = await fetchRoute(from, to, routeType);
  if (!primary) return [];

  const candidates = [
    {
      route: primary,
      label: `${baseLabel} #1`,
      className
    }
  ];

  const altRoutes = primary.alternateRoutes || [];
  altRoutes.forEach((alt, idx) => {
    if (alt?.route) {
      candidates.push({
        route: alt.route,
        label: `${baseLabel} Alt #${idx + 2}`,
        className
      });
    }
  });

  return candidates;
}

function getRouteMetrics(route) {
  return {
    distance: Number(route.distance || 0),
    time: Number(route.time || 0)
  };
}

function pickBestRoute(candidates) {
  const enriched = candidates.map((item) => ({
    ...item,
    ...getRouteMetrics(item.route)
  }));

  const minDistance = Math.min(...enriched.map((c) => c.distance));
  const minTime = Math.min(...enriched.map((c) => c.time));

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of enriched) {
    // Balance shortest distance + shortest time together.
    const normalizedDistance = minDistance > 0 ? candidate.distance / minDistance : 1;
    const normalizedTime = minTime > 0 ? candidate.time / minTime : 1;
    const score = normalizedDistance * 0.5 + normalizedTime * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = { ...candidate, score };
    }
  }

  return { best, enriched };
}

function renderRouteCandidates(candidates, from, to) {
  const { best, enriched } = pickBestRoute(candidates);
  if (!best) {
    showToast("Could not find a valid route.");
    return;
  }

  const bestShape = best.route.shape?.shapePoints || [];
  const bestPts = decodeShapePoints(bestShape);

  if (bestPts.length < 2) {
    showToast("Could not draw route on map.");
    return;
  }

  const drawOrder = [...enriched].sort((a, b) => {
    if (a.label === best.label) return 1;
    if (b.label === best.label) return -1;
    return a.distance - b.distance;
  });

  drawOrder.forEach((candidate, idx) => {
    const pts = decodeShapePoints(candidate.route.shape?.shapePoints || []);
    if (pts.length < 2) return;

    const isBest = candidate.label === best.label;
    const layer = L.polyline(pts, {
      color: isBest ? "#f59e0b" : ["#60a5fa", "#22d3ee", "#a78bfa", "#34d399"][idx % 4],
      weight: isBest ? 6 : 3,
      opacity: isBest ? 0.95 : 0.55,
      dashArray: isBest ? null : "8 6"
    }).addTo(map);

    layer.bindPopup(
      `<b>${candidate.label}${isBest ? " (Recommended)" : ""}</b><br>${candidate.distance.toFixed(1)} km • ${formatTime(candidate.time)}`
    );
    routeLayers.push(layer);
  });

  markerA = L.marker(bestPts[0], { icon: makeIcon("#3b82f6", "A") }).addTo(map).bindPopup(`<b>Start</b><br>${from}`);
  markerB = L.marker(bestPts[bestPts.length - 1], { icon: makeIcon("#f59e0b", "B") }).addTo(map).bindPopup(`<b>End</b><br>${to}`);
  map.fitBounds(L.featureGroup(routeLayers).getBounds(), { padding: [40, 40] });

  const shortestDistance = best.distance.toFixed(1);
  const shortestMinutes = Math.round(best.time / 60);

  document.getElementById("m-dist").textContent = shortestDistance;
  document.getElementById("m-time").textContent = shortestMinutes;
  document.getElementById("m-fuel").textContent = "Best";

  const tableRows = [
    ["Origin", from, ""],
    ["Destination", to, ""],
    ["Recommended Path", `${best.label} (${shortestDistance} km | ${formatTime(best.time)})`, "val-amber"],
    ...enriched
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)
      .map((summary) => [
      summary.label + (summary.label === best.label ? " ★" : ""),
      `${summary.distance.toFixed(1)} km | ${formatTime(summary.time)}`,
      summary.className || ""
    ])
  ];

  document.getElementById("route-table").innerHTML = tableRows
    .map(([k, v, cls]) => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`)
    .join("");

  const maneuvers = (best.route.legs?.[0] && best.route.legs[0].maneuvers) || [];
  document.getElementById("steps-list").innerHTML = maneuvers
    .slice(0, 30)
    .map(
      (m, i) => `<div class="step-item">
       <div class="step-num">${i + 1}</div>
       <div class="step-text">${m.narrative}</div>
       <div class="step-dist">${(m.distance || 0).toFixed(1)} km</div>
     </div>`
    )
    .join("");

  document.getElementById("results-section").classList.add("visible");
  document.getElementById("empty-state-route").style.display = "none";
}

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function clearDrawnRouteOnly() {
  routeLayers.forEach((layer) => map.removeLayer(layer));
  routeLayers = [];
  if (markerA) {
    map.removeLayer(markerA);
    markerA = null;
  }
  if (markerB) {
    map.removeLayer(markerB);
    markerB = null;
  }
}

function clearRoute() {
  clearDrawnRouteOnly();
  document.getElementById("origin").value = "";
  document.getElementById("destination").value = "";
  document.getElementById("m-dist").textContent = "—";
  document.getElementById("m-time").textContent = "—";
  document.getElementById("m-fuel").textContent = "—";
  document.getElementById("route-table").innerHTML = "";
  document.getElementById("steps-list").innerHTML = "";
  document.getElementById("results-section").classList.remove("visible");
  document.getElementById("empty-state-route").style.display = "";
  map.setView([10, 20], 2);
}

document.getElementById("origin").addEventListener("keydown", (e) => {
  if (e.key === "Enter") getDirections();
});

document.getElementById("destination").addEventListener("keydown", (e) => {
  if (e.key === "Enter") getDirections();
});

initMap();
