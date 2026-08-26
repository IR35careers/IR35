"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import SignInForm from "@/components/ui/sign-in-form";

export default function AccountPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#edf2ef] px-4 py-6 [color-scheme:light] sm:px-6 lg:py-10">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 right-[-10%] h-[480px] w-[480px] rounded-full bg-emerald-200/60 blur-[130px]" />
        <div className="absolute bottom-[-18%] left-[-10%] h-[500px] w-[500px] rounded-full bg-cyan-100/70 blur-[140px]" />
      </div>
      <div className="relative w-full max-w-[1120px]">
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center text-slate-500">
              <Loader2 className="animate-spin" size={22} />
            </div>
          }
        >
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}
