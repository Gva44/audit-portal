import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background px-4"
      style={{
        backgroundImage:
          "radial-gradient(60% 50% at 50% 0%, var(--accent-soft) 0%, transparent 100%)",
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
