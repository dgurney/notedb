export interface Note {
    serial: string;
    denomination: string;
    amount: number;
    created?: string;
}

export interface ErrorResponse {
    error: string;
    code?: string;
}
