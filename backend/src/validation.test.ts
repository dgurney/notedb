import { describe, expect, it } from "bun:test";

import { validateNote, parseCreateNoteInput } from "./validation";

describe("create-note input parsing", () => {
  it.each([
    { value: null, error: "request body must be an object" },
    { value: [], error: "request body must be an object" },
    { value: {}, error: "denomination must be a positive integer" },
    {
      value: { currency: "EUR", denomination: 1.5, serial: "PA8124161759" },
      error: "denomination must be a positive integer",
    },
    {
      value: { currency: "EU", denomination: 10, serial: "PA8124161759" },
      error: "currency must be a 3-character string",
    },
    {
      value: { currency: "EUR", denomination: 10, serial: "" },
      error: "serial must be a non-empty string",
    },
  ])("rejects invalid input with $error", ({ value, error }) => {
    expect(parseCreateNoteInput(value)).toEqual({ success: false, error });
  });

  it("normalises valid currency codes and serials", () => {
    expect(
      parseCreateNoteInput({
        currency: "eur",
        denomination: 10,
        serial: " pa8124161759 ",
      }),
    ).toEqual({
      success: true,
      note: {
        currency: "EUR",
        denomination: 10,
        serial: "PA8124161759",
      },
    });
  });
});

describe("supported serial-format validation", () => {
  it("rejects unsupported currencies", () => {
    expect(
      validateNote({
        currency: "GBP",
        denomination: 10,
        serial: "PA8124161759",
      }),
    ).toBe("currency GBP is not supported");
  });

  it("accepts supported serial formats", () => {
    expect(
      validateNote({
        currency: "EUR",
        denomination: 10,
        serial: "PA8124161759",
      }),
    ).toBeUndefined();
  });

  it("rejects unsupported denominations before checking the serial format", () => {
    expect(
      validateNote({
        currency: "EUR",
        denomination: 1,
        serial: "not a serial",
      }),
    ).toBe("denomination 1 is not supported for EUR");
  });
});
