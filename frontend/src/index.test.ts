import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  archiveImage,
  createNote,
  getImagePaths,
  parseCliOptions,
  parseExtractedNote,
  processImagePaths,
  resolveModel,
} from "./index";

const temporaryDirectories: string[] = [];

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

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true })));
});

const backendClientPort = await findAvailablePort();
const backendClientServer = Bun.serve({
  port: backendClientPort,
  async fetch(request) {
    const url = new URL(request.url);
    const note = await request.json();

    switch (url.pathname) {
      case "/created":
        return Response.json({ note: { ...note, created: "2026-08-02T12:00:00.000Z" } }, { status: 201 });
      case "/duplicate":
        return Response.json({ error: "already exists" }, { status: 409 });
      case "/rejected":
        return Response.json({ error: "invalid note" }, { status: 400 });
      case "/unexpected-error":
        return Response.json({ message: "invalid note" }, { status: 500 });
      case "/unexpected-success":
        return Response.json({ created: true }, { status: 201 });
      default:
        return new Response(null, { status: 404 });
    }
  },
});

describe("CLI options", () => {
  it("uses defaults and accepts both option syntaxes", () => {
    expect(parseCliOptions([])).toEqual({ host: "localhost", port: 3000 });
    expect(parseCliOptions(["--host", "127.0.0.1", "--port=4000"])).toEqual({
      host: "127.0.0.1",
      port: 4000,
    });
  });

  it.each([
    { argv: ["--host"], message: "--host requires a value" },
    { argv: ["--host="], message: "host cannot be empty" },
    { argv: ["--port", "0"], message: "Invalid port: 0" },
    { argv: ["unexpected"], message: "Unexpected argument: unexpected" },
  ])("rejects invalid arguments with $message", ({ argv, message }) => {
    expect(() => parseCliOptions(argv)).toThrow(message);
  });
});

describe("image discovery", () => {
  it("returns supported files in filename order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "notedb-images-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(path.join(directory, "b.JPG"), ""),
      writeFile(path.join(directory, "a.png"), ""),
      writeFile(path.join(directory, "ignored.gif"), ""),
      mkdir(path.join(directory, "directory.jpeg")),
    ]);

    expect(await getImagePaths(directory)).toEqual([
      path.join(directory, "a.png"),
      path.join(directory, "b.JPG"),
    ]);
  });

  it("archives processed images without overwriting an existing file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "notedb-archive-"));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, "note.jpg");
    await writeFile(imagePath, "first image");

    const archivedPath = await archiveImage(imagePath);
    expect(archivedPath).toBe(path.join(directory, "processed", "note.jpg"));
    expect(await getImagePaths(directory)).toEqual([]);

    await writeFile(imagePath, "second image");
    expect(archiveImage(imagePath)).rejects.toThrow(
      `cannot archive note.jpg because ${archivedPath} already exists`,
    );
    expect(await getImagePaths(directory)).toEqual([imagePath]);
  });
});

describe("image processing", () => {
  it("archives successful and duplicate images while retaining failures and continuing", async () => {
    const archived: string[] = [];
    const processed = await processImagePaths(["created.jpg", "failed.jpg", "duplicate.jpg", "archive-failed.jpg"], {
      async extract(imagePath) {
        if (imagePath === "failed.jpg") {
          throw new Error("model output was invalid");
        }
        let serial = "PA8124161759";
        if (imagePath === "duplicate.jpg") {
          serial = "EA3388561264";
        } else if (imagePath === "archive-failed.jpg") {
          serial = "UB8593576913";
        }
        return {
          currency: "EUR",
          denomination: 10,
          serial,
        };
      },
      async create(note) {
        if (note.serial === "EA3388561264") {
          return { status: "duplicate", note };
        }
        return { status: "created", note: { ...note, created: "2026-08-02T12:00:00.000Z" } };
      },
      async archive(imagePath) {
        if (imagePath === "archive-failed.jpg") {
          throw new Error("processed destination already exists");
        }
        archived.push(imagePath);
        return `processed/${imagePath}`;
      },
    });

    expect(processed).toEqual({
      created: [{
        currency: "EUR",
        denomination: 10,
        serial: "PA8124161759",
        created: "2026-08-02T12:00:00.000Z",
      }, {
        currency: "EUR",
        denomination: 10,
        serial: "UB8593576913",
        created: "2026-08-02T12:00:00.000Z",
      }],
      duplicates: [{ currency: "EUR", denomination: 10, serial: "EA3388561264" }],
      failures: [
        { imagePath: "failed.jpg", error: "model output was invalid" },
        { imagePath: "archive-failed.jpg", error: "processed destination already exists" },
      ],
    });
    expect(archived).toEqual(["created.jpg", "duplicate.jpg"]);
  });
});

