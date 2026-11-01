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

  test("initializes, sets, and clears bookmarkContextMenu state", () => {
    expect(useMapStore.getState().bookmarkContextMenu).toBeNull();

    useMapStore.getState().setBookmarkContextMenu({
      x: 220,
      y: 180,
      bookmarkId: "bm_test_123",
    });

    const menu = useMapStore.getState().bookmarkContextMenu;
    expect(menu).not.toBeNull();
    expect(menu?.bookmarkId).toBe("bm_test_123");
    expect(menu?.x).toBe(220);
    expect(menu?.y).toBe(180);

    useMapStore.getState().setBookmarkContextMenu(null);
    expect(useMapStore.getState().bookmarkContextMenu).toBeNull();
  });
});
