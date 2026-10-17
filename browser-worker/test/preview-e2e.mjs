/**
 * Real browser smoke: a truthful EMPTY Lovable cloud preview.
 * No fake tabs, users, tasks, logs, messages or pretend AI actions.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base=process.env.PAW_PREVIEW_URL??"http://127.0.0.1:8080";
const browser=await chromium.launch({headless:true,chromiumSandbox:false,args:["--disable-dev-shm-usage"]});
async function verify(label,width,height) {
  const context=await browser.newContext({viewport:{width,height},locale:"ar-SA"});
  const page=await context.newPage();
  const jsErrors=[];
  const writes=[];
  page.on("pageerror",e=>jsErrors.push(e.message));
  page.on("request",req=>{if(req.method()!=="GET")writes.push(req.url());});
  try {
    await page.goto(base,{waitUntil:"domcontentloaded",timeout:45000});
    await page.locator('[data-app-ready="true"]').waitFor({timeout:25000});
    await page.getByRole("heading",{name:"المتصفح الذكي"}).last().waitFor({timeout:15000});
    assert.equal(await page.locator("html").getAttribute("dir"),"rtl");
    await page.getByText("لا توجد تبويبات متصلة").waitFor({timeout:15000});
    await page.getByText("المتصفح غير متصل في المعاينة").waitFor({timeout:15000});
    await page.getByText("إرسال الرسائل، الضغط على أزرار التنفيذ، الدفع والحذف غير مدعوم تلقائيًا",{exact:false}).waitFor({timeout:15000});
    assert.ok(await page.getByLabel("عنوان الموقع").isDisabled(),label+": no fake navigation");
    assert.ok(await page.getByLabel("تبويب جديد").isDisabled(),label+": no imaginary tabs");
    assert.ok(await page.locator("#browser-instruction").isDisabled(),label+": no imaginary assistant reply");
    assert.ok(await page.getByRole("button",{name:"ابدأ المهمة في هذا التاب"}).isDisabled(),label+": no pretend AI");
    for(const forbidden of ["WhatsApp Web","فيسبوك — صفحة افتراضية","محاكاة للواجهة فقط","تلخيص الرسائل غير المقروءة"]) {
      assert.equal(await page.getByText(forbidden,{exact:true}).count(),0,label+": no fake "+forbidden);
    }

    if(width<768) {
      await page.getByRole("button",{name:"فتح القائمة الرئيسية"}).click();
      await page.getByRole("dialog").getByRole("link",{name:"سجل المهام"}).click();
    } else {
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("link",{name:"سجل المهام"}).click();
    }
    await page.getByText("لا توجد مهام مسجّلة في هذه المساحة.",{exact:false}).waitFor({timeout:15000});
    await page.getByText("لا توجد إشعارات بعد",{exact:false}).waitFor({timeout:15000});

    if(width<768) {
      await page.getByRole("button",{name:"فتح القائمة الرئيسية"}).click();
      await page.getByRole("dialog").getByRole("link",{name:"الإعدادات"}).click();
    } else {
      await page.getByRole("navigation",{name:"التنقل الرئيسي"}).getByRole("link",{name:"الإعدادات"}).click();
    }
    await page.getByText("تفويض الخادم المحلي").first().waitFor({timeout:15000});
    assert.ok(await page.getByLabel("رمز الاتصال المحلي").isDisabled(),label+": hosted token remains disabled");
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}));
    assert.ok(sizes.scroll<=sizes.width+2,label+": horizontal overflow "+JSON.stringify(sizes));
    assert.deepEqual(writes,[],label+": must not create or send fake requests");
    assert.deepEqual(jsErrors,[],label+": no JS errors");
    console.log("PASS "+label+": empty real-state browser, no fake actions, nav, RTL, token safety");
  } finally {await context.close();}
}
try {
  await verify("mobile 390px",390,844);
  await verify("desktop 1440px",1440,900);
} finally {await browser.close();}
