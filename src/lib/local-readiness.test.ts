import { describe, expect, it } from "vitest";
import { evaluateLocalReadiness, type ReadinessInput } from "./local-readiness";
import type { HealthResponse } from "./api/types";

const services = ["api","postgres","ollama","playwright","novnc","agent"] as const;
function health(overrides: Record<string, "up" | "down" | "unknown"> = {}): HealthResponse {
  return {
    version:"test", services:services.map((name) => ({
      name, status:overrides[name] ?? "up",
    })),
  };
}
function input(changes:Partial<ReadinessInput> = {}):ReadinessInput {
  return {
    mock:false, localOrigin:true, tokenPresent:true, health:health(),
    healthError:false, auth:"verified", installedModels:1,
    ...changes,
  };
}
const ids=(x:ReadinessInput) => evaluateLocalReadiness(x).map((v)=>v.id);

describe("local diagnostics without revealing credentials",()=>{
  it("keeps remote Lovable or mock preview separate from the user's PC",()=>{
    expect(ids(input({mock:true}))).toEqual(["hosted-preview"]);
    expect(ids(input({localOrigin:false}))).toEqual(["hosted-preview"]);
  });
  it("identifies unreachable Fastify without pretending services are up",()=>{
    expect(ids(input({health:null,healthError:true}))).toEqual(["runtime-offline"]);
  });
  it("shows exact missing local components",()=>{
    expect(ids(input({health:health({postgres:"down",novnc:"down",playwright:"down",ollama:"down",agent:"down"})})))
      .toEqual(["database","browser","viewer","ollama"]);
  });
  it("distinguishes missing and rejected local token",()=>{
    expect(ids(input({tokenPresent:false,auth:"pending"}))).toContain("token-missing");
    expect(ids(input({auth:"rejected"}))).toContain("token-rejected");
  });
  it("does not claim agent readiness when Ollama is online with zero models",()=>{
    const result = evaluateLocalReadiness(input({health:health({agent:"down"}),installedModels:0}));
    expect(result.some(x=>x.id==="model-missing")).toBe(true);
    expect(result.some(x=>x.id==="ready")).toBe(false);
  });
  it("explains default-off autonomous permissions even with a model",()=>{
    expect(ids(input({health:health({agent:"down"})}))).toContain("agent-disabled");
  });
  it("only reports ready after real service, model and auth success",()=>{
    expect(ids(input())).toEqual(["ready"]);
    expect(ids(input({auth:"pending"}))).not.toContain("ready");
  });
  it("contains neither token inputs nor sensitive page/session data",()=>{
    const json=JSON.stringify(evaluateLocalReadiness(input()));
    expect(json).not.toMatch(/Authorization|sessionStorage|password\s*=|Bearer/i);
  });
});
