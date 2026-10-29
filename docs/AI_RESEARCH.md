# Geospatial AI Implementation & Use Cases Research
**Project:** Strata ("God's Eye View" Geospatial Intelligence Platform)  
**Date:** October 2026  
**Architecture:** Tauri 2 (Rust) · OpenLayers 10 WebGL · React 19 · Proj4 · ZeroClaw  

---

## Executive Summary

**Strata** is a high-performance desktop and web geospatial platform combining multi-band Earth Observation (Sentinel-2 COGs, Copernicus DEM), real-time live telemetry feeds (ADS-B flights, USGS seismology, SGP4 satellite orbits), global infrastructure topology (CCTV viewsheds, submarine cables, datacenters, dams, military installations), and out-of-core spatial vector analytics.

Between 2024 and 2026, geospatial computing underwent a structural revolution:
1. **Agentic GIS:** Moving beyond static menus and manual tool selection toward autonomous spatial agents executing multi-step GIS workflows via natural language and the **Model Context Protocol (MCP)**.
2. **Geospatial Foundation Models (GeoFMs):** Shifting from brittle single-task classifiers to multi-sensor foundation models (NASA-IBM **Prithvi-EO-2.0**, **Clay Foundation v1.5**, **SatMAE**) that output dense spatial embeddings for zero-shot pattern matching and change detection.
3. **Edge & In-Orbit Inference:** Deploying compact, quantized vision models directly on edge devices, UAVs, and satellites to analyze raw telemetry and pixel streams in real time.

This document establishes the strategic AI use cases, system architecture, tool schemas, and technical implementation blueprint tailored specifically to Strata's local-first, privacy-enforced Tauri architecture.

---

## 1. High-Value AI Use Cases for Strata

```
                                  STRATA AI ENGINE
                                         │
    ┌────────────────────┬───────────────┴───────────────┬────────────────────┐
    ▼                    ▼                               ▼                    ▼
[Agentic Copilot] [Telemetry Anomalies]        [GeoFM Tile Search]   [Multimodal CCTV]
 • NL to Spatial   • ADS-B squawk/deviations     • Vector embeddings   • Traffic density
 • Multi-step GIS  • Seismic impact radius       • Zero-shot landcover • Weather/visibility
 • Dynamic layers  • Satellite pass prediction   • Flood/burn masks    • FOV cone analysis
```

### 1.1 Natural Language Spatial Intelligence ("Agentic GIS")
* **Concept:** Analysts describe analytical objectives in natural language; an autonomous spatial agent plans, executes, and visualizes the solution across Strata’s vector, raster, and telemetry layers.
* **Representative Query:**
  > *"Locate all military airfields within 100 km of seismic activity greater than M5.0 in the last 24 hours, and flag any commercial flights currently crossing that impact envelope."*
* **Autonomous Execution Steps:**
  1. Parse prompt into structured tool calls via LLM function calling / MCP.
  2. Query live earthquake feeds (`fetch_live_earthquakes("day")`) and filter `mag >= 5.0`.
  3. Compute geodesic buffer rings with $r = 100\text{ km}$ via Rust `analysis::tools::generate_geodesic_buffer`.
  4. Perform spatial intersection against `osm_military` in `datasets.toml`.
  5. Intersect bounding corridors against live ADS-B flight vectors.
  6. Emit a dynamic GeoJSON layer into OpenLayers with alert rings and focus camera.

### 1.2 Real-Time Multi-Feed Telemetry Anomaly Detection
* **ADS-B Aerial Telemetry:**
  - **Emergency Squawk Alerts:** Immediate automated tracking on emergency codes (`7500` hijack, `7600` radio failure, `7700` emergency).
  - **Flight Envelope Anomalies:** Moving-window anomaly detection (Isolation Forests / autoencoders) tracking vertical descent rate spikes ($> 4,000\text{ ft/min}$), sudden velocity roll-offs, or radar track discontinuities.
  - **GPS Jamming & Spoofing Indicators:** Detecting multiple aircraft experiencing simultaneous positioning drift or degraded navigational accuracy figures (NACp).
* **Seismic Infrastructure Impact Estimation:**
  - Upon receiving a USGS seismic event, compute ground motion attenuation (ShakeMap MMI contours) and run rapid spatial joins against **submarine fiber cables, hydroelectric dams, and OSM datacenters** to generate instant risk impact dossiers.
* **Satellite Conjunctions & Ground Intercepts:**
  - Propagate SGP4 orbits to forecast when reconnaissance or synthetic aperture radar (SAR) satellites intersect active CCTV camera viewshed cones or sensitive facilities.

