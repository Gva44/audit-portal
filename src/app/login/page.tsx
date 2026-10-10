import { Suspense } from "react";
import LoginForm from "./LoginForm";

// Evaluated per request so the Google button only shows once OAuth is actually configured.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-4"
      style={{
        backgroundImage:
          "radial-gradient(60% 50% at 50% 0%, var(--accent-soft) 0%, transparent 100%)",
      }}
    >
      <Suspense fallback={null}>
        <LoginForm googleEnabled={googleEnabled} />
      </Suspense>
    </div>
  );
}
