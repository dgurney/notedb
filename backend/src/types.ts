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
