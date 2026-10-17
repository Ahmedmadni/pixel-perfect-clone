import { describe,expect,it } from "vitest";
import { parseBrowserPlan, InvalidBrowserPlan } from "../src/browser-plan.ts";

describe("strict per-step Ollama browser actions",()=>{
  it("accepts only bounded structured actions",()=>{
    expect(parseBrowserPlan('{"action":"scroll","direction":"down"}')).toEqual({action:"scroll",direction:"down"});
    expect(parseBrowserPlan('```json\n{"action":"fill","elementId":"paw-1-abcdefgh","text":"بحث"}\n```'))
      .toMatchObject({action:"fill",text:"بحث"});
    expect(parseBrowserPlan('{"action":"finish","message":"تمت المراجعة فقط"}').action).toBe("finish");
  });
  it.each([
    '{"action":"click","elementId":"paw-1-abcdefgh"}',
    '{"action":"submit","elementId":"paw-1-abcdefgh"}',
    '{"action":"fill","elementId":"arbitrary-css","text":"secret"}',
    '{"action":"scroll","direction":"left"}',
    '{"action":"navigate","url":"javascript:alert(1)"}',
    '{"action":"scroll","direction":"up","extra":true}',
    'not JSON',
  ])("rejects invented or destructive tool call %s",(value)=>{
    expect(()=>parseBrowserPlan(value)).toThrow(InvalidBrowserPlan);
  });
});
