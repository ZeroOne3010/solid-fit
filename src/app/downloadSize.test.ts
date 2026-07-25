import { describe, expect, it } from "vitest";
import { formatDownloadSize } from "./downloadSize";

describe("formatDownloadSize", () => {
  it("shows the full archive size when every file is selected", () => {
    expect(formatDownloadSize(23 * 1024, 5, 5)).toBe("23 KB");
  });

  it("estimates a partial archive size from the selected file ratio", () => {
    expect(formatDownloadSize(100 * 1024, 3, 10)).toBe("~30 KB");
  });

  it("rounds a partial estimate up to the nearest kilobyte", () => {
    expect(formatDownloadSize(25 * 1024, 1, 2)).toBe("~13 KB");
  });
});
