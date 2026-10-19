# Personal AI Workspace — Windows quick start

**Development works through Lovable + GitHub. These steps are for final testing on
your own Windows PC; you do NOT need to install anything merely to keep developing.**

## Requirements (free local software)

Install and start:
- Docker Desktop with WSL2 or a supported Docker Engine with Linux containers. Docker licensing conditions depend on use.
- Node.js 22+ and Bun (the project uses the Bun lockfile).
- Ollama for real local AI inference. Choose a model according to hardware: `ollama pull llama3.2` is an example, not mandatory.
- PowerShell 5.1+.

No paid cloud GPU, cloud database or browser-hosting service is needed.
You must trust the **local** dashboard at 127.0.0.1; the hosted Lovable preview
cannot use your private localhost credentials or access your PC browser by itself.

## فحص إعدادات Windows قبل بدء التشغيل

أُضيف فحص محلي للقراءة فقط يتم تشغيله تلقائيًا من `scripts/windows/start.ps1` **قبل تشغيل Docker أو Fastify**. يفحص تطابق رموز API وعامل المتصفح دون إظهارها، وتطابق بيانات PostgreSQL، وصحة روابط الخدمات المحلية وإعدادات CORS، ومنع استخدام وضع CI الذي يعطّل Sandbox في جلسة متصفح حقيقية.

يمكن إجراء الفحص بنفسك دون بدء خدمات أو تعديل ملفات:

```powershell
.\\scripts\\windows\\preflight.ps1
```

إذا ظهرت رسالة منع، يجب إصلاح الإعدادات محليًا دون نشر ملفات `.env` أو إرسال كلمات المرور. لن يُصلح الفحص الأسرار أو يستبدلها تلقائيًا.

## First run

Open PowerShell in the repository root (clone via GitHub or download the repository ZIP):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
```

This runs **once**. It checks for required programs, creates private local files,
generates three independent secrets (PostgreSQL password, API token, browser-worker
token) and a separate VNC password, and installs frontend/backend dependencies.
The setup refuses to overwrite any existing local config, avoiding lost sessions.
AI browser control is **OFF by default** (`BROWSER_ENABLE_READONLY_AGENT=false`);
manual browsing stays available. Enable AI later only after local sandbox testing
and explicit permission review.

Generated files (ignored by Git):
- `local/.env` — local DB password.
- `runtime/.env` — local runtime token, PostgreSQL URL and browser-worker token.
- `browser-worker/.env` — VNC password and browser-worker token, all agent permissions OFF by default.
- `.env.local` — frontend configured in real mode; it intentionally does NOT contain API tokens.

Start the system:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

The launcher starts local PostgreSQL and Chromium/noVNC containers, checks their
readiness **with Chromium sandbox enabled**, applies the 7 SQL migrations and
opens separate PowerShell windows for the API and web UI. It waits for the local Fastify/PostgreSQL and frontend health checks, and opens
`http://127.0.0.1:8080` **only after both are responding**. If either fails,
run `scripts/windows/diagnose.ps1` without sharing credentials.

Find `RUNTIME_TOKEN` inside `runtime/.env` **on your PC** and paste it in
**الإعدادات → رمز الخادم المحلي**. Do NOT paste that token in this chat, GitHub,
Lovable's hosted preview or any third-party URL.

Find the noVNC password in `browser-worker/.env` locally if requested.
Only access the local noVNC page at `http://127.0.0.1:6080/vnc.html`.

## فحص حالة الخدمات (من غير مشاركة أسرار)

من جذر المشروع افتح PowerShell وشغّل:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\diagnose.ps1
```

لو عايز فحص استدلال حقيقي باستخدام أول نموذج مثبت عندك، نفّذ الاختيار
التالي (يعمل على الكمبيوتر فقط ولا يرسل المحتوى لخدمة خارجية):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\diagnose.ps1 -TestInference
```

الفحص يطلب من Ollama محليًا ردًا قصيرًا، ويتحقق من اكتماله، لكن
لا يطبع النص الناتج. قد يحتاج بعض الوقت وفقًا لقدرة جهازك.

الفحص يعرض إذا كانت قاعدة PostgreSQL وFastify وChromium وnoVNC وOllama
موجودة وتستجيب، ولا يغيّر حالة التحكم أو يسحب أي معلومات من الحسابات،
ولا يطبع كلمات المرور أو رموز الوصول. يظل تشغيل Ollama بنموذج حقيقي
والتحكم بمتصفح المستخدم بحاجة إلى اختبار فعلي على Windows.

إذا تعطل تثبيت التبعيات أثناء `setup.ps1` بعد إنشاء ملفات `.env`،
**لا تحذف ملفات الإعداد القديمة ولا تعيد إنشاءها**؛ من جذر المشروع
شغّل `bun install --frozen-lockfile` ثم `cd runtime; npm ci`، وبعد
نجاحهما شغّل `start.ps1` من جذر المشروع. ملفات الإعداد تحتوي أسرار
المستخدم ولا يجب إرسالها للمطور أو رفعها إلى GitHub.

## تشفير نسخ PostgreSQL واستعادتها

بعد تشغيل النظام تستطيع إنشاء نسخة محلية مشفّرة دون حفظ كلمة مرور في
الملفات أو إرسالها إلى أي خدمة:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\backup.ps1
```

النسخة تُحفظ افتراضيًا في `%USERPROFILE%\PAW-Backups` بامتداد
`.pawbak`، وتتطلب عبارة مرور لا تقل عن 16 حرفًا.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\restore.ps1 -InputPath "D:\PrivateBackups\my-workspace.pawbak"
```

