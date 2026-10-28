import { describe, expect, it } from "bun:test";
import {
  isTauriEnvironment,
  getDatasetManifest,
  registerGeoJsonWithRust,
  getLayerRecordsFromRust,
  hasLayerInRust,
} from "./tiledBackend";

describe("tiledBackend", () => {
  it("safely detects non-Tauri test environment without throwing", () => {
    const inTauri = isTauriEnvironment();
    expect(typeof inTauri).toBe("boolean");
  });

  it("getDatasetManifest safely falls back in non-Tauri environment", async () => {
    const manifest = await getDatasetManifest();
    expect(Array.isArray(manifest)).toBe(true);
  });

  it("registerGeoJsonWithRust returns null in non-Tauri environment", async () => {
    const result = await registerGeoJsonWithRust("test_layer", [
      {
        id: "p1",
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { name: "Origin" },
      },
    ]);
    expect(result).toBeNull();
  });

  it("getLayerRecordsFromRust returns null in non-Tauri environment", async () => {
    const result = await getLayerRecordsFromRust("test_layer", 0, 10);
    expect(result).toBeNull();
  });

  it("hasLayerInRust returns false in non-Tauri environment", async () => {
    const exists = await hasLayerInRust("nonexistent");
    expect(exists).toBe(false);
  });
});
