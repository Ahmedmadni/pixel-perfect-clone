import { z } from "zod";

/** Model proposes ONE constrained step. It never supplies code or CSS selectors. */
const id=z.string().regex(/^paw-\d{1,2}-[a-z0-9]{8}$/);
const text=z.string().max(500);
const plan=z.discriminatedUnion("action",[
  z.object({action:z.literal("finish"),message:z.string().trim().min(1).max(1600)}).strict(),
  z.object({action:z.literal("scroll"),direction:z.enum(["up","down"])}).strict(),
  z.object({action:z.literal("follow_link"),elementId:id}).strict(),
  z.object({action:z.literal("fill"),elementId:id,text}).strict(),
  z.object({action:z.literal("navigate"),url:z.string().url().max(2048)}).strict(),
]);
export type BrowserPlan=z.infer<typeof plan>;

export class InvalidBrowserPlan extends Error {}

export function parseBrowserPlan(response:string):BrowserPlan {
  let raw=response.trim();
  // Some local models wrap JSON in a code fence; do not evaluate arbitrary code.
  if(raw.startsWith("```"))raw=raw.replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
  const first=raw.indexOf("{");
  const last=raw.lastIndexOf("}");
  if(first<0||last<first||last-first>3000)throw new InvalidBrowserPlan("Model did not return one valid browser action");
  let parsed:unknown;
  try{parsed=JSON.parse(raw.slice(first,last+1));}
  catch{throw new InvalidBrowserPlan("Model returned malformed action JSON");}
  const result=plan.safeParse(parsed);
  if(!result.success)throw new InvalidBrowserPlan("Model requested an unsupported or unsafe browser action");
  return result.data;
}
