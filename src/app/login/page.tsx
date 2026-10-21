import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import LoginForm from "./LoginForm";

// Evaluated per request so the Google button only shows once OAuth is actually configured.
export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "Upload your documents",
    body: "Add policies and evidence once, per client or shared across all clients.",
  },
  {
    title: "Check each question",
    body: "Every question is matched to your policies and compared with the client's earlier answers.",
  },
  {
    title: "Review, score and export",
    body: "Each answer gets a 0–10 readiness score. Review, then export the client file.",
  },
];

export default function LoginPage() {
  const googleEnabled = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  return (
    <div className="flex min-h-dvh flex-wrap bg-background lg:h-dvh lg:flex-nowrap lg:overflow-hidden">
      <main className="flex min-h-dvh min-w-0 flex-1 basis-[480px] flex-col justify-between gap-8 px-8 py-8 md:px-14 lg:h-full lg:min-h-0 lg:overflow-y-auto">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-surface">
            <ShieldCheck size={15} strokeWidth={2.25} />
          </span>
          <span className="text-[15px] font-bold tracking-tight text-foreground">Audit Portal</span>
        </div>

        <Suspense fallback={null}>
          <LoginForm googleEnabled={googleEnabled} />
        </Suspense>

        <p className="text-xs text-muted-2">Internal use only</p>
      </main>

      <section className="hidden min-w-0 flex-1 basis-[440px] flex-col justify-center bg-[#eaf0ff] px-12 py-6 lg:flex lg:h-full lg:overflow-hidden">
        <div className="mx-auto flex w-full max-w-[520px] flex-col gap-[clamp(12px,2.6vh,28px)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static decorative illustration */}
          <img
            src="/login-illustration.webp"
            alt="Policy documents flowing into a checked questionnaire, then a completed response"
            className="mx-auto block h-auto max-h-[28vh] w-auto max-w-full rounded-[20px] object-contain mix-blend-multiply"
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">From policy to answer</p>
            <h2 className="mt-2.5 text-[28px] font-bold leading-tight tracking-tight text-foreground">
              Answer every client questionnaire from your own documents.
            </h2>
          </div>
          <ol className="flex flex-col gap-[clamp(10px,2vh,16px)]">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex items-start gap-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface font-mono text-xs text-accent shadow-[0_1px_2px_rgba(16,24,40,0.08)]">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold text-foreground">{s.title}</p>
                  <p className="mt-0.5 leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
