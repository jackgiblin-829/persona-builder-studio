import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type StoredObject = { key: string; bytes: number; checksum: string };

export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** For local storage this returns an app route, not a presigned vendor URL. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/** Keys are app-generated, but validate anyway — never trust a path. */
function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new AppError("validation", "Invalid storage key.");
  }
}

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(process.cwd(), rootDir);
  }

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) {
      throw new AppError("validation", "Storage key escapes the storage root.");
    }
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    return {
      key,
      bytes: body.byteLength,
      checksum: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async signedUrl(key: string): Promise<string> {
    assertSafeKey(key);
    return `/api/storage/${key}`;
  }
}

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = "s3" as const;

  constructor(
    private readonly bucket: string,
    private readonly config: {
      region: string;
      endpoint?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle?: boolean;
    },
  ) {}

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region: this.config.region,
      ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
      ...(this.config.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(this.config.accessKeyId && this.config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: this.config.accessKeyId,
              secretAccessKey: this.config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
    return {
      key,
      bytes: body.byteLength,
      checksum: createHash("sha256").update(body).digest("hex"),
    };
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    const response = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new AppError("not_found", "Object not found in storage.");
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    assertSafeKey(key);
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    const client = await this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }
}

let cached: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  if (cached) return cached;
  if (env.STORAGE_DRIVER === "s3" && env.S3_BUCKET) {
    cached = new S3ObjectStorage(env.S3_BUCKET, {
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      ...(env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID } : {}),
      ...(env.S3_SECRET_ACCESS_KEY ? { secretAccessKey: env.S3_SECRET_ACCESS_KEY } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  } else {
    cached = new LocalObjectStorage(env.STORAGE_LOCAL_DIR);
  }
  return cached;
}

export function storageKeyFor(parts: {
  organizationId: string;
  projectId: string;
  dataSourceId: string;
  filename: string;
}): string {
  const safeName = parts.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload";
  return join(
    "orgs",
    parts.organizationId,
    "projects",
    parts.projectId,
    "sources",
    parts.dataSourceId,
    safeName,
  )
    .split(sep)
    .join("/");
}
