import { describe, expect, test } from "bun:test";
import { LIBRARY, libraryProduct } from "./library";

describe("library products", () => {
  test("includes the cctv-cameras product", () => {
    const product = libraryProduct("cctv-cameras");
    expect(product).toBeDefined();
    expect(product?.name).toBe("Traffic cameras");
    expect(product?.layers.length).toBe(2);

    const [camerasLayer, viewshedsLayer] = product?.layers ?? [];
    expect(camerasLayer.name).toBe("Cameras");
    expect(camerasLayer.object).toBe("cameras");
    expect(camerasLayer.idPrefix).toBe("cctv-cam-");

    expect(viewshedsLayer.name).toBe("Coverage cones");
    expect(viewshedsLayer.object).toBe("viewsheds");
    expect(viewshedsLayer.idPrefix).toBe("cctv-cone-");
  });

  test("all registered library products have valid layers and ids", () => {
    for (const prod of LIBRARY) {
      expect(prod.id.length).toBeGreaterThan(0);
      expect(prod.name.length).toBeGreaterThan(0);
      expect(prod.layers.length).toBeGreaterThan(0);
      for (const layer of prod.layers) {
        expect(layer.name.length).toBeGreaterThan(0);
        expect(layer.object.length).toBeGreaterThan(0);
        expect(layer.idPrefix.length).toBeGreaterThan(0);
      }
    }
  });
});
