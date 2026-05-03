import { describe, expect, it } from "vitest";

import { EUR, JPY } from "./currency";

describe("EUR validation", () => {
    const eur = new EUR();

    it.each([
        "PA8124161759",
        "EA3388561264",
        "UB8593576913",
        "EA3197622214",
        "EA2672713009",
        "RR3223530574",
        "VD2328660593",
    ])("accepts valid Europa-series serial %s", (serial) => {
        expect(eur.validate(serial, 10)).toBe(true);
    });

    it("accepts lowercase input", () => {
        expect(eur.validate("pa8124161759", 10)).toBe(true);
    });

    it.each([5, 10, 20, 50, 100, 200])("accepts supported denomination %i", (denomination) => {
        expect(eur.validate("PA8124161759", denomination)).toBe(true);
    });

    it.each([1, 2, 500, 1000])("rejects unsupported denomination %i", (denomination) => {
        expect(eur.validate("PA8124161759", denomination)).toBe(false);
    });

    it.each([
        { serial: "", reason: "empty input is not a serial" },
        { serial: "PA812416175", reason: "too short; Europa serials require 2 letters and 10 digits" },
        { serial: "PA81241617590", reason: "too long; Europa serials require exactly 12 characters" },
        { serial: "P8124161759", reason: "missing the second leading letter" },
        { serial: "PA812416175X", reason: "contains a non-digit in the numeric suffix" },
        { serial: "IA8124161759", reason: "I is not assigned a first-letter control value" },
        { serial: "OA8124161759", reason: "O is not assigned a first-letter control value" },
        { serial: "QA8124161759", reason: "Q is not assigned a first-letter control value" },
        { serial: "PA8124161758", reason: "checksum digit sequence does not match P's control value" },
    ])("rejects $serial because $reason", ({ serial }) => {
        expect(eur.validate(serial, 10)).toBe(false);
    });
});

describe("JPY validation", () => {
    const jpy = new JPY();

    it.each([
        { denomination: 1000, serial: "AA037730LS" },
        { denomination: 1000, serial: "AA540045MS" },
        { denomination: 1000, serial: "AA506605KS" },
        { denomination: 5000, serial: "AA431134VL" },
        { denomination: 5000, serial: "AA350053VL" },
        { denomination: 5000, serial: "AA391193TK" },
        { denomination: 10000, serial: "AA161373AH" },
    ])("accepts valid Series-F $denomination yen serial $serial", ({ denomination, serial }) => {
        expect(jpy.validate(serial, denomination)).toBe(true);
    });

    it.each([
        "SA815862T",
        "A069406A",
        "Z815962A",
        "AA495803A",
    ])("accepts valid Series-D 2000 yen serial %s", (serial) => {
        expect(jpy.validate(serial, 2000)).toBe(true);
    });

    it.each([
        { denomination: 1000, serial: "AA037730LS" },
        { denomination: 2000, serial: "SA815862T" },
        { denomination: 5000, serial: "AA431134VL" },
        { denomination: 10000, serial: "AA161373AH" },
    ])("accepts supported denomination $denomination with a valid serial", ({ denomination, serial }) => {
        expect(jpy.validate(serial, denomination)).toBe(true);
    });

    it.each([1, 5, 10, 100, 500, 3000, 20000])("rejects unsupported denomination %i", (denomination) => {
        expect(jpy.validate("AA161373AH", denomination)).toBe(false);
    });

    it.each([
        { denomination: 1000, serial: "", reason: "empty input is not a serial" },
        { denomination: 1000, serial: "AA161373AHH", reason: "too long for a Series-F serial" },
        { denomination: 1000, serial: "A161373AH", reason: "missing the second leading letter" },
        { denomination: 1000, serial: "AA16137AH", reason: "numeric portion is too short" },
        { denomination: 1000, serial: "AA161373A", reason: "missing the second trailing letter" },
        { denomination: 1000, serial: "IA161373AH", reason: "I is not used in JPY serial letters" },
        { denomination: 1000, serial: "OA161373AH", reason: "O is not used in JPY serial letters" },
        { denomination: 1000, serial: "AA000000AH", reason: "000000 is below the valid serial range" },
        { denomination: 1000, serial: "AA900001AH", reason: "900001 is above the valid serial range" },
        { denomination: 1000, serial: "SA815862T", reason: "old Series-D serial format is only accepted for 2000 yen notes" },
        { denomination: 2000, serial: "AA161373AH", reason: "Series-F serial format is not accepted for Series-D 2000 yen notes" },
        { denomination: 2000, serial: "SA000000T", reason: "000000 is below the valid serial range" },
        { denomination: 2000, serial: "SA900001T", reason: "900001 is above the valid serial range" },
        { denomination: 2000, serial: "SI815862T", reason: "I is not used in JPY serial letters" },
        { denomination: 2000, serial: "SO815862T", reason: "O is not used in JPY serial letters" },
    ])("rejects $serial for $denomination yen because $reason", ({ denomination, serial }) => {
        expect(jpy.validate(serial, denomination)).toBe(false);
    });
});
