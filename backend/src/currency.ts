import { digitalRoot } from "./helpers";
import { CurrencyCode } from "./types";

abstract class Currency {
    constructor(public readonly code: CurrencyCode) { }

    abstract validate(serial: string, denomination: number): boolean
    protected validDenominations: number[] = [];
}

export class EUR extends Currency {
    constructor() {
        super(CurrencyCode.EUR);
        this.validDenominations = [5, 10, 20, 50, 100, 200]; // no 500 since we don't support non-europa notes (yet)
    }
    validate(serial: string, denomination: number): boolean {
        // TODO support old non-europa series notes if needed

        if (!this.validDenominations.includes(denomination)) {
            return false;
        }

        const normalisedSerial = serial.toUpperCase();

        // simplest check: does the serial number have two letters at the beginning and 10 digits?
        const europaSimpleMatch = /^([a-zA-Z]{2})(\d{10})$/;
        if (!europaSimpleMatch.test(normalisedSerial)) {
            return false;
        }

        // each valid first letter of an europa-series euro note has a control value
        const controlValues = {
            "A": 7,
            "B": 6,
            "C": 5,
            "D": 4,
            "E": 3,
            "F": 2,
            "G": 1,
            "H": 9,
            "J": 7,
            "K": 6,
            "L": 5,
            "M": 4,
            "N": 3,
            "P": 1,
            "R": 8,
            "S": 7,
            "T": 6,
            "U": 5,
            "V": 4,
            "W": 3,
            "X": 2,
            "Y": 1,
            "Z": 9,
        }


        // if the control value for the character does not exist, it's automatically invalid
        const first = normalisedSerial.charAt(0);
        if (!controlValues.hasOwnProperty(first)) {
            return false;
        }

        // now we just need to sum up the rest of the serial
        let sum = 0;
        [...normalisedSerial].forEach((character, index) => {
            if (index === 0) {
                // we don't need to check the first character again
                return;
            }
            if (index === 1) {
                // the second character is the only other letter in the serial
                const code = character.charCodeAt(0);
                const letterSum = Math.floor(code / 10) + code % 10;
                sum += letterSum;
                return;
            }
            sum += parseInt(character, 10);
        })

        return digitalRoot(sum) == controlValues[first as keyof typeof controlValues];
    }
}

export class JPY extends Currency {
    constructor() {
        super(CurrencyCode.JPY);
        this.validDenominations = [1000, 2000, 5000, 10000];
    }
    validate(serial: string, denomination: number): boolean {
        if (!this.validDenominations.includes(denomination)) {
            return false;
        }

        const normalisedSerial = serial.toUpperCase();

        // https://www.npb.go.jp/en/products/intro/faq.html
        const jpyRegex = /^([ABCDEFGHJKLMNPQRSTUVWXYZ]{2})(\d{6})([ABCDEFGHJKLMNPQRSTUVWXYZ]{2})$/
        // probably only needed for 2000 yen banknotes, unlikely we would encounter any other old serial number notes at this time. can be made unconditional later if needed.
        const jpyOldRegex = /^([ABCDEFGHJKLMNPQRSTUVWXYZ]{1,2})(\d{6})([ABCDEFGHJKLMNPQRSTUVWXYZ]{1})$/
        const serialMatch = denomination !== 2000 ? jpyRegex.exec(normalisedSerial) : jpyOldRegex.exec(normalisedSerial);
        if (!serialMatch) {
            return false
        }
        const digits = parseInt(serialMatch[2]!, 10);
        if (digits < 1 || digits > 900000) {
            return false;
        }

        return true;
    }
}
