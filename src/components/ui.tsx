"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";

export function Submit({ children, className = "btn-gold", confirm, name, value }: { children: React.ReactNode; className?: string; confirm?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" name={name} value={value} className={className} disabled={pending} aria-busy={pending}
    onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>{pending ? "…" : children}</button>;
}

/** Keeps inbox pages live: refresh every N seconds unless the user is typing. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      const a = document.activeElement;
      if (document.hidden || (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName))) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
