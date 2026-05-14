import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Note, ErrorResponse } from "./types";
import { EUR, JPY, USD } from "./currency";


// not very robust but good enough for our needs
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

const currencyValidators = {
    EUR,
    JPY,
    USD,
};

function validateSupportedCurrency(note: Note): Response | undefined {
    const Validator = currencyValidators[note.currency as keyof typeof currencyValidators];
    if (!Validator) {
        return undefined;
    }

    const currency = new Validator();
    const valid = currency.validate(note.serial, note.denomination);
    if (!valid) {
        return Response.json(<ErrorResponse>{
            error: `note is not a valid ${currency.code} note`
        }, { status: 400 });
    }
}


const server = Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    routes: {
        "/": {
            GET: () => {
                const notes = db.query("SELECT serial,currency,denomination,created FROM notes").all();
                return Response.json(notes);
            },
            POST: async req => {
                const note = await req.json() as Note;
                const created = new Date().toISOString();
                const currency = note.currency.toUpperCase();

                if (note.denomination <= 0) {
                    return Response.json(<ErrorResponse>{
                        error: "denomination cannot be <= 0"
                    }, { status: 400 })
                }

                if (currency === "" || currency.length != 3) {
                    return Response.json(<ErrorResponse>{
                        error: "currency must be 3 characters long"
                    }, { status: 400 })
                }

                if (note.serial === "") {
                    return Response.json(<ErrorResponse>{
                        error: "serial cannot be empty"
                    }, { status: 400 })
                }

                note.currency = note.currency.toUpperCase()

                const validationError = validateSupportedCurrency(note);
                if (validationError) {
                    return validationError;
                }

                const existingNote = db.query("SELECT 1 FROM notes WHERE serial = ? AND currency = ?").get(note.serial, currency);

                if (existingNote) {
                    return Response.json(<ErrorResponse>{
                        error: `note ${note.serial} (${currency}) already exists`
                    }, { status: 409 })
                }

                db.query("INSERT INTO notes (serial, currency, denomination, created) VALUES (?,?,?,?)").run(note.serial, currency, note.denomination, created);
                note.currency = currency;
                note.created = created;
                return Response.json({ note }, { status: 201 })
            }
        },
        "/:serial": {
            DELETE: req => {
                const serial = req.params.serial.trim();

                if (serial === "") {
                    return Response.json(<ErrorResponse>{
                        error: "serial cannot be empty"
                    }, { status: 400 })
                }

                const result = db.query("DELETE FROM notes WHERE serial = ?").run(serial);

                if (result.changes === 0) {
                    return Response.json(<ErrorResponse>{
                        error: `note ${serial} not found`
                    }, { status: 404 })
                }

                return new Response(null, { status: 204 })
            }
        },
    },
    error(error) {
        return Response.json(<ErrorResponse>{
            error: error.message
        }, { status: 500 })
    }
});

console.log("server running on port", server.port)
