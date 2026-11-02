import type { FeatureLike } from "ol/Feature";
import Icon from "ol/style/Icon";
import Style from "ol/style/Style";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import CircleStyle from "ol/style/Circle";

// ─────────────────────────────────────────────────────────────────────────────
// Aviation & Maritime Telemetry SVG Icon Registry
// ─────────────────────────────────────────────────────────────────────────────
// Generates high-DPI, vector-crisp SVG data URIs for every category of traffic:
//   - Commercial Jet Airliners (Airbus A320, Boeing 737)
//   - Heavy Wide-body Transports (Boeing 747, Airbus A380)
//   - Helicopters / Rotorcraft (Rotor blades, tail boom, skids)
//   - Light GA Aircraft (Single-engine high-wing monoplane)
//   - UAV / Drones (Quadcopter X-frame)
//   - Orbital Satellites (Solar array wings, bus, antenna)
//   - Container Ships (Pointed hull, cargo container stacks, bridge)
//   - Tankers (Long deck, pipeline manifolds, aft castle)
//   - Passenger / Cruise Ships (Tiered white deck superstructure)
//   - Tugboats & Fishing Vessels (Sturdy rounded hull, wheelhouse)
//   - Thermal Fire Hotspots (Fiery flame glyph)
//   - Earthquake Epicenters (Concentric seismic shockwave rings)
// ─────────────────────────────────────────────────────────────────────────────

function encodeSvg(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// 1. Commercial Jet Airliner (Swept wings, twin jet engines, T-tail)
function buildCommercialJetSvg(color: string, emergency = false): string {
  const stroke = emergency ? "#fef08a" : "#ffffff";
  const strokeWidth = emergency ? 2 : 1.2;
  const filter = emergency
    ? `<filter id="glow"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ef4444"/></filter>`
    : "";
  const filterAttr = emergency ? `filter="url(#glow)"` : "";

  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <defs>${filter}</defs>
      <path ${filterAttr} d="M15 2 C14.2 2 13.5 2.8 13.5 4.2 L13.5 12 L3 17.5 L3 20.2 L13.5 17 L13.5 23.5 L10.8 25.5 L10.8 27.5 L15 26.5 L19.2 27.5 L19.2 25.5 L16.5 23.5 L16.5 17 L27 20.2 L27 17.5 L16.5 12 L16.5 4.2 C16.5 2.8 15.8 2 15 2 Z"
        fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
    </svg>`
  );
}

// 2. Heavy Transport / Wide-body Jet (4 engines, larger wingspan)
function buildHeavyJetSvg(color: string, emergency = false): string {
  const stroke = emergency ? "#fef08a" : "#ffffff";
  const strokeWidth = emergency ? 2.2 : 1.4;

  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
      <path d="M17 2 C16 2 15 3 15 4.5 L15 13 L2 19.5 L2 22.8 L15 18.5 L15 26 L11.5 28.5 L11.5 31 L17 30 L22.5 31 L22.5 28.5 L19 26 L19 18.5 L32 22.8 L32 19.5 L19 13 L19 4.5 C19 3 18 2 17 2 Z"
        fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
      <!-- Outer & Inner Engine Pods -->
      <rect x="8" y="17" width="2" height="4" rx="1" fill="#ffffff"/>
      <rect x="24" y="17" width="2" height="4" rx="1" fill="#ffffff"/>
      <rect x="12" y="15.5" width="2" height="4" rx="1" fill="#ffffff"/>
      <rect x="20" y="15.5" width="2" height="4" rx="1" fill="#ffffff"/>
    </svg>`
  );
}

