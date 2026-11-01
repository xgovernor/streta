import { beforeEach, describe, expect, test } from "bun:test";
import { useMapStore } from "../state/mapStore";
import { useProjectStore } from "../state/projectStore";

describe("BookmarkContextMenu state & actions", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useMapStore.getState().setBookmarkContextMenu(null);
  });

  test("opens context menu for target bookmark with coordinates", () => {
    const bm = useProjectStore.getState().addBookmark({
      title: "Alpha Checkpoint",
      notes: "Forward recon outpost",
      lon: 10.5,
      lat: 53.5,
      zoom: 14,
      priority: "routine",
      tier: "project",
    });

    useMapStore.getState().setBookmarkContextMenu({
      x: 350,
      y: 280,
      bookmarkId: bm.id,
    });

    const menu = useMapStore.getState().bookmarkContextMenu;
    expect(menu).not.toBeNull();
    expect(menu?.bookmarkId).toBe(bm.id);
    expect(menu?.x).toBe(350);
    expect(menu?.y).toBe(280);

    const storedBm = useProjectStore.getState().bookmarks.find((b) => b.id === menu?.bookmarkId);
    expect(storedBm).toBeDefined();
    expect(storedBm?.title).toBe("Alpha Checkpoint");
  });

  test("updates priority directly via store actions", () => {
    const bm = useProjectStore.getState().addBookmark({
      title: "Chokepoint Bravo",
      lon: 12.0,
      lat: 45.0,
      zoom: 12,
      priority: "routine",
    });

    useProjectStore.getState().updateBookmark(bm.id, { priority: "flash" });
    const updated = useProjectStore.getState().bookmarks.find((b) => b.id === bm.id);
    expect(updated?.priority).toBe("flash");
  });

  test("toggles storage tier between project and user", () => {
    const bm = useProjectStore.getState().addBookmark({
      title: "Temporary Observation",
      lon: 8.5,
      lat: 47.3,
      zoom: 13,
      tier: "project",
    });

    useProjectStore.getState().updateBookmark(bm.id, { tier: "user" });
    let updated = useProjectStore.getState().bookmarks.find((b) => b.id === bm.id);
    expect(updated?.tier).toBe("user");

    useProjectStore.getState().updateBookmark(bm.id, { tier: "project" });
    updated = useProjectStore.getState().bookmarks.find((b) => b.id === bm.id);
    expect(updated?.tier).toBe("project");
  });

  test("snaps bookmark coordinates to new values during map drag or camera snap", () => {
    const bm = useProjectStore.getState().addBookmark({
      title: "Draggable Pin",
      lon: 1.0,
      lat: 2.0,
      zoom: 10,
    });

    // Simulate drag release translation
    useProjectStore.getState().updateBookmark(bm.id, {
      lon: 1.054321,
      lat: 2.098765,
    });

    const updated = useProjectStore.getState().bookmarks.find((b) => b.id === bm.id);
    expect(updated?.lon).toBe(1.054321);
    expect(updated?.lat).toBe(2.098765);
  });
});

