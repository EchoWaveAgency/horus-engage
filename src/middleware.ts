import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the staff session; /app needs a signed-in user (the database enforces every permission).
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new NextResponse("Supabase environment variables are not configured.", { status: 503 });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (list) => { list.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request });
      list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
  } });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && request.nextUrl.pathname.startsWith("/app")) {
    const to = request.nextUrl.clone(); to.pathname = "/login"; to.search = ""; return NextResponse.redirect(to);
  }
  return response;
}
export const config = { matcher: ["/", "/app/:path*", "/login"] };