// 3. Helicopter / Rotorcraft (Main rotor blades, hub, bubble fuselage, tail boom)
function buildHelicopterSvg(color: string, emergency = false): string {
  const stroke = emergency ? "#fef08a" : "#ffffff";

  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <!-- Main Rotor Blade Disc -->
      <line x1="3" y1="10" x2="27" y2="10" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/>
      <circle cx="15" cy="10" r="1.8" fill="#ffffff"/>
      <!-- Rotor Mast -->
      <line x1="15" y1="10" x2="15" y2="13" stroke="${stroke}" stroke-width="1.8"/>
      <!-- Fuselage Bubble -->
      <ellipse cx="15" cy="16.5" rx="5" ry="6" fill="${color}" stroke="${stroke}" stroke-width="1.3"/>
      <!-- Tail Boom -->
      <line x1="15" y1="22.5" x2="15" y2="28" stroke="${stroke}" stroke-width="1.8"/>
      <!-- Tail Rotor -->
      <line x1="12" y1="28" x2="18" y2="28" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>
      <!-- Landing Skids -->
      <line x1="7.5" y1="14" x2="7.5" y2="20" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>
      <line x1="22.5" y1="14" x2="22.5" y2="20" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`
  );
}

// 4. Light General Aviation (Single-engine prop plane)
function buildLightPropSvg(color: string, emergency = false): string {
  const stroke = emergency ? "#fef08a" : "#ffffff";

  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
      <!-- Nose Propeller Spin -->
      <ellipse cx="13" cy="2.5" rx="4.5" ry="1.2" fill="#ffffff"/>
      <!-- Fuselage and straight wings -->
      <path d="M13 2.5 C12.2 2.5 11.5 3.5 11.5 5.5 L11.5 9 L2 9 L2 12.5 L11.5 12.5 L11.5 21 L8.5 23 L8.5 25 L13 24.2 L17.5 25 L17.5 23 L14.5 21 L14.5 12.5 L24 12.5 L24 9 L14.5 9 L14.5 5.5 C14.5 3.5 13.8 2.5 13 2.5 Z"
        fill="${color}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`
  );
}

// 5. UAV / Drone (Quadcopter X-frame with 4 rotors)
function buildDroneSvg(color: string): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
      <!-- Cross Arms -->
      <line x1="7" y1="7" x2="21" y2="21" stroke="#ffffff" stroke-width="1.8"/>
      <line x1="21" y1="7" x2="7" y2="21" stroke="#ffffff" stroke-width="1.8"/>
      <!-- 4 Rotor Circles -->
      <circle cx="7" cy="7" r="3.5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.4"/>
      <circle cx="21" cy="7" r="3.5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.4"/>
      <circle cx="7" cy="21" r="3.5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.4"/>
      <circle cx="21" cy="21" r="3.5" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.4"/>
      <!-- Central Body Hub -->
      <circle cx="14" cy="14" r="4" fill="${color}" stroke="#ffffff" stroke-width="1.3"/>
      <!-- Forward Arrow -->
      <polygon points="14,6 12,8.5 16,8.5" fill="#f59e0b"/>
    </svg>`
  );
}

// 6. Orbital Satellite (Solar array panels, central payload bus, dish antenna)
function buildSatelliteSvg(): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <!-- Left Solar Array Wing -->
      <rect x="2" y="11" width="10" height="10" rx="1" fill="#0284c7" stroke="#ffffff" stroke-width="1.2"/>
      <line x1="7" y1="11" x2="7" y2="21" stroke="#38bdf8" stroke-width="0.8"/>
      <line x1="2" y1="16" x2="12" y2="16" stroke="#38bdf8" stroke-width="0.8"/>
      <line x1="12" y1="16" x2="13.5" y2="16" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Right Solar Array Wing -->
      <rect x="20" y="11" width="10" height="10" rx="1" fill="#0284c7" stroke="#ffffff" stroke-width="1.2"/>
      <line x1="25" y1="11" x2="25" y2="21" stroke="#38bdf8" stroke-width="0.8"/>
      <line x1="20" y1="16" x2="30" y2="16" stroke="#38bdf8" stroke-width="0.8"/>
      <line x1="18.5" y1="16" x2="20" y2="16" stroke="#ffffff" stroke-width="1.5"/>
      <!-- Center Satellite Bus -->
      <rect x="13.5" y="11" width="5" height="10" rx="1" fill="#c084fc" stroke="#ffffff" stroke-width="1.3"/>
      <!-- Parabolic Antenna Dish -->
      <path d="M12 5.5 C12 9 20 9 20 5.5" fill="none" stroke="#ffffff" stroke-width="1.4"/>
      <line x1="16" y1="7.2" x2="16" y2="11" stroke="#ffffff" stroke-width="1.4"/>
      <!-- Earth-facing telemetry sensor -->
      <circle cx="16" cy="16" r="1.3" fill="#facc15"/>
    </svg>`
  );
}

