import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Clock } from "./clock";
import { uuidv7 } from "../shared/ids";
import { fail, ok, type Result } from "../shared/result";

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface CredentialBlob {
  credentialId: string;
  ciphertext: string;
  createdAt: string;
  updatedAt: string;
}

export interface SetSecretInput {
  value: string;
  credentialId?: string;
  persist?: boolean;
}

export class CredentialStore {
  private blobs: CredentialBlob[];
  private readonly session = new Map<string, string>();

  constructor(
    private readonly filePath: string,
    private readonly clock: Clock,
    private readonly safeStorage: SafeStorage,
    private readonly newId: () => string = uuidv7,
  ) {
    this.blobs = loadBlobs(filePath);
  }

  set(input: SetSecretInput): Result<{ credentialId: string }> {
    const value = input.value;
    if (typeof value !== "string" || value.length < 1) {
      return fail({
        code: "IPC_INVALID_REQUEST",
        messageKey: "ipc.invalid_request",
        retryable: false,
      });
    }
    const persist = input.persist ?? true;
    const credentialId =
      input.credentialId && input.credentialId.length > 0 ? input.credentialId : this.newId();
    const now = this.clock.nowIso();

    if (!persist) {
      this.session.set(credentialId, value);
      const before = this.blobs.length;
      this.blobs = this.blobs.filter((blob) => blob.credentialId !== credentialId);
      if (this.blobs.length !== before) {
        persistBlobs(this.filePath, this.blobs);
      }
      return ok({ credentialId });
    }

    if (!this.safeStorage.isEncryptionAvailable()) {
      return fail({
        code: "CREDENTIAL_STORAGE_UNAVAILABLE",
        messageKey: "credential.storage_unavailable",
        retryable: false,
      });
    }

    let ciphertext: string;
    try {
      ciphertext = Buffer.from(this.safeStorage.encryptString(value)).toString("base64");
    } catch {
      return fail({
        code: "CREDENTIAL_STORAGE_UNAVAILABLE",
        messageKey: "credential.storage_unavailable",
        retryable: false,
      });
    }

    const existing = this.blobs.find((blob) => blob.credentialId === credentialId);
    const blob: CredentialBlob = {
      credentialId,
      ciphertext,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.blobs = [...this.blobs.filter((item) => item.credentialId !== credentialId), blob];
    this.session.delete(credentialId);
    persistBlobs(this.filePath, this.blobs);
    return ok({ credentialId });
  }

  has(credentialId: string): Result<{ present: boolean }> {
    return ok({
      present: this.session.has(credentialId) || this.blobs.some((blob) => blob.credentialId === credentialId),
    });
  }

  use<T>(credentialId: string, callback: (plaintext: string) => T): Result<T> {
    const session = this.session.get(credentialId);
    if (session !== undefined) {
      return ok(callback(session));
    }
    const blob = this.blobs.find((item) => item.credentialId === credentialId);
    if (!blob) {
      return fail({
        code: "CREDENTIAL_NOT_FOUND",
        messageKey: "credential.not_found",
        retryable: false,
      });
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      return fail({
        code: "CREDENTIAL_STORAGE_UNAVAILABLE",
        messageKey: "credential.storage_unavailable",
        retryable: false,
      });
    }
    let plaintext: string;
    try {
      plaintext = this.safeStorage.decryptString(Buffer.from(blob.ciphertext, "base64"));
    } catch {
      return fail({
        code: "CREDENTIAL_NOT_FOUND",
        messageKey: "credential.not_found",
        retryable: false,
      });
    }
    return ok(callback(plaintext));
  }

  delete(credentialId: string): Result<void> {
    const inSession = this.session.delete(credentialId);
    const before = this.blobs.length;
    this.blobs = this.blobs.filter((blob) => blob.credentialId !== credentialId);
    if (this.blobs.length !== before) {
      persistBlobs(this.filePath, this.blobs);
    }
    if (!inSession && before === this.blobs.length) {
      return fail({
        code: "CREDENTIAL_NOT_FOUND",
        messageKey: "credential.not_found",
        retryable: false,
      });
    }
    return ok(undefined);
  }
}

function isBlob(value: unknown): value is CredentialBlob {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.credentialId === "string" &&
    typeof row.ciphertext === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
  );
}

function loadBlobs(filePath: string): CredentialBlob[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const blobs: CredentialBlob[] = [];
    for (const item of parsed) {
      if (!isBlob(item)) continue;
      blobs.push({
        credentialId: item.credentialId,
        ciphertext: item.ciphertext,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
    }
    return blobs;
  } catch {
    return [];
  }
}

function persistBlobs(filePath: string, blobs: CredentialBlob[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const payload = JSON.stringify(blobs);
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
}
