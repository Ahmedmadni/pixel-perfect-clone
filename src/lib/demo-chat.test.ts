import { describe, expect, it } from "vitest";
import { demoChatReply } from "./demo-chat";

describe("cloud preview chat stays demonstrative", () => {
  it.each(["الرسائل غير المقروءة", "افتح المتصفح", "النسخ الاحتياطي", "مرحبا"])(
    "labels %s as fake and avoids claiming actual inference", (query) => {
      const response = demoChatReply(query);
      expect(response).toContain("محاكاة للواجهة فقط");
      expect(response).toContain("ليس من Ollama");
      expect(response.length).toBeGreaterThan(70);
    },
  );
  it("does not echo sensitive input or fabricate account data", () => {
    const privateText = "user_private_012345_secret";
    const response = demoChatReply("راجع رسائل واتساب " + privateText);
    expect(response).not.toContain(privateText);
    expect(response).toContain("لا توجد رسائل فعلية");
  });
});
