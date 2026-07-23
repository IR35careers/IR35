"use client";

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

const DEFAULT_DAYS = Number(process.env.NEXT_PUBLIC_COUNTDOWN_DAYS || "40");
const LAUNCH_DATE = process.env.NEXT_PUBLIC_LAUNCH_DATE
  ? new Date(process.env.NEXT_PUBLIC_LAUNCH_DATE).getTime()
  : Date.now() + DEFAULT_DAYS * 24 * 60 * 60 * 1000;

export default function CountdownTimer() {
  const reduce = useReducedMotion();
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const calculate = (): TimeLeft => {
      const diff = LAUNCH_DATE - Date.now();
      if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      return {
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      };
    };
    setTimeLeft(calculate());
    const timer = setInterval(() => setTimeLeft(calculate()), 1000);
    return () => clearInterval(timer);
  }, []);

  const units = [
    { label: "Days", value: timeLeft.days },
    { label: "Hrs", value: timeLeft.hours },
    { label: "Min", value: timeLeft.minutes },
    { label: "Sec", value: timeLeft.seconds },
  ];

  return (
    <div className="flex items-stretch justify-center gap-2">
      {units.map((unit, i) => (
        <motion.div
          key={unit.label}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex-1 rounded-xl border border-slate-200/80 bg-white/70 px-2 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] backdrop-blur-sm"
        >
          <div className="text-center text-xl font-semibold tabular-nums tracking-tight text-slate-900 sm:text-2xl">
            {String(unit.value).padStart(2, "0")}
          </div>
          <div className="mt-0.5 text-center text-[9px] font-medium uppercase tracking-[0.18em] text-slate-400">
            {unit.label}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
