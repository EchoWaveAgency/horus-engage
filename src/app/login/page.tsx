import { signIn } from "@/app/actions/auth";
export const metadata = { title: "Sign in" };
export default function Login({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form action={signIn} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-300">EchoWave · HORUS</p>
          <h1 className="mt-1 text-2xl font-semibold">HORUS Engage</h1>
          <p className="muted text-sm">واتساب · ماسنجر · إنستجرام · الكومنتات</p>
        </div>
        {searchParams.error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">البريد أو كلمة المرور غير صحيحة / Wrong email or password</p>}
        <label className="block"><span className="label">البريد / Email</span><input id="email" name="email" type="email" required className="input num" /></label>
        <label className="block"><span className="label">كلمة المرور / Password</span><input id="password" name="password" type="password" required className="input" /></label>
        <button className="btn-gold w-full">دخول / Sign in</button>
      </form>
    </main>
  );
}
