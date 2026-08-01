import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:net";

const originalDbPath = process.env.DB_PATH;
const originalPort = process.env.PORT;

process.env.DB_PATH = ":memory:";
process.env.PORT = String(await findAvailablePort());

const { server } = await import("./index");
const baseUrl = new URL(`http://localhost:${server.port}/`);

afterAll(() => {
    server.stop(true);

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
        const input = { currency: "eur", denomination: 10, serial: "PA8124161759" };
        const createdResponse = await post(JSON.stringify(input));
        const createdBody: unknown = await createdResponse.json();
        const expectedNote = {
            currency: "EUR",
            denomination: input.denomination,
            serial: input.serial,
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
            error: "note PA8124161759 (EUR) already exists",
        });
    });

    it("deletes existing notes and reports missing notes", async () => {
        const serial = "EA3388561264";
        const createResponse = await post(JSON.stringify({ currency: "EUR", denomination: 10, serial }));
        expect(createResponse.status).toBe(201);

        const deleteResponse = await fetch(new URL(serial, baseUrl), { method: "DELETE" });
        expect(deleteResponse.status).toBe(204);
        expect(await deleteResponse.text()).toBe("");

        const missingResponse = await fetch(new URL(serial, baseUrl), { method: "DELETE" });
        expect(missingResponse.status).toBe(404);
        expect(await missingResponse.json()).toEqual({ error: `note ${serial} not found` });
    });
});
