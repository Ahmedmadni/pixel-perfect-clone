# Personal AI Workspace — مساحة المساعد الشخصي

مشروع مساعد شخصي **محلي أولًا** بواجهة عربية RTL، مخصص لتشغيل متصفح
Chromium حقيقي مرئي، وتسليم التحكم بين المستخدم والمساعد وفق صلاحيات صريحة،
وإعداد تقارير من صفحات مصرح بمراجعتها باستخدام Ollama محلي.

المشروع مرتبط بـ[Lovable](https://lovable.dev/projects/d8eb5115-13ea-4fc2-9819-de495b7a7f34)
ويُطوَّر عبر مستودع GitHub الحالي.

## حالة التنفيذ

- واجهة التحكم وصفحات المتصفح والذاكرة والمحادثة والموافقات والصلاحيات.
- Fastify مع مصادقة محلية وPostgreSQL وإصدارات للذاكرة وسجل للمهام.
- Chromium + Playwright + noVNC داخل حاوية Docker محلية ذات ملف تصفح مستمر.
- محادثة Ollama المحلية تدعم عرض الرد تدريجيًا وحفظ المحادثات.
- مراجعة تبويب واحد للقراءة فقط بطلب المستخدم، وإعداد تقرير دون أي نشر أو إرسال.
- الصلاحيات تبدأ بالمنع، والموافقات على المسودات **لا تنفذ أي إجراء خارجي**.

## نتائج الاختبارات

اختبارات GitHub Actions شملت واجهة React وFastify وPostgreSQL 16 الحقيقي
وحاوية Chromium/noVNC كاملة مع **خادم Ollama تجريبي**. تشغيل الجهاز الشخصي
ونموذج Ollama الحقيقي وتسجيل الدخول إلى المواقع وحفظ الجلسات بين مرات إعادة
التشغيل **لم تُعتمد بعد**.

- [فحوص الكود وقاعدة البيانات](https://github.com/Ahmedmadni/pixel-perfect-clone/actions/workflows/verify.yml)
- [اختبارات المتصفح والتكامل](https://github.com/Ahmedmadni/pixel-perfect-clone/actions/workflows/browser-smoke.yml)
- [حالة التطوير التفصيلية](docs/DEVELOPMENT_STATUS.md)

## طريقة التشغيل

لا حاجة لتثبيت البرامج على الكمبيوتر لمواصلة التطوير على GitHub وLovable.
للتشغيل الحقيقي على Windows لاحقًا، راجع
[دليل الإعداد السريع](docs/WINDOWS_QUICKSTART.md).

بعد تثبيت البرامج المجانية المطلوبة، ابدأ من جذر المستودع في PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\start.ps1
```

الأمر الأول ينشئ أسرار الإعداد محليًا مرة واحدة، والثاني يبدأ الخدمات.
**لم تُجرّب هاتان الخطوتان على جهاز Windows الحقيقي بعد**؛ سلوكهما يُراجع
حاليًا بواسطة فحوص صياغة PowerShell وDocker Compose السحابية.

## النسخ الاحتياطي

أُضيف مسار نسخ احتياطي **مشفّر AES-256-GCM** لقاعدة PostgreSQL،
باستخدام كلمة مرور يُدخلها المستخدم محليًا. النسخة لا تُحفظ في
GitHub، والاستعادة تتم في قاعدة جديدة حتى لا تُمس البيانات الأصلية.

- [دليل النسخ المشفر والاستعادة](docs/BACKUP_AND_RESTORE.md)
- [أوامر تشغيل Windows](docs/WINDOWS_QUICKSTART.md)
- [اختبار التشفير ونسخ/استرجاع PostgreSQL الحقيقي على GitHub](https://github.com/Ahmedmadni/pixel-perfect-clone/actions/runs/38883955794)

لا يشمل هذا الأرشيف كوكيز المتصفح أو ملفات `.env` أو نماذج Ollama،
ولا يوجد حتى الآن جدولة تلقائية للنسخ أو واجهة HTTP تستقبل كلمة المرور.

### جدولة نسخ يومية اختيارية

على Windows يمكن تفعيل النسخ المشفّر باستخدام
`scripts/windows/scheduled-backup.ps1 -Enable` بعد الإعداد المحلي؛
لا يُسجّل أي جدول تلقائيًا، وتُحمى عبارة المرور باستخدام DPAPI لحساب
Windows، ولا تُحذف النسخ السابقة تلقائيًا. التفاصيل في
[دليل النسخ والاستعادة](docs/BACKUP_AND_RESTORE.md).

## الخصوصية والأمان

- لا تُضع رمز `RUNTIME_TOKEN` أو ملفات `.env` أو كوكيز المتصفح على GitHub أو Lovable.
- عرض Lovable السحابي يُستخدم للتطوير/المعاينة، ولا يحصل تلقائيًا على متصفح الجهاز أو رموزه.
- جميع المنافذ المحلية مربوطة بـ`127.0.0.1`.
- لا تُفعّل تجاوز Sandbox المتصفح لتصفح الحسابات الحقيقية.
- وضع التشغيل المعتمد حاليًا: **مراجعة للقراءة فقط**؛ لا يوجد منفّذ لنشر المنشورات أو إرسال الرسائل.

التعليمات الفنية: [API](docs/API.md) · [الإعداد المفصل](docs/LOCAL_SETUP.md) ·
[خطة تطوير GitHub/Lovable](docs/CLOUD_DEVELOPMENT.md)