describe("model resolution", () => {
  it("reuses a matching loaded model", async () => {
    const loadedModel = {
      modelKey: "zai-org/glm-4.6v-flash",
      identifier: "loaded-model",
      path: "models/glm",
    };
    const client = {
      llm: {
        listLoaded: async () => [loadedModel],
        model: async () => loadedModel,
      },
      system: { listDownloadedModels: async () => [] },
    };

    expect((await resolveModel(client)).identifier).toBe(loadedModel.identifier);
  });

  it("loads a matching downloaded model", async () => {
    let requestedPath: string | undefined;
    const loadedModel = {
      modelKey: "zai-org/glm-4.6v-flash",
      identifier: "new-model",
      path: "zai-org/glm-4.6v-flash",
    };
    const client = {
      llm: {
        listLoaded: async () => [],
        model: async (modelPath: string) => {
          requestedPath = modelPath;
          return loadedModel;
        },
      },
      system: {
        listDownloadedModels: async () => [{
          type: "llm",
          modelKey: "other-key",
          path: "zai-org/glm-4.6v-flash",
          displayName: "GLM",
        }],
      },
    };

    expect((await resolveModel(client)).identifier).toBe("new-model");
    expect(requestedPath).toBe("zai-org/glm-4.6v-flash");
  });

  it("reports when the requested model is unavailable", async () => {
    const client = {
      llm: {
        listLoaded: async () => [],
        model: async () => {
          throw new Error("model should not be loaded");
        },
      },
      system: { listDownloadedModels: async () => [] },
    };

    expect(resolveModel(client)).rejects.toThrow(
      "No local zai-org/glm-4.6v-flash model found in LM Studio. Download it first, then rerun this command.",
    );
  });
});

describe("model output", () => {
  it("validates and normalises extracted notes", () => {
    expect(parseExtractedNote(JSON.stringify({
      currency: "eur",
      denomination: 10,
      serial: " PA8124161759 ",
    }))).toEqual({
      currency: "EUR",
      denomination: 10,
      serial: "PA8124161759",
    });
  });

  it("rejects malformed JSON and invalid note data", () => {
    expect(() => parseExtractedNote("{")).toThrow();
    expect(() => parseExtractedNote(JSON.stringify({
      currency: "EU",
      denomination: 10,
      serial: "PA8124161759",
    }))).toThrow();
  });
});

describe("backend client", () => {
  afterAll(() => {
    backendClientServer.stop(true);
  });

  const note = { currency: "EUR", denomination: 10, serial: "PA8124161759" };

  it("returns created and duplicate results", async () => {
    expect(createNote(new URL(`http://localhost:${backendClientServer.port}/created`), note)).resolves.toEqual({
      status: "created",
      note: { ...note, created: "2026-08-02T12:00:00.000Z" },
    });
    expect(createNote(new URL(`http://localhost:${backendClientServer.port}/duplicate`), note)).resolves.toEqual({
      status: "duplicate",
      note,
    });
  });

  it("reports backend rejections", async () => {
    expect(createNote(new URL(`http://localhost:${backendClientServer.port}/rejected`), note)).rejects.toThrow(
      "Backend rejected PA8124161759: invalid note",
    );
  });

  it("rejects unexpected success and error response shapes", async () => {
    expect(createNote(new URL(`http://localhost:${backendClientServer.port}/unexpected-error`), note)).rejects.toThrow(
      "Backend returned an unexpected error response for PA8124161759",
    );
    expect(createNote(new URL(`http://localhost:${backendClientServer.port}/unexpected-success`), note)).rejects.toThrow(
      "Backend returned an unexpected response for PA8124161759",
    );
  });
});