// 7. Maritime Container / Cargo Vessel (Hull with stacked cargo blocks)
function buildCargoShipSvg(color = "#06b6d4"): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
      <!-- Vessel Hull pointing Up/North -->
      <path d="M14 2 C18.5 6 19.5 14 19.5 25 C19.5 29 17.5 31 14 31 C10.5 31 8.5 29 8.5 25 C8.5 14 9.5 6 14 2 Z"
        fill="${color}" stroke="#ffffff" stroke-width="1.3"/>
      <!-- Stacked Container Bays -->
      <rect x="11.5" y="9" width="5" height="3" fill="#f59e0b" rx="0.4"/>
      <rect x="11.5" y="13.5" width="5" height="3" fill="#10b981" rx="0.4"/>
      <rect x="11.5" y="18" width="5" height="3" fill="#38bdf8" rx="0.4"/>
      <!-- Aft Bridge Superstructure -->
      <rect x="11" y="23.5" width="6" height="3.5" fill="#ffffff" rx="0.5"/>
      <circle cx="14" cy="25" r="0.8" fill="#0a0a0a"/>
    </svg>`
  );
}

// 8. Maritime Oil / Chemical Tanker (Fuller beam, deck pipe manifolds, rear bridge)
function buildTankerShipSvg(color = "#0284c7"): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
      <!-- Tanker Hull (wider beam) -->
      <path d="M14 2 C19 6.5 20.5 12 20.5 26 C20.5 30 18 31 14 31 C10 31 7.5 30 7.5 26 C7.5 12 9 6.5 14 2 Z"
        fill="${color}" stroke="#ffffff" stroke-width="1.3"/>
      <!-- Tank Deck Pipelines -->
      <line x1="14" y1="8" x2="14" y2="24" stroke="#facc15" stroke-width="1.2"/>
      <line x1="10.5" y1="12" x2="17.5" y2="12" stroke="#facc15" stroke-width="1"/>
      <line x1="10.5" y1="18" x2="17.5" y2="18" stroke="#facc15" stroke-width="1"/>
      <!-- Aft Castle Bridge -->
      <rect x="10.5" y="25" width="7" height="3.5" fill="#ffffff" rx="0.5"/>
    </svg>`
  );
}

// 9. Passenger Cruise Liner (Stepped white multi-deck superstructure)
function buildCruiseShipSvg(): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="34" viewBox="0 0 28 34">
      <!-- Cruise Hull -->
      <path d="M14 2 C18 6 19.5 13 19.5 26 C19.5 30 17.5 31 14 31 C10.5 31 8.5 30 8.5 26 C8.5 13 10 6 14 2 Z"
        fill="#0369a1" stroke="#ffffff" stroke-width="1.3"/>
      <!-- Tiered White Passenger Decks -->
      <path d="M11 8 C11 8 17 8 17 8 L17.5 24.5 L10.5 24.5 Z" fill="#ffffff"/>
      <!-- Funnels / Smokestacks -->
      <circle cx="14" cy="14" r="1.3" fill="#ef4444"/>
      <circle cx="14" cy="18.5" r="1.3" fill="#ef4444"/>
    </svg>`
  );
}

// 10. Tugboat / Fishing Vessel (Compact sturdy hull, high bow)
function buildTugFishingSvg(color = "#14b8a6"): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="28" viewBox="0 0 26 28">
      <!-- Sturdy rounded hull -->
      <path d="M13 2 C17.5 5.5 18.5 12 18.5 21 C18.5 24.5 16 26 13 26 C10 26 7.5 24.5 7.5 21 C7.5 12 8.5 5.5 13 2 Z"
        fill="${color}" stroke="#ffffff" stroke-width="1.3"/>
      <!-- High Wheelhouse -->
      <circle cx="13" cy="13" r="3.2" fill="#ffffff"/>
      <circle cx="13" cy="13" r="1.5" fill="#0a0a0a"/>
      <!-- Tow Winch / Rigging -->
      <line x1="13" y1="18" x2="13" y2="23" stroke="#facc15" stroke-width="1.6"/>
    </svg>`
  );
}

