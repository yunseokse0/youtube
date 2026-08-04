import { describe, expect, it } from "vitest";
import { parseSigMetaFromFileName, parseSigPriceToken } from "./sig-filename-meta";

describe("parseSigPriceToken", () => {
  it("parses comma-separated amounts", () => {
    expect(parseSigPriceToken("1,000,000")).toBe(1_000_000);
    expect(parseSigPriceToken("77,000")).toBe(77_000);
  });

  it("rejects non-numeric tokens", () => {
    expect(parseSigPriceToken("foo")).toBeNull();
    expect(parseSigPriceToken("1만")).toBeNull();
  });
});

describe("parseSigMetaFromFileName", () => {
  it("parses amount_name filenames", () => {
    expect(parseSigMetaFromFileName("1,000,000_버터플라이.gif")).toEqual({
      baseName: "1,000,000_버터플라이",
      name: "버터플라이",
      price: 1_000_000,
      priceFromFileName: true,
    });
    expect(parseSigMetaFromFileName("1000000_버터플라이.png")).toEqual({
      baseName: "1000000_버터플라이",
      name: "버터플라이",
      price: 1_000_000,
      priceFromFileName: true,
    });
  });

  it("keeps name after first underscore when price prefix is valid", () => {
    expect(parseSigMetaFromFileName("50000_클럽_춤.gif").name).toBe("클럽_춤");
    expect(parseSigMetaFromFileName("50000_클럽_춤.gif").price).toBe(50_000);
  });

  it("does not treat non-price prefixes as amounts", () => {
    expect(parseSigMetaFromFileName("04클럽춤.gif")).toEqual({
      baseName: "04클럽춤",
      name: "04클럽춤",
      price: 0,
      priceFromFileName: false,
    });
    expect(parseSigMetaFromFileName("foo_bar.gif")).toEqual({
      baseName: "foo_bar",
      name: "foo_bar",
      price: 0,
      priceFromFileName: false,
    });
  });
});
