import { describe, expect, it } from "vitest";
import {
  normalizeDonationTableColumnsOptions,
  resolveDonationTableColumnsOptions,
} from "./donation-table-options";

describe("donation-table-options", () => {
  it("defaults all columns on when unset", () => {
    expect(resolveDonationTableColumnsOptions(null)).toEqual({
      showCombinedColumn: true,
      showContributionColumn: true,
      showRestroomColumn: true,
      showTableSumRow: true,
      showContributionSum: true,
    });
  });

  it("respects explicit false values", () => {
    expect(
      resolveDonationTableColumnsOptions({
        showCombinedColumn: false,
        showTableSumRow: false,
      })
    ).toMatchObject({
      showCombinedColumn: false,
      showTableSumRow: false,
      showContributionColumn: true,
    });
  });

  it("normalizeDonationTableColumnsOptions stores booleans", () => {
    expect(normalizeDonationTableColumnsOptions({ showContributionSum: false })).toEqual({
      showCombinedColumn: true,
      showContributionColumn: true,
      showRestroomColumn: true,
      showTableSumRow: true,
      showContributionSum: false,
    });
  });

  it("showRestroomColumn can be turned off", () => {
    expect(normalizeDonationTableColumnsOptions({ showRestroomColumn: false })).toMatchObject({
      showRestroomColumn: false,
    });
    expect(resolveDonationTableColumnsOptions({ showRestroomColumn: false })).toMatchObject({
      showRestroomColumn: false,
    });
  });
});
