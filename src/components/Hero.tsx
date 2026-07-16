"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2, Sparkles, Users } from "lucide-react";
import CountdownTimer from "./CountdownTimer";
import { validateEmail } from "@/lib/utils";
import toast from "react-hot-toast";

export default function Hero() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

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

      setIsSubmitted(true);
      toast.success("You're on the list! We'll be in touch soon. 🎉");
      setEmail("");
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className="relative min-h-screen flex items-center justify-center overflow-hidden"
      id="hero"
    >
      {/* Dark gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/40 z-[1]" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03] z-[1]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 sm:py-36">
        <div className="flex items-center justify-center">
          {/* Glassmorphism Waitlist Card */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* Outer glow */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary-500/20 to-accent-500/20 blur-2xl scale-110 -z-10" />

            {/* Main card */}
            <div className="relative backdrop-blur-2xl bg-white/5 dark:bg-surface-900/40 border border-white/15 rounded-3xl p-8 sm:p-10 w-full max-w-[460px] shadow-2xl">
              {/* Inner gradient overlay */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/[0.08] to-transparent pointer-events-none" />

              <div className="relative z-10">
                <AnimatePresence mode="wait">
                  {!isSubmitted ? (
                    <motion.div
                      key="form"
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0, y: -20 }}
                    >
                      {/* Badge */}
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 0.5 }}
                        className="flex justify-center mb-6"
                      >
                        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 backdrop-blur-sm">
                          <Sparkles
                            size={13}
                            className="text-accent-400"
                          />
                          <span className="text-[11px] font-semibold text-white/80 uppercase tracking-wider">
                            Launching Soon
                          </span>
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                        </div>
                      </motion.div>

                      {/* Headline */}
                      <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 0.6 }}
                        className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-white text-center leading-[1.1] tracking-tight mb-4"
                      >
                        Find Better UK{" "}
                        <span className="bg-gradient-to-r from-primary-400 via-accent-400 to-primary-400 bg-clip-text text-transparent">
                          Contract Jobs.
                        </span>
                      </motion.h1>

                      {/* Subheadline */}
                      <motion.p
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4, duration: 0.5 }}
                        className="text-white/60 text-sm sm:text-base text-center leading-relaxed mb-8 max-w-sm mx-auto"
                      >
                        The UK&apos;s modern platform for Inside &amp; Outside
                        IR35 contract opportunities. Join thousands getting
                        early access.
                      </motion.p>

                      {/* Form */}
                      <motion.form
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5, duration: 0.5 }}
                        onSubmit={handleSubmit}
                        className="mb-7"
                      >
                        <div className="flex flex-col sm:flex-row gap-3">
                          <input
                            type="text"
                            placeholder="Your name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isSubmitting}
                            aria-label="Name"
                            className="hidden sm:block w-36 h-12 px-3 rounded-xl bg-white/6 border border-white/10 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20 transition-all duration-300 backdrop-blur-sm disabled:opacity-50"
                          />

                          <input
                            type="email"
                            placeholder="your@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isSubmitting}
                            aria-label="Email address"
                            className="flex-1 h-12 px-4 rounded-xl bg-white/10 border border-white/15 text-white placeholder:text-white/40 text-sm font-medium outline-none focus:border-primary-400/60 focus:ring-2 focus:ring-primary-400/20 transition-all duration-300 backdrop-blur-sm disabled:opacity-50"
                          />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="h-12 px-6 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white font-semibold rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-primary-500/25 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm whitespace-nowrap"
                          >
                            {isSubmitting ? (
                              <Loader2
                                size={18}
                                className="animate-spin"
                              />
                            ) : (
                              <>
                                Get Early Access
                                <ArrowRight size={15} />
                              </>
                            )}
                          </button>
                        </div>
                        <p className="mt-3 text-center text-[11px] text-white/40">
                          No spam. Get launch updates and early access.
                        </p>
                      </motion.form>

                      {/* Social proof */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.7, duration: 0.5 }}
                        className="flex items-center justify-center gap-3 mb-8"
                      >
                        <div className="flex -space-x-2">
                          {[
                            "from-blue-400 to-indigo-500",
                            "from-emerald-400 to-teal-500",
                            "from-purple-400 to-violet-500",
                            "from-amber-400 to-orange-500",
                          ].map((gradient, i) => (
                            <div
                              key={i}
                              className={`w-8 h-8 rounded-full bg-gradient-to-br ${gradient} border-2 border-white/15 flex items-center justify-center text-white text-xs font-bold`}
                            >
                              {["J", "A", "M", "S"][i]}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users size={13} className="text-white/50" />
                          <span className="text-white/60 text-sm">
                            2,500+ already joined
                          </span>
                        </div>
                      </motion.div>

                      {/* Divider */}
                      <div className="w-full h-px bg-white/10 mb-6" />

                      {/* Countdown */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.9, duration: 0.5 }}
                      >
                        <p className="text-[11px] text-white/40 text-center uppercase tracking-widest mb-3">
                          Countdown to Launch
                        </p>
                        <CountdownTimer />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5 }}
                      className="text-center py-8"
                    >
                      <div className="w-20 h-20 mx-auto mb-5 rounded-full bg-gradient-to-r from-emerald-400/20 to-accent-500/20 flex items-center justify-center border border-emerald-400/30">
                        <CheckCircle2
                          size={36}
                          className="text-emerald-400"
                        />
                      </div>
                      <h3 className="text-2xl font-bold text-white mb-2">
                        You&apos;re on the list!
                      </h3>
                      <p className="text-white/70 text-sm max-w-xs mx-auto">
                        We&apos;ll notify you when we launch. Thanks for
                        joining IR35Careers!
                      </p>

                      {/* Still show countdown */}
                      <div className="mt-8 pt-6 border-t border-white/10">
                        <p className="text-[11px] text-white/40 text-center uppercase tracking-widest mb-3">
                          Countdown to Launch
                        </p>
                        <CountdownTimer />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Bottom gradient overlay */}
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-transparent via-white/[0.01] to-white/[0.03] pointer-events-none" />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