للتأكد من سلامة النسخة **من غير استعادة** أضف `-VerifyOnly` للأمر:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\restore.ps1 -InputPath "D:\PrivateBackups\my-workspace.pawbak" -VerifyOnly
```

الاستعادة تتحقق من سلامة النسخة، ثم تنشئ قاعدة منفصلة للاختبار ولا
تستبدل قاعدة `paw`. في اختبارات GitHub نجح النسخ والاسترجاع باستخدام
بيانات PostgreSQL تجريبية، وليس بيانات المستخدم الفعلية.

للتفاصيل وحدود الخصوصية اقرأ [دليل النسخ المشفّر](BACKUP_AND_RESTORE.md).
هذه النسخة تشمل البيانات الموجودة في PostgreSQL فقط ولا تتضمن كوكيز
المتصفح أو Docker Volumes أو إعدادات Ollama.

## النسخ التلقائي المشفّر (اختياري)

يدعم Windows الآن إنشاء نسخة PostgreSQL مشفرة يوميًا، باستخدام
Windows Task Scheduler مع تشفير DPAPI المرتبط بحساب Windows الخاص بك.
لا توجد مهمة مجدولة ما لم تُفعّلها بنفسك، ولا تُحذف ملفات النسخ
القديمة تلقائيًا.

```powershell
# تفعيل نسخة يومية عند الساعة الثالثة صباحًا
.\scripts\windows\scheduled-backup.ps1 -Enable -Hour 3 -Minute 0

# فحص حالة المهمة ونتيجة آخر تشغيل
.\scripts\windows\scheduled-backup.ps1 -Status

# إيقاف الجدولة دون حذف النسخ السابقة
.\scripts\windows\scheduled-backup.ps1 -Disable
```

يلزم أن تكون مسجّل الدخول إلى حساب Windows نفسه وقت عمل المهمة.
عند التفعيل تختار عبارة مرور لا تقل عن 16 حرفًا، ويجب حفظها في مدير
كلمات مرور مستقل حتى تتمكن من استرجاع النسخ على كمبيوتر آخر إذا فقدت
جهازك أو حساب Windows. DPAPI **لا يُغني عن حفظ عبارة الاسترجاع**.

لا يتم نسخ كوكيز Chromium أو مفاتيح الخدمات ولا رفع الملفات تلقائيًا
إلى السحابة. راجع [الدليل التفصيلي للنسخ المشفر](BACKUP_AND_RESTORE.md).

## نسخة مشفّرة منفصلة لجلسات Chromium (اختيارية)

بسبب حساسية كوكيز تسجيل الدخول، **لا تدخل جلسات Chromium ضمن نسخ
PostgreSQL اليومية**. أوقف حاوية المتصفح بنفسك أولًا، وبعدها اختر:

```powershell
docker compose -f compose.browser.yml stop browser-worker
.\scripts\windows\browser-profile.ps1 -Backup
```

للتأكد من سلامة الأرشيف فقط استخدم `-Verify -InputPath`،
وللاستعادة الآمنة إلى Docker Volume جديد **غير متصل بالمتصفح الأساسي**
استخدم `-Restore -InputPath`. السكربت لا يسمح بنسخ متصفح نشط،
ولا باستبدال جلساتك الحالية أو رفع الكوكيز إلى GitHub.

انظر [الدليل الأمني المنفصل لجلسات Chromium](CHROMIUM_PROFILE_BACKUPS.md)
للتفاصيل والتحذيرات.

## Browser permissions and privacy

The browser uses a Docker volume to keep session profiles across container
restarts. Browser storage may contain login cookies and is **not automatically
encrypted at rest**; secure your computer with full-disk encryption, strong login
and access controls. Do not upload Docker volumes or .env files to GitHub.

By default the agent has no site permissions. If you later opt in to a
read-only review, you must register and approve the domain in the Accounts
screen **and** explicitly configure the browser-worker local domain allowlist.
No auto-publishing, sending, account modification or unrestricted AI browsing
has been enabled.

The CI test that reports successful Chrome/noVNC startup uses a temporary
offline-only Chromium configuration because GitHub runner's AppArmor restrictions
block the production sandbox. **The Windows launcher does NOT use that CI-only
override.** If the browser fails with `No usable sandbox`, do not disable its
sandbox for real websites. Configure a supported isolated environment and
retest before signing into accounts.

## Shutdown without losing data

Close the two PowerShell windows opened by `start.ps1`.
Optionally stop Docker containers from the repository root:

```powershell
docker compose --env-file local/.env -f compose.database.yml stop
docker compose -f compose.browser.yml stop
```

Stopping containers preserves the PostgreSQL and Chromium volumes. **Do not run
`docker compose down -v` on your personal installation**, as it deletes their
volumes and can destroy database records and browser sessions.

## Verification limits

GitHub Actions checks the frontend, runtime, SQL migrations, domain policies and
a throwaway browser container. The full boundary test uses a **fake local Ollama
HTTP fixture**, not actual AI inference or real user credentials.

A true production-ready claim still requires successful Windows execution,
Ollama local model inference, genuine noVNC user input handoff with sandbox on,
profile persistence across restart, encrypted backups and user-authorized
integration checks.
