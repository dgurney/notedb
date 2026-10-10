export type CreateNoteInput = {
  serial: string;
  currency: string;
  denomination: number;
};

export type Note = CreateNoteInput & {
  created: string;
};

export type ErrorResponse = {
  error: string;
};

export enum CurrencyCode {
  EUR = "EUR",
  JPY = "JPY",
  USD = "USD",
}
