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

    it.each([1000, 2000, 5000, 10000])("accepts supported denomination %i", (denomination) => {
        expect(jpy.validate("", denomination)).toBe(true);
    });

    it.each([1, 5, 10, 100, 500, 3000, 20000])("rejects unsupported denomination %i", (denomination) => {
        expect(jpy.validate("", denomination)).toBe(false);
    });
});
