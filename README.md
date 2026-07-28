# notedb

`notedb` is a tool I made for my own purposes, with the primary goal of learning to use Bun for backend development. 

Europa-series EUR, JPY, and USD banknotes are currently supported with validation.

## How it works

The OCR CLI reads banknote images from `frontend/notes`, asks an LLM via LM Studio to identify the currency, denomination, and serial number, then submits the result to the backend. The backend validates supported notes and stores them in SQLite.

## Project structure

```text
backend/            Bun API, SQLite database, and currency validators
frontend/           LM Studio OCR CLI
frontend/notes/     Input images for the OCR CLI
docker-compose.yml  Containerized backend with persistent storage
```

## Requirements

For the backend:

- [Bun](https://bun.sh/), or
- Docker with Docker Compose.

For the OCR CLI:

- Bun;
- [LM Studio](https://lmstudio.ai/);
- the LM Studio local server running; and
- `zai-org/glm-4.6v-flash` downloaded locally.

## Quick start

Start the backend with Docker Compose:

```bash
docker compose up --build
```

The API will be available at `http://localhost:3000`. SQLite data is stored in the `notes-db` Docker volume.

In another terminal, install the OCR CLI dependencies:

```bash
cd frontend
bun install
```

Place `.png`, `.jpg`, or `.jpeg` banknote images in `frontend/notes`, start the LM Studio local server, then run:

```bash
bun run ocr
```

The CLI submits notes to `http://localhost:3000` by default. To use another backend address:

```bash
bun run ocr -- --host 127.0.0.1 --port 3000
```

## Running the backend without Docker

```bash
cd backend
bun install
bun run src/index.ts
```

The backend accepts these environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `notes.db` | SQLite database path |

## API

### List notes

```http
GET /
```

Returns all stored notes.

### Create a note

```http
POST /
Content-Type: application/json

{
  "serial": "PA8124161759",
  "currency": "EUR",
  "denomination": 10
}
```

A successful request returns `201 Created` with the stored note, including its creation timestamp:

```json
{
  "note": {
    "serial": "PA8124161759",
    "currency": "EUR",
    "denomination": 10,
    "created": "2026-07-28T12:00:00.000Z"
  }
}
```

Duplicate serial-and-currency pairs return `409 Conflict`. Invalid and unsupported notes return `400 Bad Request`.

### Delete notes by serial

```http
DELETE /PA8124161759
```

Returns `204 No Content` on successful deletion, or `404 Not Found` when the serial does not exist.

Errors use the following shape:

```json
{
  "error": "error description"
}
```

## Development

Run the backend tests:

```bash
cd backend
bun test
```

Type-check each component:

```bash
cd backend
bun x tsc --noEmit

cd ../frontend
bun x tsc --noEmit
```

## Current limitations

- OCR accuracy depends on image quality and the local model. At the time of writing the code it was found that the currently hardcoded `glm-4.6v-flash` model has the best accuracy for this task, even compared to Gemma 4 which was occasionally misreading serial numbers. 
- Images are currently processed sequentially.
- Deletion is keyed only by serial number and may remove multiple records sharing that serial (though in practise this is not a current concern).

## License

This project is licensed under the [MIT License](LICENSE).
