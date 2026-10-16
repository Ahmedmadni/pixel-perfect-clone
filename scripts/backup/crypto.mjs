import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat, appendFile, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

const scrypt = promisify(scryptCb);
const DATABASE_MAGIC = "PAWBK001";
const PROFILE_MAGIC = "PAWPR001";
function magicFor(format) {
  if (format === "database") return Buffer.from(DATABASE_MAGIC, "ascii");
  if (format === "browser-profile") return Buffer.from(PROFILE_MAGIC, "ascii");
  throw new Error("Unknown encrypted archive format");
}
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 8 + SALT_BYTES + IV_BYTES;
// Deliberately moderate memory cost (~64MB) for local Windows PCs.
const KDF_OPTIONS = { N: 1 << 16, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

async function keyFor(password, salt) {
  if (typeof password !== "string" || password.length < 16) {
    throw new Error("Backup passphrase must contain at least 16 characters");
  }
  return scrypt(password.normalize("NFC"), salt, 32, KDF_OPTIONS);
}

export async function encryptStream(readable, destination, password, format = "database") {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([magicFor(format), salt, iv]);
  const key = await keyFor(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const fd = await open(destination, "wx", 0o600);
  try { await fd.writeFile(header); }
  finally { await fd.close(); }
  try {
    await pipeline(readable, cipher, createWriteStream(destination, {flags:"a",mode:0o600}));
    await appendFile(destination, cipher.getAuthTag());
  } catch (error) {
    await rm(destination, {force:true}).catch(() => {});
    throw error;
  } finally {
    key.fill(0);
  }
}

export async function decryptToFile(source, destination, password, format = "database") {
  const details = await stat(source);
  if (!details.isFile() || details.size < HEADER_BYTES + TAG_BYTES + 1) {
    throw new Error("Invalid or incomplete PAW encrypted backup");
  }
  const input = await open(source,"r");
  let header, tag;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    tag = Buffer.alloc(TAG_BYTES);
    if ((await input.read(header,0,HEADER_BYTES,0)).bytesRead !== HEADER_BYTES ||
        !header.subarray(0,8).equals(magicFor(format)) ||
        (await input.read(tag,0,TAG_BYTES,details.size-TAG_BYTES)).bytesRead !== TAG_BYTES) {
      throw new Error("Unsupported or damaged PAW encrypted backup");
    }
  } finally { await input.close(); }
  const salt = header.subarray(8,8+SALT_BYTES);
  const iv = header.subarray(8+SALT_BYTES);
  const key = await keyFor(password,salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    // NEVER hand decrypted data to pg_restore until the GCM tag has been
    // verified successfully. Temporary plaintext is removed even on failure.
    const handle = await open(destination,"wx",0o600);
    await handle.close();
    await pipeline(
      createReadStream(source,{start:HEADER_BYTES,end:details.size-TAG_BYTES-1}),
      decipher,
      createWriteStream(destination,{flags:"w",mode:0o600}),
    );
  } catch {
    await rm(destination,{force:true}).catch(()=>{});
    throw new Error("Backup password was incorrect or encrypted file is damaged");
  } finally {
    key.fill(0);
  }
}

/**
 * Authenticates the entire encrypted archive WITHOUT creating plaintext files
 * or writing decrypted bytes to a database. Useful for periodic backup checks.
 */
export async function verifyEncryptedFile(source, password, format = "database") {
  const details=await stat(source);
  if(!details.isFile() || details.size < HEADER_BYTES + TAG_BYTES + 1) {
    throw new Error("Invalid or incomplete PAW encrypted backup");
  }
  const file=await open(source,"r");
  const header=Buffer.alloc(HEADER_BYTES);
  const tag=Buffer.alloc(TAG_BYTES);
  try {
    if((await file.read(header,0,HEADER_BYTES,0)).bytesRead !== HEADER_BYTES ||
       !header.subarray(0,8).equals(magicFor(format)) ||
       (await file.read(tag,0,TAG_BYTES,details.size-TAG_BYTES)).bytesRead !== TAG_BYTES) {
      throw new Error("Unsupported or damaged PAW encrypted backup");
    }
  } finally {await file.close();}
  const key=await keyFor(password,header.subarray(8,8+SALT_BYTES));
  const decipher=createDecipheriv("aes-256-gcm",key,header.subarray(8+SALT_BYTES));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source,{start:HEADER_BYTES,end:details.size-TAG_BYTES-1}),
      decipher,
      new Writable({write(_chunk,_encoding,callback){callback();}}),
    );
    return true;
  } catch {
    throw new Error("Backup password was incorrect or encrypted file is damaged");
  } finally {key.fill(0);}
}
