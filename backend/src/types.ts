export interface CreateNoteInput {
    serial: string;
    currency: string;
    denomination: number;
}

export interface Note extends CreateNoteInput {
    created: string;
}

export interface ErrorResponse {
    error: string;
}

export enum CurrencyCode {
    EUR = "EUR",
    JPY = "JPY",
    USD = "USD",
}
