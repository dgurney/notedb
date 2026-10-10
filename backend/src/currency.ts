import { digitalRoot } from "./helpers";
import { CurrencyCode } from "./types";

const EUROPA_CONTROL_VALUES: Partial<Record<string, number>> = {
  A: 7,
  B: 6,
  C: 5,
  D: 4,
  E: 3,
  F: 2,
  G: 1,
  H: 9,
  J: 7,
  K: 6,
  L: 5,
  M: 4,
  N: 3,
  P: 1,
  R: 8,
  S: 7,
  T: 6,
  U: 5,
  V: 4,
  W: 3,
  X: 2,
  Y: 1,
  Z: 9,
};

// Serial letters never include I or O
// Series F format: https://www.npb.go.jp/en/products/intro/faq.html
const JPY_SERIES_F_REGEX = /^[A-HJ-NP-Z]{2}(\d{6})[A-HJ-NP-Z]{2}$/;
// Series D serials are only expected on ¥2000 notes
const JPY_SERIES_D_REGEX = /^[A-HJ-NP-Z]{1,2}(\d{6})[A-HJ-NP-Z]$/;
const JPY_MAX_SERIAL_NUMBER = 900_000;

// Serial numbers start at 00000001, so an all-zero number is rejected
const USD_OLD_REGEX = /^[A-L](?!0{8})\d{8}[A-NP-Y*]$/;
// Redesigned notes prefix a series letter; the old format remains valid
const USD_REDESIGNED_REGEX = /^[A-Z]?[A-L](?!0{8})\d{8}[A-NP-Y*]$/;

export abstract class Currency {
  constructor(
    public readonly code: CurrencyCode,
    private readonly validDenominations: readonly [number, ...number[]],
  ) {}

  abstract validSerial(serial: string, denomination: number): boolean;

  validDenomination(denomination: number): boolean {
    return this.validDenominations.includes(denomination);
  }
}

export class EUR extends Currency {
  constructor() {
    super(CurrencyCode.EUR, [5, 10, 20, 50, 100, 200]);
  }
  validSerial(serial: string, _denomination: number): boolean {
    const normalisedSerial = serial.toUpperCase();
    if (!/^[A-Z]{2}\d{10}$/.test(normalisedSerial)) {
      return false;
    }

    const controlValue = EUROPA_CONTROL_VALUES[normalisedSerial.charAt(0)];
    if (controlValue === undefined) {
      return false;
    }

    // The second letter contributes the digit sum of its ASCII code
    const letterCode = normalisedSerial.charCodeAt(1);
    let sum = Math.floor(letterCode / 10) + (letterCode % 10);
    for (const digit of normalisedSerial.slice(2)) {
      sum += Number(digit);
    }

    return digitalRoot(sum) === controlValue;
  }
}

export class JPY extends Currency {
  constructor() {
    super(CurrencyCode.JPY, [1000, 2000, 5000, 10000]);
  }
  validSerial(serial: string, denomination: number): boolean {
    const normalisedSerial = serial.toUpperCase();
    const serialMatch =
      denomination === 2000
        ? JPY_SERIES_D_REGEX.exec(normalisedSerial)
        : JPY_SERIES_F_REGEX.exec(normalisedSerial);
    if (!serialMatch) {
      return false;
    }

    // biome-ignore lint/style/noNonNullAssertion: the digits group is mandatory in both regexes
    const digits = Number(serialMatch[1]!);
    return digits >= 1 && digits <= JPY_MAX_SERIAL_NUMBER;
  }
}

export class USD extends Currency {
  constructor() {
    super(CurrencyCode.USD, [1, 2, 5, 10, 20, 50, 100]);
  }
  validSerial(serial: string, denomination: number): boolean {
    const normalisedSerial = serial.toUpperCase();
    const regex = denomination <= 2 ? USD_OLD_REGEX : USD_REDESIGNED_REGEX;
    return regex.test(normalisedSerial);
  }
}
