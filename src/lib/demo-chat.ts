/**
 * Deterministic frontend-only demo replies for the Lovable UI preview.
 * Never perform a request, simulate model inference, or claim to see accounts.
 * Don't repeat user input in the simulated assistant response.
 */
export function demoChatReply(input: string): string {
  const question = input.trim().toLocaleLowerCase("ar");
  const intro = "🧪 محاكاة للواجهة فقط — هذا رد ثابت، وليس من Ollama أو من حساباتك.\n\n";
  if (/رسائ|واتساب|whatsapp|البريد|email|inbox/i.test(question)) {
    return intro + "عند تشغيل النظام محليًا وتفويض القراءة صراحةً، يمكن للمساعد إعداد مسودة تلخيص للرسائل المتاحة. في هذه المعاينة لا توجد رسائل فعلية ولا اتصال بأي حساب.";
  }
  if (/متصفح|موقع|صفحة|browser|web|فيسبوك|instagram|انستجرام/i.test(question)) {
    return intro + "في النسخة المحلية يظهر Chromium عبر noVNC. أنت تختار الصفحة وتسمح للمساعد بمراجعتها للقراءة فقط، ولن تُنشر تعليقات أو رسائل تلقائيًا.";
  }
  if (/حفظ|نسخ|backup|بيانات|ذاكرة|تخزين/i.test(question)) {
    return intro + "النسخة المحلية تحفظ المحادثات والذاكرة في PostgreSQL وتدعم إنشاء نسخة احتياطية مشفّرة. بيانات هذه المعاينة مؤقتة ولا تمثل نسخًا محفوظة.";
  }
  return intro + "يمكنك تجربة الفقاعات واتجاه الكتابة وتخطيط المحادثة هنا. للحصول على رد فعلي من نموذج ذكاء اصطناعي، شغّل Ollama والخدمات على الكمبيوتر من النسخة المحلية.";
}
