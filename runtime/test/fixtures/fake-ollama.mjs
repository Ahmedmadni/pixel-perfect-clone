/**
 * A FAKE Ollama HTTP fixture for private loopback-only CI integration tests.
 * No real inference, no downloads, no external API requests.
 */
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number(process.env.OLLAMA_FIXTURE_PORT || "11434");
const model = "ci-fixture:latest";

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/tags") {
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({models:[{name:model, size:1024,details:{family:"fixture",parameter_size:"test-only"}}]}));
    return;
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    const parts=[];
    for await (const chunk of req) parts.push(chunk);
    let data;
    try { data=JSON.parse(Buffer.concat(parts).toString("utf8")); }
    catch {res.writeHead(400); res.end(); return;}
    if (data.model !== model || !Array.isArray(data.messages) || data.stream !== true) {
      res.writeHead(400, {"Content-Type":"application/json"});
      res.end(JSON.stringify({error:"Invalid CI Ollama request"})); return;
    }
    res.writeHead(200, {"Content-Type":"application/x-ndjson"});
    res.write(JSON.stringify({message:{role:"assistant",content:"This is "},done:false})+"\n");
    res.write(JSON.stringify({message:{role:"assistant",content:"a local CI fixture response."},done:false})+"\n");
    res.end(JSON.stringify({done:true})+"\n");
    return;
  }
  res.writeHead(404);res.end();
}).listen(port,host,()=>console.log("Fake Ollama fixture listening on loopback (NO inference)"));
