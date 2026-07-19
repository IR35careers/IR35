"use client";

import React from "react";
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  QuadraticBezierCurve3,
  Vector3,
  TubeGeometry,
  ShaderMaterial,
  Mesh,
  AdditiveBlending,
  DoubleSide,
} from "three";
import type { ReactElement } from "react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Briefcase, Sparkles, ArrowRight, Loader2, CheckCircle2, Users } from "lucide-react";
import { validateEmail } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import CountdownTimer from "./CountdownTimer";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={`flex h-10 w-full rounded-md border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:border-white/40 disabled:cursor-not-allowed disabled:opacity-50 backdrop-blur-sm ${className ?? ""}`}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
  return (
    <button
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 ${className ?? ""}`}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  );
});
Button.displayName = "Button";

export function WaitlistExperience(): ReactElement {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const animationIdRef = useRef<number>(0);

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [featuredJobs, setFeaturedJobs] = useState<
    Array<{ id: string; title: string; rate: string; company: string }>
  >([]);

  // Live board preview: total contracts + 3 featured Outside IR35 roles.
  useEffect(() => {
    let isMounted = true;
    fetch("/api/jobs/search?ir35=outside&per_page=3&sort=rate_high")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (json: {
          total?: number;
          jobs?: Array<{
            id: string;
            title: string;
            company_name: string;
            rate_min: number | null;
            rate_max: number | null;
            rate_type: string;
          }>;
        } | null) => {
          if (!isMounted || !json) return;
          setFeaturedJobs(
            (json.jobs ?? []).map((j) => ({
              id: j.id,
              title: j.title,
              company: j.company_name,
              rate:
                j.rate_max !== null || j.rate_min !== null
                  ? `£${(j.rate_max ?? j.rate_min)!.toLocaleString()}${j.rate_type === "hourly" ? "/hr" : "/day"}`
                  : "",
            }))
          );
        }
      )
      .catch(() => undefined);
    fetch("/api/jobs/search?per_page=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { total?: number } | null) => {
        if (!isMounted || !json?.total) return;
        setJobCount(json.total);
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

  // Three.js background effect
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;

    const scene = new Scene();
    const camera = new PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    rendererRef.current = renderer;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);
    container.appendChild(renderer.domElement);

    // Create curved light geometry
    const curve = new QuadraticBezierCurve3(
      new Vector3(-15, -4, 0),
      new Vector3(2, 3, 0),
      new Vector3(18, 0.8, 0)
    );

    const tubeGeometry = new TubeGeometry(curve, 200, 0.8, 32, false);

    // Vertex shader
    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vPosition;
      void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    // Fragment shader - Red/Orange to Purple/Magenta (like reference)
    const fragmentShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vec3 color1 = vec3(0.1, 0.9, 0.55);
        vec3 color2 = vec3(0.15, 0.65, 0.95);
        vec3 color3 = vec3(0.2, 0.4, 1.0);

        vec3 finalColor = mix(color1, color2, vUv.x);
        finalColor = mix(finalColor, color3, vUv.x * 0.7);

        float glow = 1.0 - abs(vUv.y - 0.5) * 2.0;
        glow = pow(glow, 2.0);

        float fade = 1.0;
        if (vUv.x > 0.85) {
          fade = 1.0 - smoothstep(0.85, 1.0, vUv.x);
        }

        float pulse = sin(time * 2.0) * 0.1 + 0.9;

        gl_FragColor = vec4(finalColor * glow * pulse * fade, glow * fade * 0.8);
      }
    `;

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        time: { value: 0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    const lightStreak = new Mesh(tubeGeometry, material);
    scene.add(lightStreak);

    // Glow layer
    const glowGeometry = new TubeGeometry(curve, 200, 1.5, 32, false);
    const glowMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vPosition;

        void main() {
          vec3 color1 = vec3(0.15, 0.9, 0.6);
          vec3 color2 = vec3(0.2, 0.6, 1.0);

          vec3 finalColor = mix(color1, color2, vUv.x);

          float glow = 1.0 - abs(vUv.y - 0.5) * 2.0;
          glow = pow(glow, 4.0);

          float fade = 1.0;
          if (vUv.x > 0.85) {
            fade = 1.0 - smoothstep(0.85, 1.0, vUv.x);
          }

          float pulse = sin(time * 1.5) * 0.05 + 0.95;

          gl_FragColor = vec4(finalColor * glow * pulse * fade, glow * fade * 0.3);
        }
      `,
      uniforms: {
        time: { value: 0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    const glowLayer = new Mesh(glowGeometry, glowMaterial);
    scene.add(glowLayer);

    camera.position.z = 7;
    camera.position.y = -0.8;

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      const time = Date.now() * 0.001;
      material.uniforms.time.value = time;
      glowMaterial.uniforms.time.value = time;
      lightStreak.rotation.z = Math.sin(time * 0.2) * 0.05;
      glowLayer.rotation.z = Math.sin(time * 0.2) * 0.05;
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!camera || !renderer) return;
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      tubeGeometry.dispose();
      glowGeometry.dispose();
      material.dispose();
      glowMaterial.dispose();
    };
  }, []);

  // Fetch the real signup count for social proof (view is defined in supabase/waitlist.sql).
  // Hidden entirely if it can't be loaded or is still zero, rather than showing a made-up number.
  useEffect(() => {
    let isMounted = true;
    supabase
      .from("waitlist_count")
      .select("total")
      .single()
      .then(({ data, error }) => {
        if (!isMounted || error || !data) return;
        setSignupCount(Number(data.total));
      });
    return () => {
      isMounted = false;
    };
  }, []);

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
      const { error } = await supabase
        .from("waitlist")
        .insert([{ email: email.trim().toLowerCase() }]);

      if (error) {
        if (error.code === "23505") {
          toast.error("This email is already on the waitlist!");
        } else {
          toast.error("Something went wrong. Please try again.");
        }
        setIsSubmitting(false);
        return;
      }

      setIsSubmitted(true);
      toast.success("You're on the list! 🎉");
      setEmail("");
    } catch {
      toast.error("Network error. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-black w-full">
      {/* Three.js Background */}
      <div
        ref={mountRef}
        className="fixed inset-0 w-full h-full"
        style={{ zIndex: 0 }}
        aria-hidden="true"
      />
      {/* Readability scrim over the streak */}
      <div
        className="pointer-events-none fixed inset-0 z-[1] bg-gradient-to-b from-black/40 via-transparent to-black/60"
        aria-hidden="true"
      />

      {/* Content Layer */}
      <div className="relative z-10 min-h-screen">
        {/* Top bar */}
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 pt-7 sm:px-8">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-md">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-sky-500">
              <Briefcase size={14} className="text-black" />
            </div>
            <span className="text-sm font-bold text-white">
              IR35<span className="text-white/70">Careers</span>
            </span>
          </div>
          <Link
            href="/jobs"
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 backdrop-blur-md transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            Browse contracts
          </Link>
        </div>

        {/* Hero */}
        <div className="mx-auto grid min-h-[calc(100vh-90px)] max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          {/* Left: message + actions */}
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1">
              <Sparkles size={12} className="text-emerald-300" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                Beta is live
              </span>
            </div>

            <h1 className="mt-5 text-4xl font-light leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
              UK contracts,
              <br />
              <span className="bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent">
                IR35 status up front
              </span>
            </h1>

            <p className="mt-5 max-w-md text-base leading-relaxed text-white/60">
              Every role labelled Inside or Outside IR35, with day rates shown
              before you click. Pulled live from Reed, Adzuna and employer
              boards, refreshed through the day.
            </p>

            <div className="mt-8">
              <Link
                href="/jobs"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                Browse {jobCount !== null && jobCount > 0 ? jobCount.toLocaleString() : "live"}{" "}
                contracts <ArrowRight size={15} />
              </Link>
            </div>

            {/* Waitlist strip */}
            <div className="mt-8 max-w-md rounded-2xl border border-white/10 bg-black/50 p-4 backdrop-blur-md">
              {!isSubmitted ? (
                <>
                  <p className="text-sm font-medium text-white/85">
                    Get launch updates &amp; rate alerts
                  </p>
                  <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      aria-label="Email address"
                      className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                    />
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="shrink-0 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-400 px-4 font-semibold text-black hover:opacity-90"
                    >
                      {isSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          Notify me <ArrowRight size={14} />
                        </>
                      )}
                    </Button>
                  </form>
                  {signupCount !== null && signupCount > 0 && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-xs text-white/50">
                      <Users size={12} />
                      <span>
                        <span className="font-semibold text-white/80">
                          {signupCount.toLocaleString()}
                        </span>{" "}
                        {signupCount === 1 ? "person" : "people"} already signed up
                      </span>
                    </p>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-3 py-1">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/15">
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">You&apos;re on the list!</p>
                    <p className="text-xs text-white/60">
                      We&apos;ll email you at launch — the board is open to browse meanwhile.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Countdown */}
            <div className="mt-7">
              <p className="mb-2 text-[10px] uppercase tracking-widest text-white/35">
                Full launch in
              </p>
              <CountdownTimer />
            </div>
          </div>

          {/* Right: live board proof */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-emerald-500/10 to-sky-500/10 blur-2xl" aria-hidden />
            <div className="relative rounded-3xl border border-white/15 bg-black/60 p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm text-white/70">
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  Live on the board
                </p>
                {jobCount !== null && jobCount > 0 && (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium tabular-nums text-white/80">
                    {jobCount.toLocaleString()} roles
                  </span>
                )}
              </div>

              {featuredJobs.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {featuredJobs.map((job) => (
                    <li key={job.id}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="group block rounded-xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:border-white/25 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-sm font-medium text-white">
                            {job.title}
                          </p>
                          {job.rate && (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-white">
                              {job.rate}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-xs text-white/45">{job.company}</p>
                          <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            Outside IR35
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-white/45">
                  Fresh contracts land here throughout the day.
                </p>
              )}

              <Link
                href="/jobs"
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white/85 transition-colors hover:border-white/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                See all contracts <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
