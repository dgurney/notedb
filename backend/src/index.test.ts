import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDbPath = process.env.DB_PATH;
const originalPort = process.env.PORT;

const testDirectory = mkdtempSync(join(tmpdir(), "notedb-test-"));
process.env.DB_PATH = join(testDirectory, "notes.db");
process.env.PORT = String(await findAvailablePort());

const { server } = await import("./index");
const baseUrl = new URL(`http://localhost:${server.port}/`);

afterAll(() => {
    server.stop(true);
    rmSync(testDirectory, { recursive: true });

    if (originalDbPath === undefined) {
        delete process.env.DB_PATH;
    } else {
        process.env.DB_PATH = originalDbPath;
    }

    if (originalPort === undefined) {
        delete process.env.PORT;
    } else {
        process.env.PORT = originalPort;
    }
});

async function findAvailablePort(): Promise<number> {
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
    });

    const address = listener.address();
    if (address === null || typeof address === "string") {
        throw new Error("failed to allocate a TCP port for the integration test");
    }

    await new Promise<void>((resolve, reject) => {
        listener.close((error) => error ? reject(error) : resolve());
    });
    return address.port;
}

async function post(body: string): Promise<Response> {
    return fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
    });
}

describe("notes API", () => {
    it("rejects malformed JSON", async () => {
        const response = await post("{");

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "request body must contain valid JSON" });
    });

    it("rejects invalid and unsupported notes", async () => {
        const invalidResponse = await post(JSON.stringify({ currency: "EUR", denomination: 0, serial: "PA8124161759" }));
        const unsupportedResponse = await post(JSON.stringify({ currency: "GBP", denomination: 10, serial: "PA8124161759" }));

        expect(invalidResponse.status).toBe(400);
        expect(await invalidResponse.json()).toEqual({ error: "denomination must be a positive integer" });
        expect(unsupportedResponse.status).toBe(400);
        expect(await unsupportedResponse.json()).toEqual({ error: "currency GBP is not supported" });
    });

    it("creates, lists, and rejects duplicate notes", async () => {
        const input = { currency: "eur", denomination: 10, serial: "pa8124161759" };
        const createdResponse = await post(JSON.stringify(input));
        const createdBody: unknown = await createdResponse.json();
        const expectedNote = {
            currency: "EUR",
            denomination: input.denomination,
            serial: input.serial.toUpperCase(),
            created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        };

        expect(createdResponse.status).toBe(201);
        expect(createdBody).toEqual({ note: expectedNote });
        if (typeof createdBody !== "object" || createdBody === null || !("note" in createdBody)) {
            throw new Error("create-note response did not contain a note");
        }

        const listResponse = await fetch(baseUrl);
        expect(listResponse.status).toBe(200);
        expect(await listResponse.json()).toEqual([createdBody.note]);

        const duplicateResponse = await post(JSON.stringify(input));
        expect(duplicateResponse.status).toBe(409);
        expect(await duplicateResponse.json()).toEqual({
            error: "note PA8124161759 (EUR 10) already exists",
        });

        const differentlyCasedDuplicateResponse = await post(JSON.stringify({
            ...input,
            currency: "EUR",
            serial: input.serial.toUpperCase(),
        }));
        expect(differentlyCasedDuplicateResponse.status).toBe(409);
    });

    it("deletes existing notes and reports missing notes", async () => {
        const serial = "EA3388561264";
        const createResponse = await post(JSON.stringify({ currency: "EUR", denomination: 10, serial }));
        expect(createResponse.status).toBe(201);

        const deleteUrl = new URL(`${serial.toLowerCase()}?currency=eur&denomination=10`, baseUrl);
        const deleteResponse = await fetch(deleteUrl, { method: "DELETE" });
        expect(deleteResponse.status).toBe(204);
        expect(await deleteResponse.text()).toBe("");

        const missingResponse = await fetch(deleteUrl, { method: "DELETE" });
        expect(missingResponse.status).toBe(404);
        expect(await missingResponse.json()).toEqual({ error: `note ${serial} (EUR 10) not found` });
    });

    it("requires a complete note", async () => {
        const serial = "RR3223530574";
        const missingCurrencyResponse = await fetch(new URL(`${serial}?denomination=10`, baseUrl), { method: "DELETE" });
        expect(missingCurrencyResponse.status).toBe(400);
        expect(await missingCurrencyResponse.json()).toEqual({ error: "currency query parameter is required" });

        const missingDenominationResponse = await fetch(new URL(`${serial}?currency=EUR`, baseUrl), { method: "DELETE" });
        expect(missingDenominationResponse.status).toBe(400);
        expect(await missingDenominationResponse.json()).toEqual({ error: "denomination query parameter is required" });

        const invalidDenominationResponse = await fetch(new URL(`${serial}?currency=EUR&denomination=ten`, baseUrl), { method: "DELETE" });
        expect(invalidDenominationResponse.status).toBe(400);
        expect(await invalidDenominationResponse.json()).toEqual({
            error: "denomination query parameter must be a positive integer",
        });
    });

    it("deletes one exact note when a serial and currency are shared", async () => {
        const serial = "A23456789A";
        const oneDollarResponse = await post(JSON.stringify({ currency: "USD", denomination: 1, serial }));
        const twoDollarResponse = await post(JSON.stringify({ currency: "USD", denomination: 2, serial }));
        expect(oneDollarResponse.status).toBe(201);
        expect(twoDollarResponse.status).toBe(201);

        const deleteOneDollarResponse = await fetch(new URL(`${serial}?currency=USD&denomination=1`, baseUrl), { method: "DELETE" });
        expect(deleteOneDollarResponse.status).toBe(204);

        const deleteRemainingResponse = await fetch(new URL(`${serial}?currency=USD&denomination=2`, baseUrl), { method: "DELETE" });
        expect(deleteRemainingResponse.status).toBe(204);
    });
});
