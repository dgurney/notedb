import { openDatabase } from "./database";
import { validateNote, parseCreateNoteInput } from "./validation";
import type { ErrorResponse, Note } from "./types";

const dbPath = process.env.DB_PATH ?? "notes.db";
const db = openDatabase(dbPath);

function jsonError(error: string, status: number): Response {
  return Response.json({ error } satisfies ErrorResponse, { status });
}

export const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: "0.0.0.0",
  routes: {
    "/": {
      GET: () => {
        const notes = db
          .query("SELECT serial,currency,denomination,created FROM notes")
          .all();
        return Response.json(notes);
      },
      POST: async (req) => {
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
        const validationError = validateNote(noteInput);
        if (validationError) {
          return jsonError(validationError, 400);
        }

        const existingNote = db
          .query(
            "SELECT 1 FROM notes WHERE serial = ? AND currency = ? AND denomination = ?",
          )
          .get(noteInput.serial, noteInput.currency, noteInput.denomination);

        if (existingNote) {
          return jsonError(
            `note ${noteInput.serial} (${noteInput.currency} ${noteInput.denomination}) already exists`,
            409,
          );
        }

        db.query(
          "INSERT INTO notes (serial, currency, denomination, created) VALUES (?,?,?,?)",
        ).run(
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
      DELETE: (req) => {
        const serial = req.params.serial.trim().toUpperCase();
        const searchParams = new URL(req.url).searchParams;
        const currencyParameter = searchParams.get("currency");
        const denominationParameter = searchParams.get("denomination");

        if (serial === "") {
          return jsonError("serial cannot be empty", 400);
        }
        if (currencyParameter === null || currencyParameter.trim() === "") {
          return jsonError("currency query parameter is required", 400);
        }
        if (denominationParameter === null) {
          return jsonError("denomination query parameter is required", 400);
        }
        const denomination = Number(denominationParameter);
        if (!Number.isInteger(denomination) || denomination <= 0) {
          return jsonError(
            "denomination query parameter must be a positive integer",
            400,
          );
        }

        const currency = currencyParameter.trim().toUpperCase();
        const result = db
          .query(
            "DELETE FROM notes WHERE serial = ? AND currency = ? AND denomination = ?",
          )
          .run(serial, currency, denomination);
        if (result.changes === 0) {
          return jsonError(
            `note ${serial} (${currency} ${denomination}) not found`,
            404,
          );
        }

        return new Response(null, { status: 204 });
      },
    },
  },
  error(error) {
    return jsonError(error.message, 500);
  },
});

export async function stopServer(): Promise<void> {
  await server.stop(true);
  db.close();
}

console.log("server running on port", server.port);
