#!/usr/bin/env node
/**
 * Local Chromium profile archive: explicit opt-in, stopped-browser only.
 * Encryption key/passphrase read via stdin. No cloud access, no online browser.
 * Restore creates a NEVER-ATTACHED Docker volume, not the live profile.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, link, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { encryptStream, decryptToFile, verifyEncryptedFile } from "./crypto.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const compose = ["compose","-f","compose.browser.yml"];
const image = "alpine:3.20";
function ensureSafeVolume(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/.test(name)) {
    throw new Error("Invalid Docker volume reference");
  }
  return name;
}
function insideCheckout(folder) {
  const rel=relative(root,folder);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\") && !isAbsolute(rel));
}
function arg(name) {
  const i=process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i+1] || null;
}
async function passwordFromStdin() {
  if (process.stdin.isTTY) throw new Error("Use the interactive Windows wrapper for a hidden password");
  let v="";
  for await (const chunk of process.stdin) {
    v+=chunk.toString("utf8");
    if (v.length>4096) throw new Error("Passphrase too long");
  }
  return v.replace(/\r?\n$/,"");
}
function startDocker(args,{capture=false,stream=false}={}) {
  const process=spawn("docker",args,{
    cwd:root,stdio:["pipe","pipe","pipe"],windowsHide:true,
  });
  let err="";
  process.stderr.on("data",buf=>{if(err.length<1200)err+=buf.toString("utf8").slice(0,350)});
  const chunks=[];
  if (capture) process.stdout.on("data",c=>chunks.push(c));
  if (!capture && !stream) process.stdout.resume();
  if (!stream) process.stdin.end();
  const finished=new Promise((yes,no)=>{
    process.once("error",no);
    process.once("close",code=>code===0?yes():no(new Error("Docker command failed ("+args[0]+"): "+err.slice(-600))));
  });
  return {process,finished,output:async()=>{await finished;return Buffer.concat(chunks).toString("utf8").trim();}};
}
async function inspectStoppedVolume() {
  const result=startDocker([...compose,"ps","-a","-q","browser-worker"],{capture:true});
  const id=(await result.output()).split(/\s+/).filter(Boolean);
  if(id.length !== 1)throw new Error("Expected one existing browser-worker container; start the browser once, then stop it");
  const state=startDocker(["container","inspect",id[0]],{capture:true});
  const resultJson=JSON.parse(await state.output());
  const worker=resultJson[0];
  if(worker?.Config?.Labels?.["com.docker.compose.service"] !== "browser-worker") {
    throw new Error("Refusing to read an unrecognized Docker container");
  }
  if(worker.State?.Running || worker.State?.Restarting || worker.State?.Paused) {
    throw new Error("Stop browser-worker FIRST; copying an active Chromium profile is unsafe");
  }
  const matched=(worker.Mounts??[]).filter(m=>
    m.Type==="volume" && m.Destination==="/home/pwuser/browser-data");
  if(matched.length!==1)throw new Error("Browser profile Docker volume was not found");
  const name=ensureSafeVolume(matched[0].Name);
  // Reject when ANOTHER container is using the same volume while running.
  const ps=startDocker(["ps","-q","--filter","volume="+name],{capture:true});
  if(await ps.output())throw new Error("Docker profile volume is still in use; stop its other containers first");
  return name;
}
async function ensureDestination(destination) {
  const target=resolve(destination);
  if(!target.toLowerCase().endsWith(".pawprofile"))throw new Error("Chromium profile archive must end in .pawprofile");
  const parent=dirname(target);
  await mkdir(parent,{recursive:true});
  const canonicalParent=await realpath(parent);
  if(insideCheckout(canonicalParent))throw new Error("No backups inside the public Git repository");
  try {
    await access(target);
    throw new Error("Refusing to overwrite an existing encrypted Chromium profile");
  }catch(e){if(e.code!=="ENOENT")throw e;}
  return target;
}
async function backup(output,password) {
  const volume=await inspectStoppedVolume();
  const target=await ensureDestination(output);
  const temp=join(dirname(target),".paw-profile-"+randomBytes(12).toString("hex")+".partial");
  const args=["run","--rm","--network","none","--read-only",
    "--user","1000:1000","--cap-drop","ALL","--security-opt","no-new-privileges",
    "--mount",`type=volume,source=${volume},target=/source,readonly`,
    image,"tar","-C","/source","-cf","-","."];
  const job=startDocker(args,{stream:true});
  try {
    // Chromium volume is read-only; encrypt tar stream without dumping plaintext to disk.
    await Promise.all([encryptStream(job.process.stdout,temp,password,"browser-profile"),job.finished]);
    await verifyEncryptedFile(temp,password,"browser-profile");
    // Fail instead of replacing a prior snapshot.
    await link(temp,target);
    console.log("Encrypted offline Chromium profile archive created:",target);
    console.log("Real account cookies may be in this file. Store it as highly sensitive.");
  }catch(e) {
    job.process.kill();
    await job.finished.catch(()=>{});
    throw e;
  }finally{await rm(temp,{force:true}).catch(()=>{});}
}
async function restore(input,password) {
  // Checking existing browser ownership before restore avoids accidental changes
  // while a worker is still running. The restored volume is not connected to it.
  await inspectStoppedVolume();
  const source=await realpath(resolve(input));
  if(insideCheckout(source))throw new Error("Refusing to restore from inside the public Git checkout");
  const folder=await mkdtemp(join(tmpdir(),"paw-profile-restore-"));
  const plaintext=join(folder,"profile.tar");
  let name;
  try {
    // Complete authenticated decryption BEFORE opening any Docker volume.
    await decryptToFile(source,plaintext,password,"browser-profile");
    name="paw_profile_restore_"+randomBytes(10).toString("hex");
    await startDocker(["volume","create",name],{capture:true}).output();
    // One-time ownership setup is limited to the brand-new disconnected volume.
    // It has no host mounts, network or access to the original profile.
    const prepare=startDocker(["run","--rm","--network","none","--read-only",
      "--cap-drop","ALL","--cap-add","CHOWN","--security-opt","no-new-privileges",
      "--mount",`type=volume,source=${name},target=/restore`,
      image,"chown","1000:1000","/restore"],{capture:true});
    await prepare.finished;
    const args=["run","--rm","-i","--network","none","--read-only",
      "--user","1000:1000",
      "--cap-drop","ALL","--security-opt","no-new-privileges",
      "--mount",`type=volume,source=${name},target=/restore`,
      image,"tar","-C","/restore","-xf","-"];
    const job=startDocker(args,{stream:true});
    try {
      await Promise.all([pipeline(createReadStream(plaintext),job.process.stdin),job.finished]);
    } catch(e) {job.process.kill();await job.finished.catch(()=>{});throw e;}
    const verify=startDocker(["run","--rm","--network","none","--read-only",
      "--cap-drop","ALL","--security-opt","no-new-privileges",
      "--mount",`type=volume,source=${name},target=/check,readonly`,
      image,"test","-d","/check/default"],{capture:true});
    await verify.finished;
    console.log("Restored into NEW UNATTACHED Docker volume:",name);
    console.log("Existing browser profile remains unchanged. No automatic activation or login attempted.");
  } catch(e) {
    if(name) {
      await startDocker(["volume","rm",name],{capture:true}).finished.catch(()=>{});
    }
    throw e;
  }finally{
    // Decrypted archive temporarily resides in OS temp. Full-disk encryption is mandatory.
    await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
  }
}
async function main() {
  const action=process.argv[2];
  if(!["backup","verify","restore"].includes(action)){
    throw new Error("Usage: browser-profile.mjs backup --output FILE | verify --input FILE | restore --input FILE");
  }
  const password=await passwordFromStdin();
  if(action==="backup"){
    const target=arg("--output")||join(homedir(),"PAW-Backups","chromium-"+new Date().toISOString().replace(/[:.]/g,"-")+".pawprofile");
    await backup(target,password);
  }else{
    const input=arg("--input");
    if(!input)throw new Error("Missing --input path");
    if(!input.toLowerCase().endsWith(".pawprofile"))throw new Error("Expected encrypted .pawprofile file");
    if(action==="verify"){
      await verifyEncryptedFile(await realpath(resolve(input)),password,"browser-profile");
      console.log("Chromium profile encryption verified. No profile was extracted.");
    }else await restore(input,password);
  }
}
main().catch(e=>{
  console.error("Chromium profile operation failed:",e instanceof Error?e.message:"unknown error");
  process.exitCode=1;
});
