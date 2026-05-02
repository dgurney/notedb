import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Note, ErrorResponse } from "./types";


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
    },
    error(error) {
        return Response.json(<ErrorResponse>{
            error: error.message
        }, { status: 500 })
    }
});

console.log("server running on port", server.port)
