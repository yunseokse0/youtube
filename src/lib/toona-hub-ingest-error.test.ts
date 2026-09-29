import { describe, expect, it } from "vitest";
import { ingestErrorVisibleAfterLink } from "./toona-hub-ingest-error";

describe("ingestErrorVisibleAfterLink", () => {
  const linkedAt = Date.parse("2026-09-29T08:47:57.000Z");

  it("drops an ingest failure from before this link", () => {
    expect(
      ingestErrorVisibleAfterLink({
        linkedAt,
        lastIngestAt: "2026-09-29T08:44:01.000Z",
        lastIngestOk: false,
        lastIngestError: "HTTP 502",
      })
    ).toBeNull();
  });

  it("drops an error that has no ingest time", () => {
    expect(
      ingestErrorVisibleAfterLink({
        linkedAt,
        lastIngestAt: null,
        lastIngestError: "HTTP 502",
      })
    ).toBeNull();
  });

  it("keeps an ingest failure that happened after this link", () => {
    expect(
      ingestErrorVisibleAfterLink({
        linkedAt,
        lastIngestAt: "2026-09-29T08:50:00.000Z",
        lastIngestOk: false,
        lastIngestError: "HTTP 502",
      })
    ).toBe("HTTP 502");
  });
});
