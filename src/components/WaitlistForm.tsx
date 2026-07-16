"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import toast from "react-hot-toast";

export default function WaitlistForm({
  variant = "hero",
}: {
  variant?: "hero" | "final";
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast.error("Please enter your email address.");
      return;
    }

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || null, email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        const msg = data?.message || "Something went wrong. Please try again.";
        toast.error(msg);
        setIsSubmitting(false);
        return;
      }

      setIsSuccess(true);
      toast.success("You're on the list! We'll be in touch soon. 🎉");
      setEmail("");
      setName("");

      setTimeout(() => setIsSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isHero = variant === "hero";

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-md mx-auto"
    >
      <div
        className={`relative flex items-center gap-2 p-1.5 bg-white dark:bg-surface-900 rounded-2xl shadow-soft-lg border border-surface-200/60 dark:border-surface-700/60 ${isHero ? "" : "sm:p-2"
          }`}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name (optional)"
          disabled={isSubmitting}
          aria-label="Name"
          className={`flex-0 w-28 px-3 py-2 bg-transparent text-surface-900 dark:text-white placeholder:text-surface-400 dark:placeholder:text-surface-500 text-sm font-medium outline-none disabled:opacity-50 hidden sm:block`}
        />

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          disabled={isSubmitting}
          aria-label="Email address"
          className={`flex-1 px-4 py-3 bg-transparent text-surface-900 dark:text-white placeholder:text-surface-400 dark:placeholder:text-surface-500 text-sm font-medium outline-none disabled:opacity-50 ${isHero ? "" : "sm:px-5 sm:py-3.5"
            }`}
        />
        <button
          type="submit"
          disabled={isSubmitting || isSuccess}
          className={`btn-primary !rounded-xl !px-5 !py-3 text-sm whitespace-nowrap disabled:opacity-70 ${isSuccess
            ? "!bg-gradient-to-r !from-emerald-500 !to-green-500"
            : ""
            }`}
        >
          {isSubmitting ? (
            <Loader2 size={18} className="animate-spin" />
          ) : isSuccess ? (
            <>
              <CheckCircle2 size={18} />
              <span className="hidden sm:inline">Joined!</span>
            </>
          ) : (
            <>
              <span>{isHero ? "Join Early Access" : "Join Waitlist"}</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
      {isHero && (
        <p className="mt-4 text-center text-xs text-surface-500 dark:text-surface-400">
          No spam. Get launch updates and early access.
        </p>
      )}
    </motion.form>
  );
}
