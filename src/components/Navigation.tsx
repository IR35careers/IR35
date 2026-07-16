"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Moon, Sun, Briefcase } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";

const navLinks = [
  { name: "Features", href: "#features" },
  { name: "How It Works", href: "#how-it-works" },
  { name: "FAQ", href: "#faq" },
  { name: "Roadmap", href: "#timeline" },
];

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isPastHero, setIsPastHero] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
      setIsPastHero(window.scrollY > window.innerHeight - 200);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <motion.nav
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
          isScrolled
            ? isPastHero
              ? "py-3 bg-white/80 dark:bg-surface-950/80 backdrop-blur-xl border-b border-surface-200/50 dark:border-surface-800/50 shadow-soft"
              : "py-3 bg-surface-950/60 backdrop-blur-xl border-b border-white/5"
            : "py-5 bg-transparent"
        }`}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link
              href="/"
              className="flex items-center gap-2.5 group"
              aria-label="IR35Careers home"
            >
              <div className="relative">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-glow group-hover:shadow-glow-lg transition-shadow duration-300">
                  <Briefcase className="text-white" size={18} />
                </div>
              </div>
              <span
                className={`text-lg font-bold tracking-tight transition-colors duration-300 ${
                  isPastHero
                    ? "text-surface-900 dark:text-white"
                    : "text-white"
                }`}
              >
                IR35
                <span className="bg-gradient-to-r from-primary-400 to-accent-400 bg-clip-text text-transparent">
                  Careers
                </span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-medium transition-colors duration-200 rounded-xl ${
                    isPastHero
                      ? "text-surface-600 dark:text-surface-400 hover:text-surface-900 dark:hover:text-white hover:bg-surface-100/50 dark:hover:bg-surface-800/50"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {mounted && (
                <button
                  onClick={() =>
                    setTheme(theme === "dark" ? "light" : "dark")
                  }
                  className={`hidden sm:flex p-2.5 rounded-xl transition-all duration-200 ${
                    isPastHero
                      ? "text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100/50 dark:hover:bg-surface-800/50"
                      : "text-white/60 hover:text-white hover:bg-white/10"
                  }`}
                  aria-label="Toggle dark mode"
                >
                  {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              )}

              <Link
                href="#hero"
                className={`hidden sm:inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 hover:-translate-y-0.5 ${
                  isPastHero
                    ? "bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 text-white shadow-glow hover:shadow-glow-lg"
                    : "bg-white/15 hover:bg-white/25 text-white border border-white/20 backdrop-blur-sm"
                }`}
              >
                Join Waitlist
              </Link>

              {/* Mobile menu button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className={`md:hidden p-2.5 rounded-xl transition-colors ${
                  isPastHero
                    ? "text-surface-600 dark:text-surface-400 hover:bg-surface-100/50 dark:hover:bg-surface-800/50"
                    : "text-white/70 hover:bg-white/10"
                }`}
                aria-label="Toggle mobile menu"
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 top-[60px] z-40 md:hidden"
          >
            <div className="mx-4 mt-2 p-4 bg-white/95 dark:bg-surface-900/95 backdrop-blur-xl rounded-2xl border border-surface-200/50 dark:border-surface-700/50 shadow-soft-lg">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block px-4 py-3 text-base font-medium text-surface-700 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-50 dark:hover:bg-surface-800 rounded-xl transition-colors"
                >
                  {link.name}
                </Link>
              ))}
              <div className="mt-3 pt-3 border-t border-surface-200/50 dark:border-surface-700/50">
                <Link
                  href="#hero"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="btn-primary w-full text-sm !rounded-xl"
                >
                  Join Waitlist
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
