import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getCurrencyValidationError, parseCreateNoteInput } from "./note-validation";
import type { ErrorResponse, Note } from "./types";

const dbPath = process.env.DB_PATH ?? "notes.db";
if (process.env.DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
db.run(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    currency TEXT NOT NULL,
    denomination INTEGER NOT NULL,
    created TEXT NOT NULL,
    UNIQUE(serial,currency)
  )
`);

function jsonError(error: string, status: number): Response {
    return Response.json({ error } satisfies ErrorResponse, { status });
}

export const server = Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    routes: {
        "/": {
            GET: () => {
                const notes = db.query("SELECT serial,currency,denomination,created FROM notes").all();
                return Response.json(notes);
            },
            POST: async req => {
                let body: unknown;
                try {
                    body = await req.json();
                } catch {
                    return jsonError("request body must contain valid JSON", 400);
                }

                const parsed = parseCreateNoteInput(body);
                if (!parsed.success) {
                    return jsonError(parsed.error, 400);
                }

                const noteInput = parsed.note;
                const created = new Date().toISOString();
                const validationError = getCurrencyValidationError(noteInput);
                if (validationError) {
                    return jsonError(validationError, 400);
                }

                const existingNote = db.query("SELECT 1 FROM notes WHERE serial = ? AND currency = ?").get(noteInput.serial, noteInput.currency);

                if (existingNote) {
                    return jsonError(`note ${noteInput.serial} (${noteInput.currency}) already exists`, 409);
                }

                db.query("INSERT INTO notes (serial, currency, denomination, created) VALUES (?,?,?,?)").run(
                    noteInput.serial,
                    noteInput.currency,
                    noteInput.denomination,
                    created,
                );
                const note: Note = { ...noteInput, created };

                return Response.json({ note }, { status: 201 });
            },
        },
        "/:serial": {
            DELETE: req => {
                const serial = req.params.serial.trim();
                const currencyParameter = new URL(req.url).searchParams.get("currency");
                const currency = currencyParameter?.toUpperCase();

                if (serial === "") {
                    return jsonError("serial cannot be empty", 400);
                }

                if (currency !== undefined) {
                    const result = db.query("DELETE FROM notes WHERE serial = ? AND currency = ?").run(serial, currency);

                    if (result.changes === 0) {
                        return jsonError(`note ${serial} (${currency}) not found`, 404);
                    }

                    return new Response(null, { status: 204 });
                }

                const matchingNotes = db.query<{ currency: string }, [string]>("SELECT currency FROM notes WHERE serial = ?").all(serial);
                if (matchingNotes.length === 0) {
                    return jsonError(`note ${serial} not found`, 404);
                }
                if (matchingNotes.length > 1) {
                    return jsonError(`multiple notes have serial ${serial}, specify the currency`, 409);
                }

                db.query("DELETE FROM notes WHERE serial = ? AND currency = ?").run(serial, matchingNotes[0]!.currency);
                return new Response(null, { status: 204 });
            },
        },
    },
    error(error) {
        return jsonError(error.message, 500);
    },
});

console.log("server running on port", server.port);
