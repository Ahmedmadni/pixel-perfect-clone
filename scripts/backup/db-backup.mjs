#!/usr/bin/env node
/**
 * Local-only PostgreSQL archive utility. Does not back up browser cookies,
 * Docker volumes, .env files, tokens, Ollama models or account credentials.
 * Passphrase is passed via STANDARD INPUT, never command arguments or Git.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, link, mkdir, mkdtemp, realpath, rm, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { decryptToFile, encryptStream } from "./crypto.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compose = ["compose", "--env-file","local/.env","-f","compose.database.yml","exec","-T","database"];
function repoRelative(path) {
  const rel=relative(root,path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".."+(process.platform === "win32" ? "\\" : "/")) && !isAbsolute(rel));
}
function getArgument(name) {
  const i=process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i+1] || null;
}
async function passwordFromStdin() {
  if (process.stdin.isTTY) {
    throw new Error("Use the interactive Windows backup wrapper: passwords must not be echoed in a shell");
  }
  let value="";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 4096) throw new Error("Passphrase is too long");
  }
  return value.replace(/\r?\n$/, "");
}
async function runDocker(args, {input=null, capture=false}={}) {
  const proc=spawn("docker",[...compose,...args],{
    cwd:root, stdio:["pipe",capture?"pipe":"ignore","pipe"], windowsHide:true,
  });
  let stderr="";
  proc.stderr.on("data",buf=>{if(stderr.length<1500)stderr+=buf.toString("utf8").slice(0,500)});
  const stdoutChunks=[];
  if(capture)proc.stdout.on("data",b=>stdoutChunks.push(b));
  const completed=new Promise((ok,fail)=>{
    proc.once("error",fail);
    proc.once("close",code=>code===0?ok():fail(new Error("PostgreSQL Docker command failed: "+args[0])));
  });
  try {
    if(input)await pipeline(createReadStream(input),proc.stdin);
    else proc.stdin.end();
    await completed;
  } catch(e) {
    proc.kill();
    await completed.catch(()=>{});
    throw e;
  }
  return capture?Buffer.concat(stdoutChunks).toString("utf8").trim():undefined;
}
async function backup(destination, password) {
  const target=resolve(destination);
  const parent=dirname(target);
  await mkdir(parent,{recursive:true});
  const canonicalParent=await realpath(parent);
  if(repoRelative(canonicalParent)) throw new Error("Refusing to store backups anywhere inside this public Git repository");
  if(!target.endsWith(".pawbak"))throw new Error("Backup name must end with .pawbak");
  try {await access(target);throw new Error("Backup already exists; refusing to overwrite");}
  catch(e) {if(e.code !== "ENOENT")throw e;}
  const temporary=join(parent,".pawbackup-"+randomBytes(12).toString("hex")+".partial");
  const proc=spawn("docker",[...compose,"pg_dump","-U","paw","-d","paw","--format=custom","--no-owner","--no-acl","--schema=public"],{
    cwd:root,stdio:["ignore","pipe","pipe"],windowsHide:true,
  });
  let errorText="";
  proc.stderr.on("data",b=>{if(errorText.length<500)errorText+=b.toString("utf8").slice(0,500)});
  const completed=new Promise((ok,fail)=>{
    proc.once("error",fail);
    proc.once("close",code=>code===0?ok():fail(new Error("pg_dump failed; encrypted backup NOT saved")));
  });
  try {
    await Promise.all([encryptStream(proc.stdout,temporary,password),completed]);
    const size=(await stat(temporary)).size;
    if(size<100)throw new Error("pg_dump returned an unexpectedly small archive");
    // Atomic no-clobber finalization on same filesystem, including NTFS.
    await link(temporary,target);
    console.log("Encrypted backup created:",target);
    console.log("Backup size:",size,"bytes");
    console.log("Browser profiles and local secrets are NOT included.");
  } catch(e) {
    proc.kill();
    await completed.catch(()=>{});
    throw e;
  } finally {
    await rm(temporary,{force:true}).catch(()=>{});
  }
}
async function restore(source, password, databaseArg) {
  const file=await realpath(resolve(source));
  if(repoRelative(file))throw new Error("Refusing a backup inside the public Git repository");
  const database=databaseArg || ("paw_restore_"+Date.now()+"_"+randomBytes(3).toString("hex"));
  if(!/^paw_restore_[a-z0-9_]{3,55}$/.test(database)) {
    throw new Error("Restore database must start with paw_restore_ and contain safe lowercase characters");
  }
  const folder=await mkdtemp(join(tmpdir(),"paw-restore-"));
  const plaintext=join(folder,"database.dump");
  let created=false;
  try {
    // Decrypt AND verify whole GCM tag before creating target DB.
    await decryptToFile(file,plaintext,password);
    await runDocker(["createdb","-U","paw","-T","template0",database]);
    created=true;
    await runDocker(["pg_restore","-U","paw","-d",database,
      "--no-owner","--no-acl","--exit-on-error","--clean","--if-exists"],{input:plaintext});
    const count=await runDocker(["psql","-U","paw","-d",database,"-At","-c",
      "SELECT count(*) FROM schema_migrations"],{capture:true});
    if(Number(count)<7)throw new Error("Restored database does not contain all seven expected migrations");
    console.log("Encrypted backup verified and restored to NEW isolated database:",database);
    console.log("Original paw database was NEVER changed.");
    console.log("The restored database stays inside the local Docker PostgreSQL volume for inspection.");
  } catch(e) {
    if(created) {
      await runDocker(["dropdb","-U","paw","--if-exists",database]).catch(()=>{});
    }
    throw e;
  } finally {
    // A temporary, private, decrypted custom dump exists only during restore.
    // No reliable SSD secure-erasure guarantee; use full-disk encryption.
    await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
  }
}
async function main() {
  const action=process.argv[2];
  if(!["backup","restore"].includes(action))throw new Error("Usage: db-backup.mjs backup --output PATH | restore --input PATH [--database paw_restore_...]");
  const password=await passwordFromStdin();
  if(action==="backup") {
    const dest=getArgument("--output") || join(homedir(),"PAW-Backups","paw-"+new Date().toISOString().replace(/[:.]/g,"-")+".pawbak");
    await backup(dest,password);
  } else {
    const input=getArgument("--input");
    if(!input)throw new Error("Restore requires --input PATH");
    await restore(input,password,getArgument("--database"));
  }
}
main().catch((error)=>{
  console.error("Backup operation failed:",error instanceof Error?error.message:"unknown error");
  process.exitCode=1;
});
