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
  const approvalWrites = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/v1/approvals")) {
      approvalWrites.push(request.url());
    }
  });
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
    await page.getByText("[محاكاة فقط] مثال على التقرير النهائي", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByText("معلومات عرض ثابتة وليست محتوى حسابات حقيقية", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByLabel("البحث في المهام").fill("عنصر غير موجود 8675309");
    await page.getByText("لا توجد مهام تطابق البحث", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).first().click();
    await page.getByText("تلخيص الرسائل غير المقروءة", { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByLabel("البحث في السجل").fill("عبارة لا تظهر في أي سجل 8675309");
    await page.getByText("لا توجد أحداث تطابق", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).last().click();
    await page.getByText("تم تحميل الواجهة في الوضع التجريبي", { exact: false }).waitFor({ timeout: 10_000 });

    // Safe approval centre: only ephemeral preview decisions; no backend or account writes.
    if (width < 768) {
      await page.getByRole("button", { name: "فتح القائمة الرئيسية" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "الموافقات والتنبيهات" }).click();
    } else {
      await page.getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("link", { name: "الموافقات والتنبيهات" }).first().click();
    }
    await page.getByText("مختبر موافقات تجريبي", { exact: false }).first().waitFor({ timeout: 15_000 });
    await page.getByTestId("approval-list").waitFor({ timeout: 15_000 });
    const example = page.getByTestId("approval-r1");
    await example.getByRole("button", { name: "محاكاة اعتماد" }).click();
    const decision = page.getByRole("dialog");
    await decision.getByText("مراجعة اعتماد المسودة").waitFor({ timeout: 10_000 });
    await decision.getByText("هذه مسودة غير حقيقية", { exact: false }).waitFor({ timeout: 10_000 });
    const confirm = decision.getByRole("button", { name: "تأكيد قرار المسودة" });
    assert.equal(await confirm.isDisabled(), true, label + ": approval requires explicit review");
    await decision.getByRole("checkbox", { name: "أؤكد مراجعة نص المسودة" }).click();
    assert.equal(await confirm.isEnabled(), true, label + ": check enables local preview only");
    await confirm.click();
    await example.getByText("مسودة معتمدة", { exact: true }).waitFor({ timeout: 10_000 });
    await example.getByText("حالة تجريبية غير محفوظة", { exact: false }).waitFor({ timeout: 10_000 });
    // Simulate rejection on another synthetic draft; review is required again.
    const rejectExample = page.getByTestId("approval-r2");
    await rejectExample.getByRole("button", { name: "محاكاة رفض" }).click();
    const rejectDialog = page.getByRole("dialog");
    await rejectDialog.getByText("مراجعة رفض المسودة").waitFor({ timeout: 10_000 });
    assert.equal(await rejectDialog.getByRole("button", { name: "تأكيد قرار المسودة" }).isDisabled(), true);
    await rejectDialog.getByRole("checkbox", { name: "أؤكد مراجعة نص المسودة" }).click();
    await rejectDialog.getByRole("button", { name: "تأكيد قرار المسودة" }).click();
    await rejectExample.getByText("مرفوضة", { exact: true }).waitFor({ timeout: 10_000 });
    assert.deepEqual(approvalWrites, [], label + ": mock approval UI must never POST real decisions");
    await page.getByRole("button", { name: "إعادة ضبط المحاكاة" }).click();
    await example.getByRole("button", { name: "محاكاة اعتماد" }).waitFor({ timeout: 10_000 });
    await page.getByLabel("البحث في الموافقات").fill("نص غير موجود 8675309");
    await page.getByText("لا توجد مسودات تطابق البحث", { exact: false }).waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "إعادة ضبط الفلاتر" }).click();
    await page.getByRole("button", { name: "منتهية الصلاحية (1)" }).click();
    await page.getByTestId("approval-r5").getByText("منتهية الصلاحية", { exact: true }).waitFor({ timeout: 10_000 });
    assert.equal(await page.getByTestId("approval-r5").getByRole("button", { name: "محاكاة اعتماد" }).count(), 0,
      label + ": an expired draft must not be confirmable");

    // Navigate safely between reports and approval lists, without inventing draft-task relationships.
    if (width < 768) {
      await page.getByRole("button", { name: "فتح القائمة الرئيسية" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "التقارير والسجلات" }).click();
    } else {
      await page.getByRole("navigation", { name: "التنقل الرئيسي" })
        .getByRole("link", { name: "التقارير والسجلات" }).first().click();
    }
    const awaitingTask = page.getByTestId("task-detail-k2");
    await awaitingTask.locator("summary").click();
    await awaitingTask.getByRole("link", {
      name: "عرض جميع المسودات المعلقة (وليست بالضرورة مرتبطة بهذه المهمة)",
    }).click();
    await page.getByText("هذه القائمة لا تثبت أن أي مسودة مرتبطة بمهمة محددة", { exact: false })
      .waitFor({timeout:10_000});
    assert.equal(await page.getByRole("button", { name: "بانتظار المراجعة (2)" }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByTestId("approval-r3").count(), 0,
      label + ": pending list must not include approved draft");
    await page.getByRole("link", { name: "العودة إلى التقارير" }).click();

    // Notifications have genuine task IDs: open the precise record and nothing else.
    await page.getByRole("link", { name: "عرض المهمة المرتبطة بالتنبيه" }).click();
    await page.getByText("تم تحديد المهمة المرتبطة بالتنبيه", { exact: false })
      .waitFor({timeout:10_000});
    const linkedTask = page.getByTestId("task-detail-k3");
    await linkedTask.getByText("[محاكاة فقط] مثال على التقرير النهائي", { exact: false })
      .waitFor({timeout:10_000});
    await page.goto(base + "/reports?taskId=not-present", {waitUntil:"domcontentloaded"});
    await page.locator('[data-app-ready="true"]').waitFor({timeout:20_000});
    await page.getByText("لم تظهر المهمة المطلوبة ضمن أحدث السجلات", {exact:false})
      .waitFor({timeout:10_000});

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
