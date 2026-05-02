# notedb frontend

(caveat emptor: vibecoded, unlike the backend!)

Bun CLI that OCRs every `notes/*.{png,jpg,jpeg}` image with LM Studio and creates notes through the backend API.

## Prerequisites

- Bun installed
- LM Studio installed
- LM Studio local server running
- `zai-org/glm-4.6v-flash` available locally in LM Studio
- The notedb backend running

## Run

```bash
bun install
bun run ocr
```

By default the CLI posts to `http://localhost:3000/`. Override the backend target with options:

```bash
bun run ocr -- --hostname 127.0.0.1 --port 3000
```

Positional arguments are also accepted:

```bash
bun run ocr -- 127.0.0.1 3000
```

The command reads all `.png`, `.jpg`, and `.jpeg` files directly under `notes/` and posts each extracted note to the backend.
