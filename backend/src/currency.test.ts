import { describe, expect, it } from "vitest";

import { EUR } from "./currency";

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
        expect(eur.validate(serial)).toBe(true);
    });

    it("accepts lowercase input", () => {
        expect(eur.validate("pa8124161759")).toBe(true);
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
        expect(eur.validate(serial)).toBe(false);
    });
});