### 1.3 Geospatial Foundation Models (GeoFMs) on Multi-Band COGs
* **Embeddings-as-a-Tile ("Search by Example"):**
  - Using Clay Foundation v1.5 or Prithvi-EO-2.0 via on-device ONNX runtime:
  - Generate a 512-dimensional embedding vector for any $256 \times 256$ pixel multispectral patch (B02–B12).
  - **User Interaction:** Draw a bounding box over a solar farm, open-pit lithium mine, or wildfire burn scar $\rightarrow$ Strata scans regional COG tiles in WebGL texture memory for nearest-neighbor cosine similarity $\rightarrow$ returns high-confidence candidate patches across the globe.
* **Zero-Shot Environmental Delineation:**
  - Automatically convert dynamic WebGL shader bands (NDVI, NDWI, NBR) into vector polygon geometries for wildfire burn severity mapping or sudden flood inundation extents without manual thresholding.

### 1.4 Multimodal CCTV & Edge Viewshed Vision
* **Traffic Camera Scene Understanding:**
  - Ingest public traffic camera stills linked in `cctv_cameras` with 3D ellipsoidal heights.
  - Run compact Vision-Language Models (e.g. **Moondream2**, **PaliGemma 2**, or **YOLOv11-OBB**).
  - Extract structured metrics: vehicle count, congestion category, lane obstruction, and visibility/weather conditions (fog, snow, rain) that dynamically tint the camera's 3D viewshed cone.

### 1.5 Semantic Data Harmonization & Fuzzy Joins
* **Automated Entity Resolution:**
  - Strata’s attribute join engine currently matches exact keys (`ADM2_PCODE`).
  - LLM/Embedding-assisted joins reconcile messy field datasets (e.g., misspelled county names, historical district boundaries, multi-lingual transliterations in Bengali/Arabic) with confidence scoring.

---

## 2. Technical Architecture Blueprint

Strata enforces a **strict local-first, zero-leak security architecture** where the WebView is forbidden from making direct external HTTP requests, and all I/O is sandboxed through the `strata://` IPC protocol. The AI engine preserves these guarantees.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND (React 19 / OpenLayers 10)              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐ │
│  │   AI Copilot Bar     │  │ WebGL Raster Shaders │  │ Map Highlight      │ │
│  │   (Natural Language) │  │ (Real-time Masking)  │  │ (GeoJSON Vector)   │ │
│  └──────────┬───────────┘  └──────────▲───────────┘  └────────▲───────────┘ │
└─────────────┼─────────────────────────┼───────────────────────┼─────────────┘
              │ Tauri IPC Invocation    │ strata:// protocol    │
┌─────────────▼─────────────────────────┴───────────────────────┴─────────────┐
│                         STRATA TAURI 2 BACKEND (Rust)                       │
│                                                                             │
│  ┌───────────────────────────┐         ┌─────────────────────────────────┐  │
│  │     Strata MCP Tools      │         │   ONNX Runtime (`ort` crate)    │  │
│  │  - buffer_query           │         │  - Clay/Prithvi GeoFM Embeddings│  │
│  │  - measure_geodesic       │         │  - Anomaly Autoencoder (ADS-B)  │  │
│  │  - elevation_profile      │         │  - Fast feature classification  │  │
│  │  - register_vector_layer  │         └────────────────┬────────────────┘  │
│  └───────────┬───────────────┘                          │                   │
│              │                                          │                   │
│  ┌───────────▼───────────────┐         ┌────────────────▼────────────────┐  │
│  │   ZeroClaw Agent Core     │         │   ByteRangeCache (COGs)         │  │
│  │  (Workspace-embedded LLM  │         │   Cached band tiles             │  │
│  │   orchestrator / Ollama)  │         │                                 │  │
│  └───────────────────────────┘         └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Model Context Protocol (MCP) Tool Manifest
Strata’s Rust analytical engine provides first-class endpoints registered as MCP tools:

