import { EUR, JPY, USD } from "./currency";
import { CurrencyCode } from "./types";
import type { CreateNoteInput } from "./types";

type CurrencyValidator = {
    readonly code: CurrencyCode;
    isSupportedSerialFormat(serial: string, denomination: number): boolean;
};

type ParseCreateNoteResult =
    | { success: true; note: CreateNoteInput }
    | { success: false; error: string };

const currencyValidators = new Map<string, CurrencyValidator>([
    [CurrencyCode.EUR, new EUR()],
    [CurrencyCode.JPY, new JPY()],
    [CurrencyCode.USD, new USD()],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCreateNoteInput(value: unknown): ParseCreateNoteResult {
    if (!isRecord(value)) {
        return { success: false, error: "request body must be an object" };
    }

    const { currency, denomination, serial } = value;

    if (typeof denomination !== "number" || !Number.isInteger(denomination) || denomination <= 0) {
        return { success: false, error: "denomination must be a positive integer" };
    }

    if (typeof currency !== "string" || currency.length !== 3) {
        return { success: false, error: "currency must be a 3-character string" };
    }

    if (typeof serial !== "string" || serial.trim().length === 0) {
        return { success: false, error: "serial must be a non-empty string" };
    }

    return {
        success: true,
        note: {
            currency: currency.toUpperCase(),
            denomination,
            serial: serial.trim().toUpperCase(),
        },
    };
}

export function getSerialFormatValidationError(note: CreateNoteInput): string | undefined {
    const validator = currencyValidators.get(note.currency);

    if (!validator) {
        return `currency ${note.currency} is not supported`;
    }

    if (!validator.isSupportedSerialFormat(note.serial, note.denomination)) {
        return `${note.serial} is not a supported ${validator.code} serial format for denomination ${note.denomination}`;
    }
}
