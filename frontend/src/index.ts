import { LMStudioClient, type LLM } from "@lmstudio/sdk";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CreateNoteInput, ErrorResponse, Note } from "../../backend/src/types";

const MODEL_FAMILY = "zai-org/glm-4.6v-flash";
const NOTES_DIR = path.join(process.cwd(), "notes");
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const SYSTEM_PROMPT = `You are an expert money sorter. Your job is to look at the provided image, and identify the following information from it:
- currency (ISO 4217 currency code)
- denomination
- Serial number

The user is not interacting with you directly, so you cannot ask any followup questions, and you must not say anything extraneous apart from the JSON output.`;

const createNoteSchema = z.object({
  currency: z.string().length(3),
  denomination: z.number().int().positive(),
  serial: z.string(),
}) satisfies z.ZodType<CreateNoteInput>;
const createNoteJsonSchema = z.toJSONSchema(createNoteSchema, { target: "draft-07" });
const noteSchema = createNoteSchema.extend({
  created: z.string(),
}) satisfies z.ZodType<Note>;
const createNoteResponseSchema = z.object({
  note: noteSchema,
});
const errorResponseSchema = z.object({
  error: z.string(),
}) satisfies z.ZodType<ErrorResponse>;

type CliOptions = {
  host: string;
  port: number;
};

type CreateNoteResult =
  | { status: "created"; note: Note }
  | { status: "duplicate"; note: CreateNoteInput };

type ModelReference = {
  modelKey: string;
  identifier: string;
  path: string;
};

type DownloadedModelReference = {
  type: string;
  modelKey: string;
  path: string;
  displayName: string;
};

type ModelResolverClient<Model extends ModelReference> = {
  llm: {
    listLoaded(): Promise<Model[]>;
    model(modelPath: string): Promise<Model>;
  };
  system: {
    listDownloadedModels(): Promise<DownloadedModelReference[]>;
  };
};

function matchesModel(value: string): boolean {
  return value.toLowerCase().includes(MODEL_FAMILY.toLowerCase());
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    host: "localhost",
    port: 3000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--host") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.host = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--port requires a value");
      }
      options.port = parsePort(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      options.port = parsePort(arg.slice("--port=".length));
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (options.host.trim().length === 0) {
    throw new Error("host cannot be empty");
  }

  return options;
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

export async function getImagePaths(notesDir = NOTES_DIR): Promise<string[]> {
  const entries = await readdir(notesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(notesDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export async function resolveModel<Model extends ModelReference>(client: ModelResolverClient<Model>): Promise<Model> {
  const loadedModels = await client.llm.listLoaded();
  const loadedMatch = loadedModels.find((model) =>
    [model.modelKey, model.identifier, model.path].some(matchesModel),
  );

  if (loadedMatch) {
    return loadedMatch;
  }

  const downloadedModels = await client.system.listDownloadedModels();
  const downloadedMatch = downloadedModels.find(
    (model) =>
      model.type === "llm" &&
      [model.modelKey, model.path, model.displayName].some(matchesModel),
  );

  if (!downloadedMatch) {
    throw new Error(
      `No local ${MODEL_FAMILY} model found in LM Studio. Download it first, then rerun this command.`,
    );
  }

  return client.llm.model(downloadedMatch.path);
}

async function extractNote(
  client: LMStudioClient,
  model: LLM,
  imagePath: string,
): Promise<CreateNoteInput> {
  const image = await client.files.prepareImage(imagePath);

  const result = await model.respond(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        images: [image],
      },
    ],
    {
      structured: {
        type: "json",
        jsonSchema: createNoteJsonSchema,
      },
      maxTokens: 2_048,
    },
  );

  return parseExtractedNote(result.nonReasoningContent);
}

export function parseExtractedNote(content: string): CreateNoteInput {
  const parsed: unknown = JSON.parse(content);
  const note = createNoteSchema.parse(parsed);

  return {
    ...note,
    currency: note.currency.toUpperCase(),
    serial: note.serial.trim(),
  };
}

export async function createNote(baseUrl: URL, note: CreateNoteInput): Promise<CreateNoteResult> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(note),
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    const result = errorResponseSchema.safeParse(body);
    if (!result.success) {
      throw new Error(`Backend returned an unexpected error response for ${note.serial}`);
    }

    if (response.status === 409) {
      return { status: "duplicate", note };
    }

    throw new Error(`Backend rejected ${note.serial}: ${result.data.error}`);
  }

  const result = createNoteResponseSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`Backend returned an unexpected response for ${note.serial}`);
  }

  return { status: "created", note: result.data.note };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const backendUrl = new URL(`http://${options.host}:${options.port}/`);
  const imagePaths = await getImagePaths();

  if (imagePaths.length === 0) {
    throw new Error(`No supported image files found in ${NOTES_DIR}. Expected: ${Array.from(SUPPORTED_IMAGE_EXTENSIONS).join(", ")}.`);
  }

  const client = new LMStudioClient();
  const model = await resolveModel(client);
  const notes: Note[] = [];
  const duplicates: CreateNoteInput[] = [];

  for (const imagePath of imagePaths) {
    const note = await extractNote(client, model, imagePath);
    const result = await createNote(backendUrl, note);

    if (result.status === "duplicate") {
      duplicates.push(result.note);
      console.log(`Skipped existing note ${result.note.serial} (${result.note.currency})`);
      continue;
    }

    notes.push(result.note);
  }

  console.log(`Created ${notes.length} note${notes.length === 1 ? "" : "s"} in ${backendUrl.toString()}`);
  if (duplicates.length > 0) {
    console.log(`Skipped ${duplicates.length} existing note${duplicates.length === 1 ? "" : "s"}.`);
  }
  process.exit(0);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
