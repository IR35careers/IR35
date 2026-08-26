"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion, useScroll, useSpring } from "framer-motion";

const EASE = [0.2, 0, 0, 1] as const;

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
}

export function HomeScrollProgress() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: reduceMotion ? 1000 : 150,
    damping: reduceMotion ? 1000 : 28,
    mass: 0.25,
  });

  return (
    <motion.div
      aria-hidden="true"
      className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-gradient-to-r from-brand-500 via-emerald-400 to-teal-400"
      style={{ scaleX }}
    />
  );
}

export function Reveal({ children, className = "", delay = 0, distance = 20 }: RevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: distance, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.14, margin: "0px 0px -36px" }}
      transition={{ duration: reduceMotion ? 0 : 0.58, delay: reduceMotion ? 0 : delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function HomeStickyCta() {
  const [visible, setVisible] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const target = document.getElementById("home-primary-actions");
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: "-80px 0px 0px", threshold: 0.15 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      aria-hidden={!visible}
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
      className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 md:hidden ${visible ? "pointer-events-auto" : "pointer-events-none"}`}
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-white/80 bg-[#071426]/95 p-2 pl-4 text-white shadow-floating backdrop-blur-xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">Find your next contract</p>
          <p className="truncate text-[11px] text-slate-300">Browse free. Apply when you are ready.</p>
        </div>
        <Link
          href="/jobs"
          className="ir35-focus inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-300 px-4 text-sm font-bold text-slate-950"
        >
          Browse <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </motion.div>
  );
}