// 10b. Moored / Anchored Vessel (Stable circular harbor mooring buoy glyph)
function buildMooredVesselSvg(color = "#06b6d4"): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" fill="none" stroke="${color}" stroke-width="1.4" stroke-dasharray="2.5 2" opacity="0.85"/>
      <circle cx="12" cy="12" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      <circle cx="12" cy="12" r="2" fill="#ffffff"/>
      <path d="M7 13.5 C7 16.5 17 16.5 17 13.5" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-linecap="round"/>
    </svg>`
  );
}

// 11. NASA FIRMS Thermal Fire (Flickering flame with hot core)
function buildFireSvg(color = "#f97316"): string {
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
      <path d="M13 2 C13 2 16.5 6.5 16.5 10 C16.5 11.2 17.5 12 18.5 11 C19.5 13.5 20.5 16 20.5 18.5 C20.5 22.5 17.2 25 13 25 C8.8 25 5.5 22.5 5.5 18.5 C5.5 14.5 8.2 10.5 11 7.5 C11 9.5 12 11 13 11 C13 8 13 2 13 2 Z"
        fill="${color}" stroke="#ffffff" stroke-width="1.2"/>
      <!-- Inner hot core -->
      <path d="M13 14 C13 14 15.2 16.5 15.2 18.5 C15.2 20 14.2 21.2 13 21.2 C11.8 21.2 10.8 20 10.8 18.5 C10.8 16.5 13 14 13 14 Z"
        fill="#fef08a"/>
    </svg>`
  );
}

