import { LMStudioClient, type LLM, type LLMInfo } from "@lmstudio/sdk";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

const MODEL_FAMILY = "zai-org/glm-4.6v-flash";
const NOTES_DIR = path.join(process.cwd(), "notes");
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const SYSTEM_PROMPT = `You are an expert money sorter. Your job is to look at the provided image, and identify the following information from it:
- currency (ISO 4217 currency code)
- denomination
- serial number

The user is not interacting with you directly, so you cannot ask any followup questions, and you must not say anything extraneous apart from the JSON output.`;

const createNoteSchema = z.object({
  currency: z.string().length(3),
  denomination: z.number().int().positive(),
  serial: z.string(),
});
type CreateNoteInput = z.infer<typeof createNoteSchema>;
const createNoteJsonSchema = z.toJSONSchema(createNoteSchema, {
  target: "draft-07",
});
const noteSchema = createNoteSchema.extend({
  created: z.string(),
});
type Note = z.infer<typeof noteSchema>;
const createNoteResponseSchema = z.object({
  note: noteSchema,
});
const errorResponseSchema = z.object({
  error: z.string(),
});

type CliOptions = {
  host: string;
  port: number;
};

type CreateNoteResult =
  | { status: "created"; note: Note }
  | { status: "duplicate"; note: CreateNoteInput };

type ImageProcessingFailure = {
  imagePath: string;
  error: string;
};

type ImageProcessingResult = {
  created: Note[];
  duplicates: CreateNoteInput[];
  failures: ImageProcessingFailure[];
};

type ImageProcessor = {
  extract(imagePath: string): Promise<CreateNoteInput>;
  create(note: CreateNoteInput): Promise<CreateNoteResult>;
  archive(imagePath: string): Promise<string>;
};

type ModelReference = Pick<LLM, "modelKey" | "identifier" | "path">;

// listDownloadedModels() covers all domains, so `type` stays wide and the "llm" filter below narrows it
type DownloadedModelReference = Pick<
  LLMInfo,
  "modelKey" | "path" | "displayName"
> & {
  type: string;
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
  const { values } = parseArgs({
    args: [...argv],
    options: {
      host: { type: "string", default: "localhost" },
      port: { type: "string", default: "3000" },
    },
  });

  if (values.host.trim().length === 0) {
    throw new Error("host cannot be empty");
  }

  return { host: values.host, port: parsePort(values.port) };
}

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${JSON.stringify(value)}`);
  }

  return port;
}

export async function getImagePaths(notesDir: string): Promise<string[]> {
  const entries = await readdir(notesDir, { withFileTypes: true });

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => path.join(notesDir, name));
}

export async function archiveImage(imagePath: string): Promise<string> {
  const processedDir = path.join(path.dirname(imagePath), "processed");
  await mkdir(processedDir, { recursive: true });
  const filename = path.basename(imagePath);
  const existingFilenames = await readdir(processedDir);
  if (existingFilenames.includes(filename)) {
    throw new Error(
      `cannot archive ${filename} because ${path.join(processedDir, filename)} already exists`,
    );
  }

  const destination = path.join(processedDir, filename);
  await rename(imagePath, destination);
  return destination;
}

export async function resolveModel<Model extends ModelReference>(
  client: ModelResolverClient<Model>,
): Promise<Model> {
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

export async function createNote(
  baseUrl: URL,
  note: CreateNoteInput,
): Promise<CreateNoteResult> {
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
      throw new Error(
        `Backend returned an unexpected error response for ${note.serial}`,
      );
    }

    if (response.status === 409) {
      return { status: "duplicate", note };
    }

    throw new Error(`Backend rejected ${note.serial}: ${result.data.error}`);
  }

  const result = createNoteResponseSchema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `Backend returned an unexpected response for ${note.serial}`,
    );
  }

  return { status: "created", note: result.data.note };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`;
}

export async function processImagePaths(
  imagePaths: readonly string[],
  processor: ImageProcessor,
): Promise<ImageProcessingResult> {
  const result: ImageProcessingResult = {
    created: [],
    duplicates: [],
    failures: [],
  };

  for (const imagePath of imagePaths) {
    try {
      const note = await processor.extract(imagePath);
      const createResult = await processor.create(note);

      if (createResult.status === "duplicate") {
        result.duplicates.push(createResult.note);
      } else {
        result.created.push(createResult.note);
      }

      await processor.archive(imagePath);
    } catch (error) {
      result.failures.push({ imagePath, error: getErrorMessage(error) });
    }
  }

  return result;
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const backendUrl = new URL(`http://${options.host}:${options.port}/`);
  const imagePaths = await getImagePaths(NOTES_DIR);

  if (imagePaths.length === 0) {
    throw new Error(
      `No supported image files found in ${NOTES_DIR}. Expected: ${Array.from(SUPPORTED_IMAGE_EXTENSIONS).join(", ")}.`,
    );
  }

  const client = new LMStudioClient();
  const model = await resolveModel(client);
  const result = await processImagePaths(imagePaths, {
    extract: (imagePath) => extractNote(client, model, imagePath),
    create: (note) => createNote(backendUrl, note),
    archive: archiveImage,
  });

  for (const duplicate of result.duplicates) {
    console.log(
      `Skipped existing note ${duplicate.serial} (${duplicate.currency} ${duplicate.denomination})`,
    );
  }
  for (const failure of result.failures) {
    console.error(`Failed to process ${failure.imagePath}: ${failure.error}`);
  }

  console.log(
    `Created ${count(result.created.length, "note")} in ${backendUrl}`,
  );
  if (result.duplicates.length > 0) {
    console.log(`Skipped ${count(result.duplicates.length, "existing note")}.`);
  }
  if (result.failures.length > 0) {
    throw new Error(
      `${count(result.failures.length, "image")} failed and remain in ${NOTES_DIR}`,
    );
  }
  process.exit(0);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(getErrorMessage(error));
    process.exit(1);
  });
}
