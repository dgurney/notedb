import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { createNote, getImagePaths, parseCliOptions, parseExtractedNote, resolveModel } from "./index";

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
