// Text understanding by rules (Egyptian Arabic + English). Pure; unit-tested.

/** Lower case, Arabic letter variants folded, diacritics / tatweel removed, Arabic digits → Western, spaces squeezed. */
export function norm(t: string): string {
  return (t ?? "")
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}\s?؟-]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

export type Intent = "human" | "emergency" | "medication" | "book" | "price" | "duration" | "location" | "hours" | "medical" | "complaint" | "thanks" | "greeting" | "menu" | "yes" | "no";

// Order matters: safety / people first.
const RULES: [Intent, RegExp][] = [
  ["human", /(موظف|حد يكلمني|حد يرد|عايز اكلم|عاوز اكلم|اكلم حد|كلموني|كلمني|اتصلوا|اتصل بي|خدمه العملاء|customer service|\bagent\b|\bhuman\b|call me|real person|representative)/],
  // (JavaScript's \b does not work between Arabic letters: whole Arabic words use (?:^|\s) … (?=\s|$).)
  ["complaint", /(شكوي|شكوه|سيي|(?:^|\s)وحش(?:ه)?(?=\s|$)|نصب|نصاب|اتنصب|مستاء|زعلان|مشكله(?! جلدي)|اسوا|complain|bad experience|terrible|scam|\brefund\b|فلوسي|ضحك علي)/],
  // Symptoms / conditions / medicines → a person. ("Does it hurt?" is a procedure question with an approved FAQ, not a symptom.)
  // Emergencies: the bot tells the customer to go to the nearest emergency room and hands over at once.
  ["emergency", /(نزيف|مش (قادر|قادره|عارف|عارفه) اتنفس|ضيق (في )?(ال)?تنفس|اغماء|اغمي|(?:^|\s)حادثه(?=\s|$)|طواري|وجع (شديد|جامد)|الم (شديد|جامد)|can ?t breathe|cannot breathe|unconscious|fainted|accident|emergency|severe pain|heavy bleeding)/],
  // Questions only a doctor may answer: which medicine, what dose, what treatment, a diagnosis.
  ["medication", /((?:^|\s)(ال)?دوا(?=\s|$)|ادويه|(?:^|\s)(ال)?علاج(?=\s|$)|جرعه|تشخيص|اخد ايه|اخد اي(?=\s|$)|medication|medicine|\bdose|dosage|diagnos|prescri)/],
  ["medical", /(حامل|(?:^|\s)حمل(?=\s|$)|رضاعه|حساسيه|مرض|سكري|(?:^|\s)سكر(?=\s|$)|ضغط|التهاب|(?:^|\s)الم(?=\s|$)|عندي وجع|وجعني|نزيف|حرق|ورم|اعراض|pregnan|allerg|\bpain\b|diabet|bleed|\bburn|disease|symptom|infection)/],
  ["book", /(احجز|حجز|موعد|ميعاد|معاد|\bbook|appointment|reserv)/],
  ["price", /(بكام|السعر|سعر|اسعار|تكلف|الحساب كام|\bprice|\bcost|how much|\bfees?\b)/],
  ["duration", /(المده|مده|بتاخد قد ايه|قد ايه وقت|كام جلسه|عدد الجلسات|duration|how long|how many sessions)/],
  ["location", /(العنوان|فين|مكانكم|لوكيشن|location|address|where are you)/],
  ["hours", /(مواعيد العمل|بتفتحوا|بتقفلوا|شغالين لحد|opening hours|working hours|open today)/],
  ["menu", /^(القائمه|قائمه|الخدمات|رجوع|منيو|ابدا|البدايه|menu|services|back|start|0)$/],
  ["thanks", /(شكرا|متشكر|تسلم|ميرسي|ربنا يخليك|thank|thx)/],
  ["greeting", /^(السلام عليكم|سلام|اهلا|هاي|هالو|مرحبا|صباح الخير|مساء الخير|hello|hi|hey|good (morning|evening))\b/],
  ["yes", /^(اه|ايوه|ايوا|نعم|تمام|اوك|موافق|yes|yeah|ok|okay|sure)$/],
  ["no", /^(لا|لاء|مش عايز|no|nope)$/],
];

export function intents(text: string): Intent[] {
  const t = norm(text);
  return RULES.filter(([, re]) => re.test(t)).map(([i]) => i);
}

/** Campaign code anywhere in the text: GF26-LASER, gf26 laser, D1… → upper form, or null. */
export function campaignCode(text: string, known: string[]): string | null {
  const t = (text ?? "").toUpperCase().replace(/[\s_]+/g, "-");
  const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Whole tokens only, so a short ad code like "D1" never matches inside "SD10" or a phone number.
  return [...known].sort((a, b) => b.length - a.length).find((c) => new RegExp(`(^|[^A-Z0-9])${esc(c)}($|[^A-Z0-9])`).test(t)) ?? null;
}

/** Egyptian-first phone to E.164; null when it cannot be a number. Mirrors app.normalize_phone. */
export function normalizePhone(s: string): string | null {
  let d = (s ?? "").replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("01")) return "+2" + d;
  if (d.length === 12 && d.startsWith("201")) return "+" + d;
  if (d.length >= 8 && d.length <= 15 && !d.startsWith("0")) return "+" + d;
  return null;
}

export const isArabic = (t: string) => /[؀-ۿ]/.test(t);

// ---------------------------------------------------------------- Comments

export type CommentClass = "inquiry" | "price" | "positive" | "complaint" | "spam" | "abuse" | "other";

const ABUSE = /(حمار|كلب|زباله|زبال|حرامي|حراميه|نصابين|يلعن|\bidiot|stupid|fuck|shit|bitch)/;
const SPAM = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|bit\.ly|تابعني|تابعوني|follow me|check my (page|profile)|دخل علي البروفايل|اربح|ربح يومي|استثمار مضمون|crypto|bitcoin|forex|\bdm me\b)/;
const POSITIVE = /(جميل|رائع|تحفه|ممتاز|احسن|حلو|ربنا يوفق|بالتوفيق|برافو|❤|♥|😍|👍|👏|🔥|great|amazing|awesome|love|beautiful|excellent)/;
const INQUIRY = /(تفاصيل|التفاصيل|ازاي|ممكن|عايز|عاوزه|عايزه|عاوز|فين|متاح|موجود|ينفع|استفسار|details|info|interested|available|\?|؟|اشترك|حجز|احجز)/;

/** Rule-based class; the language model may refine "other" when enabled. Mentions alone ("@sara") are "other". */
export function classifyComment(raw: string): CommentClass {
  const original = raw ?? "";
  const t = norm(original);
  if (SPAM.test(original.toLowerCase()) || SPAM.test(t)) return "spam";
  if (ABUSE.test(t)) return "abuse";
  if (RULES.find(([i]) => i === "complaint")![1].test(t)) return "complaint";
  if (RULES.find(([i]) => i === "price")![1].test(t)) return "price";
  if (INQUIRY.test(t) || /[?؟]/.test(original)) return "inquiry";
  if (POSITIVE.test(t) || POSITIVE.test(original)) return "positive";
  if (/^(@\S+\s*)+$/.test(original.trim()) || t.length === 0) return "other";
  return t.split(" ").length <= 2 ? "inquiry" : "other";   // "ليزر", "سعر؟", "تم" → treat short ones as interest
}
