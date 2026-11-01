import { beforeEach, describe, expect, test } from "bun:test";
import { useProjectStore } from "../../state/projectStore";
import {
  exportBookmarksToCsv,
  exportBookmarksToGeoJson,
  exportBookmarksToKml,
  importBookmarksFromCsv,
  importBookmarksFromGeoJson,
  importBookmarksFromKml,
} from "../../lib/gis/bookmarksIo";

describe("BookmarksPanel state & actions", () => {
  beforeEach(() => {
    useProjectStore.getState().newProject();
  });

  test("adds a bookmark and separates project tier from personal user tier", () => {
    const store = useProjectStore.getState();

    const b1 = store.addBookmark({
      title: "Observation Post Alpha",
      notes: "High vantage point overlooking shipping lane",
      lon: 10.0,
      lat: 55.0,
      zoom: 14,
      rotation: 0.15,
      tier: "project",
      priority: "flash",
      status: "active",
      category: "Recon",
      color: "#ef4444",
    });

    const b2 = store.addBookmark({
      title: "Personal Scratchpad Point",
      notes: "User notes for local testing",
      lon: 11.0,
      lat: 56.0,
      zoom: 10,
      tier: "user",
      priority: "routine",
      status: "pending",
    });

    const state = useProjectStore.getState();
    expect(state.bookmarks.length).toBe(2);

    expect(b1.id).toBeDefined();
    expect(b1.tier).toBe("project");
    expect(b1.priority).toBe("flash");

    expect(b2.id).toBeDefined();
    expect(b2.tier).toBe("user");
    expect(b2.priority).toBe("routine");
  });

  test("updates an existing bookmark fields", () => {
    const store = useProjectStore.getState();

    const created = store.addBookmark({
      title: "Initial Post",
      lon: 12.0,
      lat: 45.0,
      zoom: 12,
      tier: "project",
    });

    store.updateBookmark(created.id, {
      title: "Updated Observation Post",
      notes: "Added tactical telemetry info",
      priority: "immediate",
      category: "Surveillance",
      color: "#f59e0b",
    });

    const updated = useProjectStore.getState().bookmarks.find((b) => b.id === created.id);
    expect(updated).toBeDefined();
    expect(updated?.title).toBe("Updated Observation Post");
    expect(updated?.notes).toBe("Added tactical telemetry info");
    expect(updated?.priority).toBe("immediate");
    expect(updated?.category).toBe("Surveillance");
    expect(updated?.color).toBe("#f59e0b");
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.createdAt);
  });

  test("removes a bookmark cleanly", () => {
    const store = useProjectStore.getState();

    const b1 = store.addBookmark({
      title: "Point To Keep",
      lon: 1,
      lat: 2,
      zoom: 10,
    });
    const b2 = store.addBookmark({
      title: "Point To Remove",
      lon: 3,
      lat: 4,
      zoom: 10,
    });

    expect(useProjectStore.getState().bookmarks.length).toBe(2);

    store.removeBookmark(b2.id);

    const remaining = useProjectStore.getState().bookmarks;
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(b1.id);
  });

  test("exports and re-imports bookmarks across KML, GeoJSON, and CSV", () => {
    const store = useProjectStore.getState();

    store.addBookmark({
      title: "Tactical HQ",
      notes: "Command center coordinates",
      lon: 8.54,
      lat: 47.37,
      zoom: 15,
      rotation: 0.35,
      tier: "project",
      priority: "flash",
      category: "Command",
      color: "#ef4444",
    });

    const activeList = useProjectStore.getState().bookmarks;

    // Test GeoJSON
    const geoJson = exportBookmarksToGeoJson(activeList);
    const importedGeoJson = importBookmarksFromGeoJson(geoJson, "project");
    expect(importedGeoJson.length).toBe(1);
    expect(importedGeoJson[0].title).toBe("Tactical HQ");
    expect(importedGeoJson[0].priority).toBe("flash");

    // Test KML
    const kml = exportBookmarksToKml(activeList, "HQ Test");
    const importedKml = importBookmarksFromKml(kml, "project");
    expect(importedKml.length).toBe(1);
    expect(importedKml[0].title).toBe("Tactical HQ");
    expect(importedKml[0].lon).toBeCloseTo(8.54, 2);

    // Test CSV
    const csv = exportBookmarksToCsv(activeList);
    const importedCsv = importBookmarksFromCsv(csv, "project");
    expect(importedCsv.length).toBe(1);
    expect(importedCsv[0].title).toBe("Tactical HQ");
    expect(importedCsv[0].category).toBe("Command");
  });
});

