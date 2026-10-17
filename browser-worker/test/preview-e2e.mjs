/**
 * Frontend-only smoke checks against a real browser in disposable CI.
 * VITE_MOCK_MODE=true. NO account sessions or actual local APIs are accessed.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.PAW_PREVIEW_URL || "http://127.0.0.1:8080";
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: false, // Disposable GitHub CI only; no real accounts/data.
  args: ["--disable-dev-shm-usage"],
});

async function run(label, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, locale: "ar-SA" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 40_000 });
    assert.equal(response?.status(), 200, label + ": index request");
    await page.getByText("معاينة تجريبية للواجهة", { exact: false }).first().waitFor({ timeout: 20_000 });
    // SSR markup is visible before React attaches event handlers. Wait for true hydration.
    await page.locator('[data-app-ready="true"]').waitFor({timeout: 20_000});
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.ok(await page.getByText("أنت تستعرض واجهة المشروع", { exact: false }).count() > 0,
      label + ": preview must not claim live account access");
    if (width < 768) {
      const open = page.getByRole("button", { name: "فتح القائمة الرئيسية" });
      assert.ok(await open.isVisible(), label + ": mobile navigation exists");
      await open.click();
      try {
        await page.getByRole("dialog").getByRole("link", { name: "المحادثة والمهام" }).click({ timeout: 8000 });
      } catch (err) {
        console.error("Mobile navigation diagnostic:", JSON.stringify({
          dialogs: await page.locator('[role="dialog"]').count(),
          openButtons: await page.locator('[data-state="open"]').count(),
          links: (await page.locator("a").allTextContents()).slice(0, 25),
          dialogTexts: (await page.locator('[role="dialog"]').allTextContents()).slice(0, 3),
          browserErrors: errors,
        }));
        throw err;
      }
    } else {
      await page.getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("link", { name: "المحادثة والمهام" }).first().click();
    }
    await page.getByText("مختبر عرض تجريبي", { exact: false }).first().waitFor({ timeout: 15_000 });
    const input = page.getByPlaceholder("جرّب: لخص رسائل واتساب (محاكاة فقط)…");
    await input.fill("لخص رسائل واتساب التجريبية");
    await page.getByRole("button", { name: "تجربة محاكاة" }).click();
    await page.getByText("محاكاة للواجهة فقط", { exact: false }).last().waitFor({ timeout: 10_000 });
    assert.ok(await page.getByText("لا توجد رسائل فعلية", { exact: false }).count() > 0,
      label + ": preview cannot fabricate read account messages");
    await page.getByRole("button", { name: "إعادة ضبط التجربة" }).click();
    assert.equal(await page.getByText("لا توجد رسائل فعلية", { exact: false }).count(), 0,
      label + ": resetting the demo removes temporary messages");
    if (width < 768) {
      await page.getByRole("button", { name: "فتح القائمة الرئيسية" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "إعدادات النظام" }).click();
    } else {
      await page.getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("link", { name: "إعدادات النظام" }).first().click();
    }
    await page.getByText("تفويض الخادم المحلي").first().waitFor({ timeout: 15_000 });
    assert.ok(await page.getByLabel("رمز الاتصال المحلي").isDisabled(),
      label + ": preview token input must be disabled");
    // Read-only reports should provide safe task inspection and log filters.
    if (width < 768) {
      await page.getByRole("button", { name: "فتح القائمة الرئيسية" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "التقارير والسجلات" }).click();
    } else {
      await page.getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("link", { name: "التقارير والسجلات" }).first().click();
    }
    await page.getByText("مركز المهام والتقارير", { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByTestId("task-monitor").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "مكتملة (1)" }).click();
    await page.getByText("أرشفة المحادثات القديمة", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByTestId("task-detail-k3").locator("summary").click();
    await page.getByText("فتح التفاصيل لا يغيّر حالة المهمة", { exact: false }).first().waitFor({ timeout: 10_000 });
    await page.getByLabel("البحث في المهام").fill("عنصر غير موجود 8675309");
    await page.getByText("لا توجد مهام تطابق البحث", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).first().click();
    await page.getByText("تلخيص الرسائل غير المقروءة", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByLabel("البحث في السجل").fill("عبارة لا تظهر في أي سجل 8675309");
    await page.getByText("لا توجد أحداث تطابق", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).last().click();
    await page.getByText("تم تحميل الواجهة في الوضع التجريبي", { exact: false }).waitFor({ timeout: 10_000 });

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      width: window.innerWidth,
    }));
    assert.ok(overflow.doc <= overflow.width + 2,
      label + ": horizontal overflow " + JSON.stringify(overflow));
    assert.deepEqual(errors, [], label + ": no uncaught browser errors");
    console.log("PASS "+label+": RTL, navigation, synthetic chat, reset, token safety, responsive");
  } finally {
    await context.close();
  }
}
try {
  await run("mobile 390px", 390, 844);
  await run("desktop 1440px", 1440, 900);
} finally {
  await browser.close();
}