// 12. Earthquake Epicenter (Concentric seismic shockwave rings)
function buildEarthquakeSvg(color: string, mag: number): string {
  const outerRadius = Math.min(16, Math.max(9, 7 + mag * 1.5));
  return encodeSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="${outerRadius}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85"/>
      <circle cx="18" cy="18" r="${Math.max(4, outerRadius - 4)}" fill="${color}" stroke="#ffffff" stroke-width="1.3" opacity="0.9"/>
      <circle cx="18" cy="18" r="2.5" fill="#ffffff"/>
    </svg>`
  );
}

export function getFlightSvg(category: number = 0, color: string = "#38bdf8", isEmergency: boolean = false): string {
  if (category === 8) {
    return buildHelicopterSvg(color, isEmergency);
  } else if (category === 6) {
    return buildHeavyJetSvg(color, isEmergency);
  } else if (category === 14) {
    return buildDroneSvg(color);
  } else if (category === 2 || category === 3 || category === 9 || category === 12) {
    return buildLightPropSvg(color, isEmergency);
  } else {
    return buildCommercialJetSvg(color, isEmergency);
  }
}

export function getSatelliteSvg(): string {
  return buildSatelliteSvg();
}

export function getVesselSvg(shipType: number = 0, speedKnots: number = 0, color: string = "#06b6d4"): string {
  if (speedKnots < 0.5) {
    return buildMooredVesselSvg(color);
  }
  if (shipType >= 70 && shipType <= 79) {
    return buildCargoShipSvg(color);
  }
  if (shipType >= 80 && shipType <= 89) {
    return buildTankerShipSvg(color);
  }
  if (shipType >= 60 && shipType <= 69) {
    return buildCruiseShipSvg();
  }
  if (shipType === 30 || shipType === 31 || shipType === 32 || shipType === 52) {
    return buildTugFishingSvg(color);
  }
  return buildCargoShipSvg(color);
}

export function getFireSvg(color: string = "#f97316"): string {
  return buildFireSvg(color);
}

export function getEarthquakeSvg(mag: number, color: string = "#06b6d4"): string {
  return buildEarthquakeSvg(color, mag);
}

// ─────────────────────────────────────────────────────────────────────────────
// Style Cache Maps (Zero Allocation at 60 FPS)
// ─────────────────────────────────────────────────────────────────────────────

const styleCache = new Map<string, Style>();
const labelStyleCache = new Map<string, Style>();

function getCachedStyle(key: string, factory: () => Style): Style {
  let s = styleCache.get(key);
  if (!s) {
    s = factory();
    styleCache.set(key, s);
  }
  return s;
}

/**
 * Produces a cached, high-contrast monospace HUD text tag for moving objects.
 */
export function getCachedLabelStyle(
  text: string,
  accentColor = "rgba(56, 189, 248, 0.4)",
  offsetY = 19
): Style {
  const key = `${text}:${accentColor}:${offsetY}`;
  const existing = labelStyleCache.get(key);
  if (existing) return existing;

  const style = new Style({
    text: new Text({
      text,
      font: '600 9px "IBM Plex Mono", "SF Mono", monospace',
      fill: new Fill({ color: "#ffffff" }),
      backgroundFill: new Fill({ color: "rgba(0, 0, 0, 0.88)" }),
      backgroundStroke: new Stroke({ color: accentColor, width: 1 }),
      padding: [1.5, 4, 1.5, 4],
      offsetY,
      overflow: true,
    }),
  });

  if (labelStyleCache.size > 1500) {
    labelStyleCache.clear();
  }
  labelStyleCache.set(key, style);
  return style;
}

/**
 * Returns altitude-based color for aircraft vectors.
 */
export function getAircraftAltitudeColor(altMeters: number): string {
  if (altMeters > 10000) return "#f59e0b"; // Flight Level > 330: Amber/Gold
  if (altMeters > 7000) return "#10b981";  // Cruise 23,000–33,000 ft: Emerald
  if (altMeters > 3000) return "#06b6d4";  // Mid-altitude 10,000–23,000 ft: Cyan
  return "#38bdf8";                        // Low-altitude / Terminal: Sky Blue
}

/**
 * Produces category-specific, rotation-aware vector style for an ADS-B flight target.
 */
export function getFlightStyle(feature: FeatureLike, resolution?: number): Style | Style[] {
  const heading = (feature.get("heading") as number) || 0;
  const headingRad = (heading * Math.PI) / 180;
  const headingDegQuant = Math.round(heading / 2) * 2; // Quantize to 2° increments for cache efficiency

  const alt = (feature.get("altitude") as number) || 0;
  const isEmergency = Boolean(feature.get("isEmergency"));
  const category = (feature.get("category") as number) || 0;

  // A fix older than one dead-reckoning horizon is stale: fade it, so an
  // operator can read track age on the map instead of trusting the picture.
  const ageSec = (feature.get("ageSec") as number) || 0;
  const staleness = isEmergency ? "live" : ageSec > 90 ? "stale" : "fresh";
  const staleOpacity = staleness === "stale" ? 0.45 : 1;

  const color = isEmergency ? "#ef4444" : getAircraftAltitudeColor(alt);
  const cacheKey = `flight:${category}:${color}:${isEmergency ? 1 : 0}:${headingDegQuant}:${staleness}`;

  const iconStyle = getCachedStyle(cacheKey, () => {
    let iconSrc: string;

    if (category === 8) {
      // Rotorcraft / Helicopter
      iconSrc = buildHelicopterSvg(color, isEmergency);
    } else if (category === 6) {
      // Heavy (> 300,000 lbs) Wide-body Jet
      iconSrc = buildHeavyJetSvg(color, isEmergency);
    } else if (category === 14) {
      // UAV / Drone
      iconSrc = buildDroneSvg(color);
    } else if (category === 2 || category === 3 || category === 9 || category === 12) {
      // Light Aircraft / Small / Glider
      iconSrc = buildLightPropSvg(color, isEmergency);
    } else {
      // Commercial Passenger Jet (Default)
      iconSrc = buildCommercialJetSvg(color, isEmergency);
    }

    return new Style({
      image: new Icon({
        src: iconSrc,
        rotation: headingRad,
        rotateWithView: true,
        anchor: [0.5, 0.5],
        opacity: staleOpacity,
        scale: isEmergency ? 1.15 : 1.0,
      }),
    });
  });

  // Small tactical tag on moving aircraft (callsign or hex code)
  // LOD De-Cluttering & Overlap Suppression:
  // 1. Emergency flights ALWAYS display their tag (critical flight safety).
  // 2. Currently hovered or selected aircraft ALWAYS display their tag.
  // 3. General traffic displays tags only at terminal zoom levels (< 1500 m/px ~ zoom >= 8),
  //    preventing dense airport hub label collisions when zoomed out.
  const callsign = String(feature.get("callsign") || feature.get("id") || "").trim();
  const isHovered = Boolean(feature.get("isHovered"));
  const isSelected = Boolean(feature.get("isSelected"));
  const shouldShowFlightTag =
    Boolean(callsign) &&
    (isEmergency || isHovered || isSelected || (resolution != null && resolution < 1500));

  if (shouldShowFlightTag) {
    const accent = isEmergency
      ? "rgba(239, 68, 68, 0.95)"
      : isSelected
      ? "rgba(255, 255, 255, 0.95)"
      : isHovered
      ? "rgba(255, 255, 255, 0.78)"
      : "rgba(255, 255, 255, 0.45)";
    const tagStyle = getCachedLabelStyle(callsign, accent, 19);
    return [iconStyle, tagStyle];
  }

  return iconStyle;
}

/**
 * Produces rotation-aware vector style for an orbital satellite target.
 */
export function getSatelliteStyle(feature: FeatureLike, resolution?: number): Style | Style[] {
  const cacheKey = "satellite:standard";

  const iconStyle = getCachedStyle(cacheKey, () => {
    return new Style({
      image: new Icon({
        src: buildSatelliteSvg(),
        anchor: [0.5, 0.5],
        scale: 1.0,
      }),
    });
  });

  const satName = String(feature.get("satelliteName") || feature.get("name") || "").trim();
  const isHovered = Boolean(feature.get("isHovered"));
  const isSelected = Boolean(feature.get("isSelected"));
  const shouldShowSatTag = Boolean(satName) && (isHovered || isSelected || (resolution != null && resolution < 3500));

  if (shouldShowSatTag) {
    const accent = isHovered || isSelected ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.5)";
    const tagStyle = getCachedLabelStyle(satName, accent, 18);
    return [iconStyle, tagStyle];
  }

  return iconStyle;
}

/**
 * Produces category-specific, course-rotated vector style for a maritime AIS vessel target.
 */
export function getVesselStyle(feature: FeatureLike, resolution?: number): Style | Style[] {
  const isMoored = Boolean(feature.get("isMoored"));
  const course = (feature.get("course") as number) || 0;
  const courseRad = isMoored ? 0 : (course * Math.PI) / 180;
  const courseDegQuant = isMoored ? 0 : Math.round(course / 2) * 2;

  const shipType = String(feature.get("shipType") || "").toLowerCase();

  // Same staleness contract as flights: a fix older than the dead-reckoning
  // horizon fades, so track age is readable on the map without trusting it.
  const ageSec = (feature.get("ageSec") as number) || 0;
  const staleness = ageSec > 90 ? "stale" : "fresh";
  const staleOpacity = staleness === "stale" ? 0.45 : 1;

  const cacheKey = `vessel:${isMoored ? "moored" : shipType}:${courseDegQuant}:${staleness}`;

  const iconStyle = getCachedStyle(cacheKey, () => {
    let iconSrc: string;

    if (isMoored) {
      iconSrc = buildMooredVesselSvg("#06b6d4");
    } else if (shipType.includes("tanker")) {
      iconSrc = buildTankerShipSvg("#0284c7");
    } else if (shipType.includes("passenger") || shipType.includes("cruise")) {
      iconSrc = buildCruiseShipSvg();
    } else if (shipType.includes("tug") || shipType.includes("fish")) {
      iconSrc = buildTugFishingSvg("#14b8a6");
    } else {
      // Container / Cargo / Bulk Carrier
      iconSrc = buildCargoShipSvg("#06b6d4");
    }

    return new Style({
      image: new Icon({
        src: iconSrc,
        rotation: courseRad,
        rotateWithView: !isMoored,
        anchor: [0.5, 0.5],
        scale: 1.0,
        opacity: staleOpacity,
      }),
    });
  });

  const vesselName = String(feature.get("name") || (feature.get("id") ? `MMSI ${feature.get("id")}` : "")).trim();
  const isHovered = Boolean(feature.get("isHovered"));
  const isSelected = Boolean(feature.get("isSelected"));
  const shouldShowVesselTag = Boolean(vesselName) && (isHovered || isSelected || (resolution != null && resolution < 1500));

  if (shouldShowVesselTag) {
    const accent = isHovered || isSelected ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.45)";
    const tagStyle = getCachedLabelStyle(vesselName, accent, 18);
    return [iconStyle, tagStyle];
  }

  return iconStyle;
}

/**
 * Produces vector style for a NASA FIRMS thermal hotspot fire target.
 */
export function getFireStyle(feature: FeatureLike): Style {
  const frp = (feature.get("frp") as number) || 10;
  const color = frp > 200 ? "#ef4444" : frp > 50 ? "#f97316" : "#eab308";
  const cacheKey = `fire:${color}`;

  return getCachedStyle(cacheKey, () => {
    return new Style({
      image: new Icon({
        src: buildFireSvg(color),
        anchor: [0.5, 0.5],
        scale: frp > 200 ? 1.2 : frp > 50 ? 1.0 : 0.85,
      }),
    });
  });
}

/**
 * Produces proportional vector style for a USGS seismic earthquake epicenter.
 */
export function getEarthquakeStyle(feature: FeatureLike): Style {
  const mag = (feature.get("magnitude") as number) || 3.0;
  const magQuant = Math.round(mag * 2) / 2; // Quantize to 0.5 increments
  const color =
    mag >= 6.0
      ? "#ef4444"
      : mag >= 4.5
        ? "#f59e0b"
        : "#06b6d4";

  const cacheKey = `earthquake:${color}:${magQuant}`;

  return getCachedStyle(cacheKey, () => {
    return new Style({
      image: new Icon({
        src: buildEarthquakeSvg(color, mag),
        anchor: [0.5, 0.5],
        scale: 1.0,
      }),
    });
  });
}

/**
 * Estimated voyage-route styles (S-52 convention: dashed = predicted path,
 * never traveled). The line is a dashed neutral hairline in the MarineTraffic/
 * VesselFinder manner; ECDIS conspicuous magenta is reserved for own-ship
 * planned routes, so third-party voyage estimates stay neutral white.
 */
const ROUTE_LINE_DASH = [6, 9];

export function getVesselRouteLineStyle(feature: FeatureLike): Style {
  const emphasized = Boolean(feature.get("isEmphasized"));
  const cacheKey = `vessel-route-line:${emphasized}`;

  return getCachedStyle(cacheKey, () =>
    new Style({
      stroke: new Stroke({
        color: emphasized ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.38)",
        width: emphasized ? 2 : 1.5,
        lineDash: ROUTE_LINE_DASH,
      }),
    }),
  );
}

/**
 * Destination-port marker: an open hairline ring (no fill), with the port name
 * plus distance/ETA statistic appearing only when the vessel is hovered or
 * selected — matching the emphasis contract used by the other telemetry tags.
 */
export function getVesselRoutePortStyle(feature: FeatureLike): Style | Style[] {
  const emphasized = Boolean(feature.get("isEmphasized"));
  const markerKey = `vessel-route-port:${emphasized}`;

  const markerStyle = getCachedStyle(markerKey, () =>
    new Style({
      image: new CircleStyle({
        radius: emphasized ? 5.5 : 4.5,
        stroke: new Stroke({
          color: emphasized ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.55)",
          width: emphasized ? 2 : 1.5,
        }),
      }),
    }),
  );

  if (!emphasized) return markerStyle;

  const portLabel = String(feature.get("routeLabel") || "");
  const stats = String(feature.get("routeStats") || "");
  if (!portLabel) return markerStyle;

  const text = stats ? `${portLabel} · ${stats}` : portLabel;
  return [markerStyle, getCachedLabelStyle(text, "rgba(255, 255, 255, 0.95)", -12)];
}
