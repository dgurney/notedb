export interface Note {
    serial: string;
    currency: string;
    denomination: number;
    created?: string;
}

export interface ErrorResponse {
    error: string;
    code?: string;
}

export enum CurrencyCode {
    EUR = "EUR",
    JPY = "JPY",
    USD = "USD"
}