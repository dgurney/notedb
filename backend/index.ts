import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ErrorResponse, Note } from "./types";

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
    denomination TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created TEXT NOT NULL,
    UNIQUE(serial,denomination)
  )
`);


const server = Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    routes: {
        "/": {
            GET: () => {
                const notes = db.query("SELECT serial,denomination,amount,created FROM notes").all();
                return Response.json(notes);
            },
            POST: async req => {
                const note = await req.json() as Note;
                const created = new Date().toISOString();
                const denomination = note.denomination.toUpperCase();

                if (note.amount <= 0) {
                    return Response.json(<ErrorResponse>{
                        error: "amount cannot be <= 0"
                    }, { status: 400 })
                }

                if (denomination === "" || denomination.length != 3) {
                    return Response.json(<ErrorResponse>{
                        error: "denomination must be 3 characters long"
                    }, { status: 400 })
                }

                if (note.serial === "") {
                    return Response.json(<ErrorResponse>{
                        error: "serial cannot be empty"
                    }, { status: 400 })
                }

                const existingNote = db
                    .query("SELECT 1 FROM notes WHERE serial = ? AND denomination = ?")
                    .get(note.serial, denomination);

                if (existingNote) {
                    return Response.json(<ErrorResponse>{
                        error: `note ${note.serial} (${denomination}) already exists`
                    }, { status: 409 })
                }

                db.query("INSERT INTO notes (serial, denomination, amount, created) VALUES (?,?,?,?)").run(note.serial, denomination, note.amount, created);
                note.denomination = denomination;
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
