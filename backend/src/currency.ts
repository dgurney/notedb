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

abstract class Currency {
    constructor(public readonly code: CurrencyCode) { }

    abstract isSupportedSerialFormat(serial: string, denomination: number): boolean
    protected validDenominations: number[] = [];
}

export class EUR extends Currency {
    constructor() {
        super(CurrencyCode.EUR);
        this.validDenominations = [5, 10, 20, 50, 100, 200];
    }
    isSupportedSerialFormat(serial: string, denomination: number): boolean {
        if (!this.validDenominations.includes(denomination)) {
            return false;
        }

        const normalisedSerial = serial.toUpperCase();
        const europaSimpleMatch = /^([a-zA-Z]{2})(\d{10})$/;
        if (!europaSimpleMatch.test(normalisedSerial)) {
            return false;
        }

        const first = normalisedSerial.charAt(0);
        const controlValue = EUROPA_CONTROL_VALUES[first];
        if (controlValue === undefined) {
            return false;
        }

        let sum = 0;
        for (const [index, character] of [...normalisedSerial].entries()) {
            if (index === 0) {
                continue;
            }
            if (index === 1) {
                const code = character.charCodeAt(0);
                const letterSum = Math.floor(code / 10) + code % 10;
                sum += letterSum;
                continue;
            }
            sum += Number.parseInt(character, 10);
        }

        return digitalRoot(sum) === controlValue;
    }
}

export class JPY extends Currency {
    constructor() {
        super(CurrencyCode.JPY);
        this.validDenominations = [1000, 2000, 5000, 10000];
    }
    isSupportedSerialFormat(serial: string, denomination: number): boolean {
        if (!this.validDenominations.includes(denomination)) {
            return false;
        }

        const normalisedSerial = serial.toUpperCase();

        // Series F format: https://www.npb.go.jp/en/products/intro/faq.html
        const jpyRegex = /^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2})(\d{6})([ABCDEFGHJKLMNPQRSTUVWXYZ]{2})$/
        // Series D serials are only expected on ¥2000 notes
        const jpyOldRegex = /^([ABCDEFGHJKLMNPQRSTUVWXYZ]{1,2})(\d{6})([ABCDEFGHJKLMNPQRSTUVWXYZ]{1})$/
        const serialMatch = denomination !== 2000 ? jpyRegex.exec(normalisedSerial) : jpyOldRegex.exec(normalisedSerial);
        if (!serialMatch) {
            return false
        }
        const digits = Number.parseInt(serialMatch[2]!, 10);
        if (digits < 1 || digits > 900000) {
            return false;
        }

        return true;
    }
}

export class USD extends Currency {
    constructor() {
        super(CurrencyCode.USD)
        this.validDenominations = [1, 2, 5, 10, 20, 50, 100];
    }
    isSupportedSerialFormat(serial: string, denomination: number): boolean {
        if (!this.validDenominations.includes(denomination)) {
            return false;
        }

        const normalisedSerial = serial.toUpperCase();

        const oldRegex = /^([A-L])([0-9]{8})([A-NP-Y*])$/;
        const redesignedRegex = /^([A-Z][A-L])([0-9]{8})([A-NP-Y*])$/;
        const serialMatch = denomination <= 2 ? oldRegex.exec(normalisedSerial) : redesignedRegex.exec(normalisedSerial) || oldRegex.exec(normalisedSerial);
        if (!serialMatch) {
            return false
        }
        const digits = Number.parseInt(serialMatch[2]!, 10);
        if (digits < 1 || digits > 99999999) {
            return false;
        }

        return true
    }
}
