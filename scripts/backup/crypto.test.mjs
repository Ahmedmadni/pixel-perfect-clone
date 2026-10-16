import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptStream, decryptToFile, verifyEncryptedFile } from "./crypto.mjs";

async function fixture(fn) {
  const dir=await mkdtemp(join(tmpdir(),"paw-crypto-test-"));
  try { await fn(dir); }
  finally {await rm(dir,{recursive:true,force:true});}
}
const pw="My offline passphrase 12345! أمان";
describe("PAW portable encrypted local backups",()=>{
  it("round-trips binary archives using authenticated encryption and random salt",async()=>{
    await fixture(async(dir)=>{
      const data=Buffer.concat([Buffer.from("PostgreSQL archive\0","utf8"),Buffer.alloc(2048,0xa5)]);
      const source=join(dir,"input.dump");
      const first=join(dir,"one.pawbak");
      const second=join(dir,"two.pawbak");
      const decoded=join(dir,"restored.dump");
      await writeFile(source,data);
      await encryptStream(createReadStream(source),first,pw);
      await encryptStream(createReadStream(source),second,pw);
      assert.notDeepEqual(await readFile(first),await readFile(second),"salt/IV must be random");
      assert.notDeepEqual((await readFile(first)).subarray(0,32),data.subarray(0,32));
      assert.equal(await verifyEncryptedFile(first,pw),true);
      await decryptToFile(first,decoded,pw);
      assert.deepEqual(await readFile(decoded),data);
      if(process.platform!=="win32")assert.equal((await stat(first)).mode & 0o077,0);
    });
  });
  it("rejects incorrect passwords before releasing a decrypted output",async()=>{
    await fixture(async(dir)=>{
      const src=join(dir,"in"),backup=join(dir,"backup.pawbak"),output=join(dir,"out");
      await writeFile(src,"secret user data");
      await encryptStream(createReadStream(src),backup,pw);
      await assert.rejects(verifyEncryptedFile(backup,"Different passphrase 1234!"),/incorrect|damaged/);
      await assert.rejects(decryptToFile(backup,output,"Different passphrase 1234!"),/incorrect|damaged/);
      await assert.rejects(stat(output),{code:"ENOENT"});
    });
  });
  it("detects single-byte tampering and removes unauthenticated temporary plaintext",async()=>{
    await fixture(async(dir)=>{
      const src=join(dir,"in"),backup=join(dir,"backup.pawbak"),output=join(dir,"out");
      await writeFile(src,Buffer.alloc(1024,0xab));
      await encryptStream(createReadStream(src),backup,pw);
      const broken=await readFile(backup);
      broken[50]^=1;
      await writeFile(backup,broken);
      await assert.rejects(verifyEncryptedFile(backup,pw),/incorrect|damaged/);
      await assert.rejects(decryptToFile(backup,output,pw),/incorrect|damaged/);
      await assert.rejects(stat(output),{code:"ENOENT"});
    });
  });
  it("rejects partial files, invalid header, and weak passphrases",async()=>{
    await fixture(async(dir)=>{
      const partial=join(dir,"partial.pawbak"),output=join(dir,"out");
      await writeFile(partial,Buffer.alloc(9));
      await assert.rejects(decryptToFile(partial,output,pw),/Invalid or incomplete/);
      const src=join(dir,"in");
      await writeFile(src,"example");
      await assert.rejects(encryptStream(createReadStream(src),join(dir,"encrypted"),"weak"),/at least 16/);
      await assert.rejects(stat(join(dir,"encrypted")),{code:"ENOENT"});
    });
  });
});
