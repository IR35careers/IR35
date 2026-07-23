"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

// Target launch date: use NEXT_PUBLIC_LAUNCH_DATE (ISO) or fallback to NEXT_PUBLIC_COUNTDOWN_DAYS (defaults to 40 days)
const DEFAULT_DAYS = Number(process.env.NEXT_PUBLIC_COUNTDOWN_DAYS || "40");
const LAUNCH_DATE = process.env.NEXT_PUBLIC_LAUNCH_DATE
  ? new Date(process.env.NEXT_PUBLIC_LAUNCH_DATE).getTime()
  : Date.now() + DEFAULT_DAYS * 24 * 60 * 60 * 1000;

export default function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    const calculateTime = (): TimeLeft => {
      const now = Date.now();
      const difference = LAUNCH_DATE - now;

      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0 };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor(
          (difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        ),
        minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((difference % (1000 * 60)) / 1000),
      };
    };

    setTimeLeft(calculateTime());

    const timer = setInterval(() => {
      setTimeLeft(calculateTime());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const units = [
    { label: "Days", value: timeLeft.days },
    { label: "Hours", value: timeLeft.hours },
    { label: "Minutes", value: timeLeft.minutes },
    { label: "Seconds", value: timeLeft.seconds },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.6 }}
      className="flex items-center justify-center gap-3 sm:gap-5"
    >
      {units.map((unit, i) => (
        <div key={unit.label} className="flex items-center gap-3 sm:gap-5">
          <div className="text-center min-w-[52px] sm:min-w-[64px]">
            <div className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-slate-900 tabular-nums tracking-tight">
              {String(unit.value).padStart(2, "0")}
            </div>
            <div className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-widest mt-1">
              {unit.label}
            </div>
          </div>
          {i < units.length - 1 && (
            <div className="text-slate-200 text-xl sm:text-2xl font-light">
              |
            </div>
          )}
        </div>
      ))}
    </motion.div>
  );
}
