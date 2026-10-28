import { describe, expect, test } from "bun:test";
import { joinTable, normalizeJoinKey, parseJoinTable, previewJoin } from "./join";
import { createLayer } from "./layers";
import type { FeatureRecord } from "./types";

function boundaries(): FeatureRecord[] {
  return [
    {
      id: "1",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [90, 23],
            [91, 23],
            [91, 24],
            [90, 24],
            [90, 23],
          ],
        ],
      },
      properties: { adm2_name: "Barguna", adm2_pcode: "BD1004", POP: 0 },
    },
    {
      id: "2",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [91, 23],
            [92, 23],
            [92, 24],
            [91, 24],
            [91, 23],
          ],
        ],
      },
      properties: { adm2_name: "Bhola", adm2_pcode: "BD1009", POP: 0 },
    },
  ];
}

function layer() {
  return createLayer({
      datasetId: "dataset-a",
    name: "districts",
    features: boundaries(),
    crs: "EPSG:4326",
    format: "geojson",
  });
}

describe("parseJoinTable", () => {
  test("reads headers and rows from a delimited file", () => {
    const table = parseJoinTable(
      "ADM2_PCODE,ADM2_NAME,T_TL\nBD1004,Barguna,898288\nBD1009,Bhola,1819020\n",
      "population",
    );

    expect(table.headers).toEqual(["ADM2_PCODE", "ADM2_NAME", "T_TL"]);
    expect(table.rows).toHaveLength(2);
  });

  test("needs a header and at least one row", () => {
    expect(() => parseJoinTable("ADM2_PCODE\n", "empty")).toThrow(/header row/);
  });
});

describe("normalizeJoinKey", () => {
  test("ignores case and surrounding space", () => {
    expect(normalizeJoinKey(" BD1004 ")).toBe("bd1004");
    expect(normalizeJoinKey("bd1004")).toBe(normalizeJoinKey("BD1004"));
    expect(normalizeJoinKey(null)).toBe("");
  });
});

describe("joinTable", () => {
  test("matches on a key written in different cases", () => {
    const table = parseJoinTable(
      "ADM2_PCODE,T_TL\nbd1004,898288\nbd1009,1819020\n",
      "population",
    );
    const outcome = joinTable(layer(), table, "ADM2_PCODE", "adm2_pcode");

    expect(outcome.preview.matchedRows).toBe(2);
    expect(outcome.preview.matchedFeatures).toBe(2);
    expect(outcome.features[0].properties.T_TL).toBe(898288);
    expect(outcome.features[1].properties.T_TL).toBe(1819020);
  });

  test("keeps the geometry and the layer's own columns", () => {
    const table = parseJoinTable("ADM2_PCODE,T_TL\nBD1004,898288\n", "population");
    const outcome = joinTable(layer(), table, "ADM2_PCODE", "adm2_pcode");

    expect(outcome.features[0].geometry.type).toBe("Polygon");
    expect(outcome.features[0].properties.adm2_name).toBe("Barguna");
    // The unmatched feature keeps its own columns and gains no table column.
    expect(outcome.features[1].properties.T_TL).toBeUndefined();
    expect(outcome.features[1].properties.adm2_name).toBe("Bhola");
  });

  test("reports rows with no matching feature", () => {
    const table = parseJoinTable(
      "ADM2_PCODE,T_TL\nBD1004,1\nBD9999,2\n",
      "population",
    );
    const outcome = joinTable(layer(), table, "ADM2_PCODE", "adm2_pcode");

    expect(outcome.preview.matchedRows).toBe(1);
    expect(outcome.preview.unmatchedSample).toEqual(["bd9999"]);
    expect(outcome.warnings.join(" ")).toMatch(/no matching feature/);
  });

  test("flags a table column that overwrites the layer's own value", () => {
    const table = parseJoinTable("ADM2_PCODE,POP\nBD1004,898288\n", "population");
    const outcome = joinTable(layer(), table, "ADM2_PCODE", "adm2_pcode");

    expect(outcome.replacedColumns).toEqual(["POP"]);
    expect(outcome.features[0].properties.POP).toBe(898288);
  });

  test("counts empty keys and duplicate keys", () => {
    const table = parseJoinTable(
      "ADM2_PCODE,T_TL\n,5\nBD1004,1\nBD1004,2\n",
      "population",
    );
    const outcome = joinTable(layer(), table, "ADM2_PCODE", "adm2_pcode");

    expect(outcome.warnings.join(" ")).toMatch(/empty key/);
    expect(outcome.warnings.join(" ")).toMatch(/more than once/);
    expect(outcome.features[0].properties.T_TL).toBe(2);
  });

  test("refuses a join that matches nothing", () => {
    const table = parseJoinTable("ADM2_PCODE,T_TL\nZZ1,1\n", "population");
    const target = layer();

    expect(() => joinTable(target, table, "ADM2_PCODE", "adm2_pcode")).toThrow(
      /matched/,
    );
    expect(previewJoin(target, table, "ADM2_PCODE", "adm2_pcode").matchedFeatures).toBe(0);
  });

  test("refuses a key column the table does not have", () => {
    const table = parseJoinTable("ADM2_PCODE,T_TL\nBD1004,1\n", "population");

    expect(() => joinTable(layer(), table, "PCODE", "adm2_pcode")).toThrow(
      /not a column/,
    );
  });
});
