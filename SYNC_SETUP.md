# إعداد المزامنة الموثوقة كل 30 دقيقة (Vercel Cron → GitHub Actions)

## الفكرة

جدولة GitHub Actions (`schedule`) غير مضمونة التوقيت ولوحظ تأخيرها ساعات.
الحل: **Vercel Cron** يستدعي دالة صغيرة `api/dispatch-sync.ts` كل 30 دقيقة،
وهذه الدالة تُطلق الـ workflow `odoo-sync.yml` فورياً عبر GitHub API
(`workflow_dispatch`). جدولة GitHub داخل الـ workflow تبقى كاحتياط فقط.

المسار الكامل:

```
Vercel Cron (كل 30 دقيقة)
  → POST https://pulsestock-eight.vercel.app/api/dispatch-sync
    (ترويسة Authorization: Bearer <CRON_SECRET> تُرسل تلقائياً)
  → الدالة تتحقق من السر ثم تستدعي GitHub API:
    POST /repos/MohanadFalih/pulsestock/actions/workflows/odoo-sync.yml/dispatches
  → الـ workflow يشغّل scripts/odoo_sync.py ويدفع live.json المحدّث
  → الـ commit يطلق إعادة نشر Vercel → البيانات الجديدة تظهر في اللوحة
```

## الخطوة 1 — إنشاء GitHub Personal Access Token

1. افتح GitHub → صورتك أعلى اليمين → **Settings**.
2. من القائمة الجانبية أسفل الصفحة: **Developer settings**.
3. **Personal access tokens → Tokens (classic)** → **Generate new token (classic)**.
4. الاسم: مثلاً `pulsestock-sync-dispatch`، ومدة الصلاحية حسب رغبتك
   (يُفضّل No expiration أو سنة مع تذكير بالتجديد).
5. فعّل صلاحية **`repo`** كاملة (المستودع private، وهي كافية لإطلاق
   workflow_dispatch).
6. **Generate token** وانسخ الرمز فوراً (`ghp_...`) — لن يظهر مرة أخرى.

## الخطوة 2 — إضافة متغيرات البيئة في Vercel

افتح مشروع Vercel → **Settings → Environment Variables** وأضف:

| الاسم | القيمة | البيئات |
|---|---|---|
| `GH_SYNC_TOKEN` | رمز GitHub من الخطوة 1 | Production (وPreview إن رغبت) |
| `CRON_SECRET` | أي سلسلة عشوائية قوية، مثلاً ناتج `openssl rand -hex 32` | Production |

> `CRON_SECRET` هو ما يمنع أي شخص من استدعاء الدالة وإطلاق مزامنات عشوائية.
> عند ضبطه، يرسل Vercel Cron ترويسة `Authorization: Bearer <CRON_SECRET>`
> تلقائياً مع كل استدعاء، والدالة ترفض (401) أي طلب بدونه.

## الخطوة 3 — النشر

ادفع التغييرات إلى `main` (أو `vercel deploy`)، وستلتقط Vercel تلقائياً:

- الدالة `api/dispatch-sync.ts`
- تعريف الـ cron في `vercel.json`:
  `"crons": [{ "path": "/api/dispatch-sync", "schedule": "*/30 * * * *" }]`

### ملاحظة مهمة عن خطة Vercel

- جدولة كل 30 دقيقة (`*/30 * * * *`) تتطلب **خطة Vercel Pro** (مدفوعة).
- الخطة المجانية **Hobby** تسمح بتشغيل الـ cron **مرة واحدة يومياً كحد أقصى**
  وقد **ترفض النشر** عند وجود جدولة أكثر تكراراً.

### البديل المجاني (بدون خطة Pro)

إن لم تكن على خطة Pro، احذف كتلة `crons` من `vercel.json` (أو اتركها وانشر
على Pro)، واستخدم خدمة [cron-job.org](https://cron-job.org) المجانية:

1. أنشئ حساباً ثم **Create cronjob**.
2. **URL**: `https://pulsestock-eight.vercel.app/api/dispatch-sync`
3. **Schedule**: كل 30 دقيقة (`*/30 * * * *`).
4. في **Advanced → HTTP headers** أضف:
   `Authorization: Bearer <نفس قيمة CRON_SECRET>`
5. احفظ وفعّل المهمة — ستحصل على نفس السلوك تماماً.

## الخطوة 4 — التحقق بعد النشر

1. **فحص الحماية**: نفّذ
   `curl -i https://pulsestock-eight.vercel.app/api/dispatch-sync`
   يجب أن يرجع `401` و`{"ok":false,"error":"unauthorized"}`.
2. **فحص الإطلاق اليدوي**: نفّذ
   `curl -i -X GET https://pulsestock-eight.vercel.app/api/dispatch-sync -H "Authorization: Bearer <CRON_SECRET>"`
   يجب أن يرجع `200` و`{"ok":true,"dispatchedAt":"..."}`.
3. **تأكد من الـ workflow**: افتح GitHub → تبويب **Actions** → سترى تشغيلاً
   جديداً لـ `Odoo sync` بدأ خلال ثوانٍ (الحدث: `workflow_dispatch`).
4. **تأكد من الـ cron**: في Vercel → المشروع → **Settings → Cron Jobs**
   ستظهر المهمة `/api/dispatch-sync` وموعد التشغيل القادم، ومن تبويب
   **Logs** يمكنك مراجعة نتيجة كل استدعاء.
5. بعد اكتمال الـ workflow، تأكد أن commit جديداً حدّث
   `public/data/live.json` وأن اللوحة تعرض وقت مزامنة حديثاً.
