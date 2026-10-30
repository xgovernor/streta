import { describe, expect, test } from "bun:test";
import { useMapStore } from "./mapStore";

describe("mapStore measurement context menu", () => {
  test("initializes with measureContextMenu as null", () => {
    expect(useMapStore.getState().measureContextMenu).toBeNull();
  });

  test("sets and clears measureContextMenu state", () => {
    useMapStore.getState().setMeasureContextMenu({
      x: 350,
      y: 420,
      coords: [
        [13.405, 52.52],
        [13.415, 52.53],
      ],
      geomType: "LineString",
      distanceMeters: 1540.25,
      formattedDistance: "1.54 km",
      formattedNauticalMiles: "0.83 NM",
      formattedMiles: "0.96 mi",
      vertexCount: 2,
    });

    const menu = useMapStore.getState().measureContextMenu;
    expect(menu).not.toBeNull();
    expect(menu?.formattedDistance).toBe("1.54 km");
    expect(menu?.coords.length).toBe(2);
    expect(menu?.x).toBe(350);
    expect(menu?.y).toBe(420);

    useMapStore.getState().setMeasureContextMenu(null);
    expect(useMapStore.getState().measureContextMenu).toBeNull();
  });
});
