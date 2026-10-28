import { describe, expect, test } from "bun:test";
import { formatLat, formatLon } from "./format";

describe("formatLat / formatLon", () => {
  test("carries seconds rounded to 60 into the next minute and degree", () => {
    expect(formatLat(46.9999999, "dms")).toBe("47°00′00″ N");
    expect(formatLon(8.9999999, "dms")).toBe("9°00′00″ E");
    expect(formatLat(-33.9999999, "dms")).toBe("34°00′00″ S");
  });

  test("keeps a full minute without overflowing the degree", () => {
    expect(formatLat(46.9833333, "dms")).toBe("46°59′00″ N");
  });

  test("never prints 60 in the minutes or seconds field", () => {
    for (let degree = 0; degree < 3; degree += 1) {
      for (let second = 1; second <= 60; second += 1) {
        const value = degree + second / 3600 - 1e-9;
        expect(formatLat(value, "dms")).not.toMatch(/60[′″]/);
        expect(formatLon(-value, "dms")).not.toMatch(/60[′″]/);
      }
    }
  });

  test("formats ordinary values with the hemisphere suffix", () => {
    expect(formatLat(47.3769, "dms")).toBe("47°22′37″ N");
    expect(formatLon(-9.1393, "dms")).toBe("9°08′21″ W");
    expect(formatLat(-33.9249, "dms")).toBe("33°55′30″ S");
    expect(formatLat(0.5, "dms")).toBe("0°30′00″ N");
  });

  test("leaves decimal formatting unchanged at degree boundaries", () => {
    expect(formatLat(46.9999999, "decimal")).toBe("47.00000° N");
    expect(formatLon(-1.5, "decimal")).toBe("1.50000° W");
  });
});
