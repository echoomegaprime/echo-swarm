import { bytesToBase64, stableJson } from "./canonical";
import type {
  CommanderSignatureSubmission,
  CommanderStatement,
  ReleaseCertificateSnapshot,
} from "./types";

const DATABASE = "echo-swarm-certificate-keys";
const STORE = "non-extractable-keys";
const KEY_ID = "commander-es256-v1";

interface StoredKey {
  id: string;
  pair: CryptoKeyPair;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("commander_key_database_failed"));
  });
}

async function storedKey(): Promise<CryptoKeyPair | undefined> {
  const database = await openKeyDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(KEY_ID);
      request.onsuccess = () => resolve((request.result as StoredKey | undefined)?.pair);
      request.onerror = () => reject(request.error ?? new Error("commander_key_read_failed"));
    });
  } finally {
    database.close();
  }
}

async function saveKey(pair: CryptoKeyPair): Promise<void> {
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: KEY_ID, pair } satisfies StoredKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("commander_key_write_failed"));
    });
  } finally {
    database.close();
  }
}

async function commanderKey(): Promise<CryptoKeyPair> {
  const existing = await storedKey();
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  await saveKey(pair);
  return pair;
}

export async function createCommanderSignature(
  certificate: ReleaseCertificateSnapshot,
  githubLogin: string,
): Promise<CommanderSignatureSubmission> {
  if (!certificate.officialReceipt || !certificate.certificateDigest) {
    throw new Error("certificate_not_ready_for_commander");
  }
  const pair = await commanderKey();
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const statement: CommanderStatement = {
    schemaVersion: "1.0.0",
    action: "approve-release-certificate",
    program: "Echo Swarm",
    certificateDigest: certificate.certificateDigest,
    certificateId: certificate.officialReceipt.payload.run_id,
    releaseSha: certificate.releaseSha,
    signerName: certificate.commanderDisplayName,
    signerRole: "Commander",
    githubLogin,
    signedAt: new Date().toISOString(),
  };
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(stableJson(statement)),
  );
  return { statement, publicKeyJwk, signatureB64: bytesToBase64(signature) };
}

