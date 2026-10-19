import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, signIn } from "@/lib/auth";
import { siteSubtitle, siteTitle } from "@/lib/site";

async function login(formData: FormData) {
  "use server";
  const name = String(formData.get("name") || "").trim();
  const code = String(formData.get("code") || "");
  // People sometimes type the access code into the name box — catch that instead of creating a user called "wedding2026".
  const codes = [process.env.ACCESS_CODE, process.env.ADMIN_CODE].filter(Boolean).map((c) => c!.toLowerCase());
  if (codes.includes(name.toLowerCase())) redirect(`/login?error=name`);
  const token = signIn(name, code);
  if (!token) redirect(`/login?error=code&name=${encodeURIComponent(name)}`);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  redirect("/");
}

const ERRORS: Record<string, string> = {
  code: "That access code isn't right. Check the message you were sent, or ask the couple.",
  name: "Please enter your own name in the first box — the access code goes in the second.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; name?: string }> }) {
  const { error, name } = await searchParams;
  const title = siteTitle();
  const subtitle = siteSubtitle();
  return (
    <main className="login">
      <form action={login} className="login-card">
        <div className="login-head">
          {subtitle && <p className="eyebrow">{subtitle}</p>}
          <h1 className="display">{title}</h1>
          <div className="ornament" aria-hidden>
            <svg width="9" height="9" viewBox="0 0 10 10"><path d="M5 0 6.2 3.8 10 5 6.2 6.2 5 10 3.8 6.2 0 5 3.8 3.8Z" fill="currentColor" /></svg>
          </div>
          <p>Sign in to view the photos and save your favourites.</p>
        </div>
        <label className="field">
          <span>Your name</span>
          <input
            name="name"
            required
            maxLength={40}
            autoComplete="name"
            placeholder="e.g. Anjali Menon"
            defaultValue={error === "code" ? name : undefined}
            autoFocus={!name}
          />
          <small>Shown next to the photos you pick.</small>
        </label>
        <label className="field">
          <span>Access code</span>
          <input name="code" type="password" required autoComplete="current-password" autoFocus={!!name} />
        </label>
        {error && ERRORS[error] && (
          <p className="form-error" role="alert">
            {ERRORS[error]}
          </p>
        )}
        <button type="submit" className="btn btn-primary">
          Continue
        </button>
        <p className="login-foot">Shared privately with family and friends.</p>
      </form>
    </main>
  );
}
