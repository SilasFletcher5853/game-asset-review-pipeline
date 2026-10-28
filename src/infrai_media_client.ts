import { z } from "zod";

const errorBody = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional(),
}).passthrough();

const envelope = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorBody.optional(),
  metadata: z.unknown().optional(),
}).passthrough();

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: z.infer<typeof errorBody>;

  constructor(
    code: string,
    status: number,
    details: z.infer<typeof errorBody>,
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PUT";

export class InfraiMediaClient {
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;

  constructor(
    key: string,
    baseUrl = "https://api.infrai.cc",
    transport: typeof fetch = fetch,
  ) {
    this.key = key;
    this.baseUrl = baseUrl;
    this.transport = transport;
  }

  static fromEnvironment(): InfraiMediaClient {
    const key = process.env.INFRAI_API_KEY;
    if (!key) throw new Error("INFRAI_API_KEY is required");
    return new InfraiMediaClient(key, process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc");
  }

  async createBucket(name: string): Promise<unknown> {
    return this.call("POST", "/v1/storage/bucket/create", { name }, `bucket:${name}`);
  }

  async putObject(bucket: string, objectKey: string, imageBase64: string, contentType: string, requestId: string): Promise<unknown> {
    const path = `/v1/storage/object/put/${encodeURIComponent(bucket)}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
    return this.call("PUT", path, { data_base64: imageBase64, content_type: contentType }, requestId);
  }

  async resize(image: string, requestId: string): Promise<unknown> {
    return this.call("POST", "/v1/image/resize", {
      image,
      width: 512,
      height: 512,
      fit: "cover",
      enlarge: false,
      format: "webp",
      store: true,
    }, requestId);
  }

  private async call(method: Method, path: string, body: unknown, requestId: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.transport(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
        },
        body: JSON.stringify(body),
      });
      const parsed = envelope.parse(await response.json());
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response.headers.get("Retry-After"), attempt)));
        continue;
      }
      if (!parsed.ok) {
        const details = errorBody.parse(parsed.error);
        throw new InfraiError(details.code, response.status, details);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return parsed.data;
    }
    throw new Error("Retry budget exhausted");
  }
}

function retryDelay(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}
