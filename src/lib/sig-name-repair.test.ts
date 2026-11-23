import { describe, expect, it } from "vitest";
import { repairMojibakeSigName, tryRecoverCp949Mojibake } from "./sig-name-repair";

describe("sig-name-repair", () => {
  describe("known corrupted sig names", () => {
    it("repairs NO BATIDR to NO BATIDÃO", () => {
      expect(repairMojibakeSigName("NO BATIDR")).toBe("NO BATIDÃO");
      expect(repairMojibakeSigName("no batidr")).toBe("NO BATIDÃO");
      expect(repairMojibakeSigName("NO  BATIDR")).toBe("NO BATIDÃO");
    });

    it("repairs NO BATID했O and NO BATID했다 to NO BATIDÃO", () => {
      expect(repairMojibakeSigName("NO BATID했O")).toBe("NO BATIDÃO");
      expect(repairMojibakeSigName("NO BATID했다")).toBe("NO BATIDÃO");
      expect(repairMojibakeSigName("NO BATID횄O")).toBe("NO BATIDÃO");
    });

    it("preserves proper NO BATIDÃO", () => {
      expect(repairMojibakeSigName("NO BATIDÃO")).toBe("NO BATIDÃO");
    });

    it("handles NO BATIDAO without tilde", () => {
      expect(repairMojibakeSigName("NO BATIDAO")).toBe("NO BATIDÃO");
    });
  });

  describe("CP949 mojibake auto recovery", () => {
    it("recovers CP949 decoded NO BATID횄O to NO BATIDÃO", () => {
      expect(tryRecoverCp949Mojibake("NO BATID횄O")).toBe("NO BATIDÃO");
      expect(repairMojibakeSigName("NO BATID횄O")).toBe("NO BATIDÃO");
    });

    it("recovers Vietnamese Tiếng Việt from CP949 mojibake", () => {
      expect(tryRecoverCp949Mojibake("Ti梳퓆g Vi沼뇍")).toBe("Tiếng Việt");
      expect(repairMojibakeSigName("Ti梳퓆g Vi沼뇍")).toBe("Tiếng Việt");
    });

    it("recovers Vietnamese Đà Nẵng and Hà Nội", () => {
      expect(repairMojibakeSigName("휂횪 N梳탇g")).toBe("Đà Nẵng");
      expect(repairMojibakeSigName("H횪 N沼셢")).toBe("Hà Nội");
    });

    it("does not corrupt normal Korean titles", () => {
      expect(repairMojibakeSigName("홍콩역화장실")).toBe("홍콩역화장실");
      expect(repairMojibakeSigName("우리집")).toBe("우리집");
      expect(repairMojibakeSigName("먹지마")).toBe("먹지마");
      expect(repairMojibakeSigName("버터플라이")).toBe("버터플라이");
      expect(repairMojibakeSigName("한글 시그 댄스")).toBe("한글 시그 댄스");
    });

    it("does not corrupt normal English titles", () => {
      expect(repairMojibakeSigName("Se Acabo (DIN MIX)")).toBe("Se Acabo (DIN MIX)");
      expect(repairMojibakeSigName("Apollo")).toBe("Apollo");
      expect(repairMojibakeSigName("Barbie Girl")).toBe("Barbie Girl");
    });
  });
});
