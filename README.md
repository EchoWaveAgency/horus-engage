# HORUS Engage

**ردود تلقائية ذكية + كول سنتر لكل عملاء EchoWave — واتساب · ماسنجر · إنستجرام · الكومنتات**
Automated, on-brand replies with a human handoff for every EchoWave client — WhatsApp · Messenger · Instagram · comments.

## إيه اللي بيعمله / What it does
| | العربي | English |
|---|---|---|
| أول رسالة | ترحيب باسم العميل، ولو جاي من إعلان بكود الحملة (GF26-LASER) يفتح الخدمة مباشرة | Greets by name; a campaign code from a Click-to-WhatsApp ad opens that service directly |
| الخدمات | قائمة أزرار، وكارت لكل خدمة من النصوص المعتمدة فقط (وصف، عرض، سعر، مدة) | Button menu; each service card uses only the client's approved text |
| الحجز | يوم ← وقت ← (رقم الموبايل في ماسنجر/إنستجرام) ← طلب حجز يتبعت لنظام العميل | Day → time → (mobile on Messenger/Instagram) → booking request sent to the client's system |
| التحويل لموظف | لو طلب موظف، سؤال طبي، شكوى، سعر مش معتمد، صوت/صورة، أو مفهمش مرتين — البوت يسكت والموظفة تكمّل | On request, medical questions, complaints, no approved price, voice/images, or two misunderstood messages — the bot goes quiet and a person continues |
| الكومنتات | استفسار ← رد علني متنوع + رسالة خاصة بالقائمة · سبام/إساءة ← إخفاء · شكوى ← اعتذار + رسالة خاصة + موظف · إيجابي ← شكر | Inquiry → varied public reply + private DM with the menu · spam/abuse → hidden · complaint → apology + DM + a person · positive → thanks |
| الذكاء الاصطناعي | اختياري: Claude يفهم الكلام الحر ويختار من ردود العميل المعتمدة فقط | Optional: Claude reads free text and only picks from approved answers |
| متعدد العملاء | كل عميل بقنواته وخدماته وفريقه، وعزل كامل بين العملاء | Each client has its own channels, services and team, fully isolated |

Screens: inbox (needs a person / with the bot / mine / closed), conversation with take-over / hand back / reply, comments queue, services & answers, settings, channels, reports.

## إعداد Meta (مرة واحدة لـEchoWave) / Meta setup (once, for EchoWave)
1. **Meta app** (Business type) with products **WhatsApp**, **Messenger**, **Instagram**. App Review permissions: `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement` (comment replies / hide), `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`. Business verification is required for live use.
2. **Webhook**: Callback URL `https://<engage-domain>/api/webhooks/meta`, Verify token = `META_VERIFY_TOKEN`. Subscribe: WhatsApp → `messages`; Page → `messages`, `messaging_postbacks`, `message_echoes`, `feed`; Instagram → `messages`, `comments`.
3. **Per client**: subscribe the app to the client's Page / WhatsApp Business Account, then in **Channels** add the WhatsApp `phone_number_id`, the Page id and the Instagram account id with a **System User** token (permanent).
4. **Ads**: put the campaign code in each Click-to-WhatsApp / Click-to-Messenger ad's pre-filled message (e.g. `GF26-LASER — أريد تفاصيل العرض`).

## Client system integration (e.g. Golden Care OS)
In **Settings**: receiving URL (Golden Care: `https://<golden-care-domain>/api/integrations/engage`). The owner copies the signing secret into the client system (Golden Care: `ENGAGE_SECRET`). Events `lead`, `booking_request`, `handoff` are POSTed signed (`X-Engage-Signature: sha256=…`), retried with back-off, and the returned `{ "ref" }` (Golden Care lead id) is shown on the booking.

## Run / التشغيل
```bash
npm install
npm run stack:local && npm run demo:data     # local only; prints demo logins
npm run build && npx next start -p 3200
node e2e/engage-journey.mjs                  # needs Golden Care OS running on :3100 for the integration checks
```
Production: a new Supabase project → `supabase db push` (migrations in `supabase/migrations`), deploy to Vercel with `.env.example` variables, cron every minute on `/api/jobs/dispatch`.

## Verified
SQL suite + concurrency (10 simultaneous first messages → 1 conversation; 6 parallel bot steps → 1 applied) · unit 31 · end to end 24/24 across Engage and Golden Care OS (signed webhooks, booking → Golden Care lead `GF26-…`, handoff, agent reply, comments, isolation, reports).
