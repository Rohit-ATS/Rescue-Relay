import { describe, expect, it } from "vitest";
import { formatClock, formatDay, formatMoment } from "@/lib/format";

describe("Timestamp formatting", () => {
  const moment = "2026-10-05T18:40:00Z";

  it("reads as English regardless of the browser locale", () => {
    // A Vietnamese browser rendered this as "19:40 5 thg 10" via toLocaleString.
    expect(formatMoment(moment)).toMatch(/^Oct \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)$/);
  });

  it("names the month, so the day can never be mistaken for it", () => {
    expect(formatMoment(moment)).toContain("Oct");
    expect(formatDay(moment)).toMatch(/^Oct \d{1,2}$/);
  });

  it("gives a bare clock time when the day is already known", () => {
    expect(formatClock(moment)).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
    expect(formatClock(moment)).not.toContain("Oct");
  });

  it("degrades to a dash rather than Invalid Date", () => {
    for (const bad of ["", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(formatMoment(bad)).toBe("—");
      expect(formatClock(bad)).toBe("—");
      expect(formatDay(bad)).toBe("—");
    }
  });
});