| MCP Tool Identifier | Parameters | Return Schema | Target Rust Implementation |
| :--- | :--- | :--- | :--- |
| `spatial_buffer` | `center: [lon, lat]`, `radius_km: f64` | `GeoJSON Polygon` | `analysis::tools::generate_geodesic_buffer` |
| `elevation_profile` | `coords: [[lon, lat], ...]` | `Array<{dist_m, elev_m}>` | `commands::elevation_profile` |
| `query_telemetry` | `feed: "flights" \| "earthquakes" \| "satellites"` | `Array<TelemetryTarget>` | `commands::fetch_telemetry_binary` |
| `inspect_raster` | `layer_id: str`, `formula: str`, `bbox: [4]f64` | `RasterStats` | `raster::RasterRegistry` |
| `create_layer` | `name: str`, `geojson: FeatureCollection` | `{layer_id, bounds}` | `commands::register_geojson_layer` |
| `spatial_join` | `source_layer: str`, `target_layer: str`, `predicate: str` | `{matched_count, results}` | `analysis::tools::spatial_buffer_query` |

### 2.2 ZeroClaw Integration in the Workspace
The repository includes the **ZeroClaw** agent runtime (`/zeroclaw`):
* ZeroClaw is a single-binary Rust runtime supporting **local LLMs via Ollama / llama.cpp**, custom MCP tools, and multi-channel messaging.
* **Integration Strategy:**
  - Strata runs ZeroClaw as an embedded Tokio service or connects via local loopback IPC.
  - Air-gapped deployments run local open models (`qwen2.5-coder:7b`, `llama3.3:8b`) with zero cloud data transmission.
  - Enterprise deployments can optionally configure OpenAI, Anthropic, or Gemini API keys within Strata’s secure preferences.

### 2.3 On-Device Vision & Anomaly Inference (ONNX Runtime)
* **Rust Dependency:** `ort = { version = "2.0", features = ["load-dynamic"] }`
* **Features:**
  - Execute quantized `.onnx` models (e.g. YOLOv11n for CCTV vehicle detection or an ADS-B flight autoencoder) without requiring a Python environment.
  - Native multithreaded CPU and Vulkan/CUDA acceleration directly on the host machine.

---

## 3. End-to-End Execution Walkthrough

```
1. USER PROMPT
   "Find all earthquakes in California > M4.0 today, buffer by 75km, and check if any data centers are inside."

2. AGENT WORKFLOW PLAN (ZeroClaw / LLM Orchestrator)
   ├── Step 1: query_telemetry(feed="earthquakes", bbox=[-124.5, 32.5, -114.1, 42.0])
   ├── Step 2: filter(mag >= 4.0)
   ├── Step 3: spatial_buffer(center=[quake.lon, quake.lat], radius_km=75.0)
   ├── Step 4: spatial_join(buffer_polys, dataset_id="osm_datacenters", predicate="intersects")
   └── Step 5: render_result_layer(name="Seismic Hazard - Datacenters", features=[...])

3. RUST BACKEND EXECUTION
   ├── Tokio workers fetch live USGS GeoJSON feed
   ├── Geodesic ellipsoidal buffer generated via Vincenty forward formulas
   ├── R-Tree index in memory tests Datacenter polygon intersection
   └── Returns GeoJSON payload + summary metrics

4. FRONTEND OPENLAYERS RENDERING
   ├── MapController mounts new VectorLayer with styled pulsing rings
   ├── Camera smoothly flies to envelope (flyToCoordinate)
   └── Toast & HUD display: "Found 3 datacenters within 75km of M4.4 near Ridgecrest"
```

---

## 4. Phased Implementation Roadmap

```
2026 ROADMAP
├── Phase 6: Agentic Copilot & MCP Tool Bridge
│   ├── Interactive Command Bar (`Cmd+K` / Ribbon Icon)
│   ├── Expose Strata Rust commands as MCP endpoints
│   └── Local Ollama / ZeroClaw runtime connector
│
├── Phase 7: Real-Time Telemetry Anomaly Detection
│   ├── ADS-B emergency squawk & flight envelope monitor
│   ├── Automatic ShakeMap impact buffers on seismic events
│   └── Alert Notification Drawer & HUD focus tags
│
└── Phase 8: GeoFM Embeddings & Semantic Search
    ├── ONNX Runtime integration in `src-tauri`
    ├── "Search Similar" bounding-box embedding match on Sentinel-2 COGs
    └── Dynamic AI flood & wildfire burn polygon extraction
```

---

## 5. Security & Privacy Guarantees

| Requirement | Implementation in Strata |
| :--- | :--- |
| **Zero External Leakage** | All COG and tile traffic is strictly constrained to `strata://` URIs. No outbound telemetry or queries leave the system without explicit user proxy configuration. |
| **Air-Gapped Operation** | Local foundation models and Ollama run completely offline on local compute (CPU / GPU). |
| **Reproducibility** | All agent-generated spatial layers, buffers, and queries are serialized into standard `.strata` project files with complete provenance metadata. |
