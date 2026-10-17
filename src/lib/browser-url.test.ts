import {describe,expect,it} from "vitest";
import {normalizeBrowserAddress} from "./browser-url";
describe("simple manual browser address bar",()=>{
  it("adds https for plain domains and preserves explicit schemes",()=>{
    expect(normalizeBrowserAddress("example.com")).toBe("https://example.com/");
    expect(normalizeBrowserAddress(" https://example.org/docs ")).toBe("https://example.org/docs");
    expect(normalizeBrowserAddress("http://example.org")).toBe("http://example.org/");
  });
  it.each(["javascript:alert(1)","file:///etc/passwd","","://bad","https://user:pass@example.org"])(
    "rejects dangerous or malformed addresses %s",(value)=>{
      expect(()=>normalizeBrowserAddress(value)).toThrow();
    },
  );
});
