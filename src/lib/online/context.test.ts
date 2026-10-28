import { describe, expect, test } from "bun:test";
import {
  addressLine,
  osmFromOverpass,
  overpassQuery,
  parseOsmRef,
  placeFromNominatim,
  wikiFromSummary,
  wikipediaTarget,
} from "./context";

describe("addressLine", () => {
  test("orders the parts and drops repeats", () => {
    expect(
      addressLine({
        country: "Switzerland",
        state: "Zürich",
        city: "Zürich",
        road: "Bahnhofstrasse",
        house_number: "1",
      }),
    ).toBe("1, Bahnhofstrasse, Zürich, Switzerland");
  });

  test("survives a missing address", () => {
    expect(addressLine(undefined)).toBe("");
  });
});

describe("placeFromNominatim", () => {
  test("uses the name, the address line and the category", () => {
    expect(
      placeFromNominatim({
        name: "Bahnhofstrasse",
        display_name: "Bahnhofstrasse, Zürich, Switzerland",
        category: "highway",
        type: "residential",
        address: { road: "Bahnhofstrasse", city: "Zürich", country: "Switzerland" },
      }),
    ).toEqual({
      name: "Bahnhofstrasse",
      detail: "Bahnhofstrasse, Zürich, Switzerland",
      kind: "highway · residential",
    });
  });

  test("falls back to the first part of the display name", () => {
    const place = placeFromNominatim({
      display_name: "Somewhere, Elsewhere, Nowhere",
    });

    expect(place?.name).toBe("Somewhere");
    expect(place?.detail).toBe("Somewhere, Elsewhere, Nowhere");
    expect(place?.kind).toBeNull();
  });

  test("rejects an empty answer", () => {
    expect(placeFromNominatim({})).toBeNull();
  });
});

describe("wikipediaTarget", () => {
  test("reads a wikipedia tag with its language", () => {
    expect(wikipediaTarget({ wikipedia: "de:Zürich" })).toEqual({
      lang: "de",
      title: "Zürich",
      viaWikidata: false,
    });
  });

  test("keeps colons inside the title", () => {
    expect(wikipediaTarget({ wikipedia: "en:Battle of Stalingrad: 1942" })?.title).toBe(
      "Battle of Stalingrad: 1942",
    );
  });

  test("uses a wikidata id when there is no wikipedia tag", () => {
    expect(wikipediaTarget({ wikidata: "Q72" })).toEqual({
      lang: "en",
      title: "Q72",
      viaWikidata: true,
    });
  });

  test("ignores anything else", () => {
    expect(wikipediaTarget({})).toBeNull();
    expect(wikipediaTarget({ wikipedia: "Zürich" })).toBeNull();
    expect(wikipediaTarget({ wikidata: "72" })).toBeNull();
  });
});

describe("parseOsmRef", () => {
  test("reads the shapes OSM ids arrive in", () => {
    expect(parseOsmRef("r122949")).toEqual({ type: "relation", id: "122949" });
    expect(parseOsmRef("way/123")).toEqual({ type: "way", id: "123" });
    expect(parseOsmRef("node 42")).toEqual({ type: "node", id: "42" });
    expect(parseOsmRef("1176042553")).toEqual({ type: null, id: "1176042553" });
    expect(parseOsmRef("-19953989")).toEqual({ type: null, id: "19953989" });
  });

  test("rejects nonsense", () => {
    expect(parseOsmRef("")).toBeNull();
    expect(parseOsmRef("abc")).toBeNull();
    expect(parseOsmRef("way/")).toBeNull();
  });
});

describe("overpassQuery", () => {
  test("asks for the element type the id names", () => {
    expect(overpassQuery({ type: "relation", id: "122949" })).toBe(
      "[out:json][timeout:12];relation(122949);out tags;",
    );
  });

  test("tries every type when the id does not say", () => {
    expect(overpassQuery({ type: null, id: "42" })).toBe(
      "[out:json][timeout:12];(node(42);way(42);relation(42););out tags;",
    );
  });
});

describe("osmFromOverpass", () => {
  test("keeps the tagged element and sorts its tags", () => {
    const context = osmFromOverpass(
      {
        elements: [
          { type: "node", id: 7 },
          {
            type: "way",
            id: 123,
            tags: { name: "Test", operator: "EDF" },
          },
        ],
      },
      { type: null, id: "123" },
    );

    expect(context).toEqual({
      type: "way",
      id: "123",
      tags: [
        ["name", "Test"],
        ["operator", "EDF"],
      ],
      url: "https://www.openstreetmap.org/way/123",
    });
  });

  test("returns null when nothing carries tags", () => {
    expect(osmFromOverpass({ elements: [] }, { type: "way", id: "1" })).toBeNull();
  });
});

describe("wikiFromSummary", () => {
  test("keeps the article, its link and its thumbnail", () => {
    expect(
      wikiFromSummary(
        {
          title: "Zürich",
          extract: "Zürich is the largest city in Switzerland.",
          thumbnail: { source: "https://upload.wikimedia.org/x.jpg" },
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Z%C3%BCrich" } },
        },
        "en",
      ),
    ).toEqual({
      title: "Zürich",
      extract: "Zürich is the largest city in Switzerland.",
      lang: "en",
      thumbnail: "https://upload.wikimedia.org/x.jpg",
      url: "https://en.wikipedia.org/wiki/Z%C3%BCrich",
    });
  });

  test("builds the link when the API omits it", () => {
    expect(
      wikiFromSummary({ title: "Zug", extract: "A town." }, "de")?.url,
    ).toBe("https://de.wikipedia.org/wiki/Zug");
  });

  test("treats a summary without prose as no article", () => {
    expect(wikiFromSummary({ title: "Zug" }, "en")).toBeNull();
    expect(wikiFromSummary({ extract: "A town." }, "en")).toBeNull();
  });
});
