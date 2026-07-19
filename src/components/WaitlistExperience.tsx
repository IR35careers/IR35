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
        vec3 color1 = vec3(1.0, 0.2, 0.1);
        vec3 color2 = vec3(0.8, 0.1, 0.6);
        vec3 color3 = vec3(0.4, 0.05, 0.8);

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
          vec3 color1 = vec3(1.0, 0.3, 0.2);
          vec3 color2 = vec3(0.6, 0.2, 0.8);

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

      {/* Content Layer */}
      <div className="relative z-10 min-h-screen">
        {/* Top Navigation */}
        <div className="absolute top-8 left-1/2 transform -translate-x-1/2 z-20">
          <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-6 py-3">
            <div className="flex items-center gap-6">
              {/* Logo */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-purple-600 flex items-center justify-center">
                  <Briefcase size={14} className="text-white" />
                </div>
                <span className="text-white font-bold text-sm">
                  IR35<span className="text-white/70">Careers</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Waitlist Card */}
        <div className="flex items-center justify-center min-h-screen px-4">
          <div className="relative">
            <div className="relative backdrop-blur-xl bg-black/60 border border-white/20 rounded-3xl p-8 w-[420px] max-w-[calc(100vw-2rem)] shadow-2xl">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />

              <div className="relative z-10">
                {!isSubmitted ? (
                  <>
                    <div className="mb-8 text-center">
                      {/* Badge */}
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-400/10 border border-emerald-400/30 mb-4">
                        <Sparkles size={12} className="text-emerald-300" />
                        <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                          Beta is live
                        </span>
                      </div>

                      <h1 className="text-3xl sm:text-4xl font-light text-white mb-4 tracking-wide">
                        UK contracts, IR35 status up front
                      </h1>
                      <p className="text-white/70 text-sm sm:text-base leading-relaxed">
                        Browse live Inside &amp; Outside IR35 roles now — join the
                        <br />
                        list for launch updates and rate alerts
                      </p>
                    </div>

                    <form onSubmit={handleSubmit} className="mb-6">
                      <div className="flex gap-3">
                        <Input
                          type="email"
                          placeholder="your@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          disabled={isSubmitting}
                          className="flex-1 h-12 rounded-xl"
                        />
                        <Button
                          type="submit"
                          disabled={isSubmitting}
                          className="h-12 px-6 bg-red-600 hover:bg-red-700 text-white font-medium rounded-xl hover:shadow-lg hover:shadow-red-500/25"
                        >
                          {isSubmitting ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <>
                              Get Notified
                              <ArrowRight size={14} className="ml-1.5" />
                            </>
                          )}
                        </Button>
                      </div>
                    </form>

                    {signupCount !== null && signupCount > 0 && (
                      <div className="flex items-center justify-center gap-1.5 mb-6 text-white/70 text-sm">
                        <Users size={13} />
                        <span>
                          <span className="font-semibold text-white">
                            {signupCount.toLocaleString()}
                          </span>{" "}
                          {signupCount === 1 ? "person has" : "people have"}{" "}
                          already joined
                        </span>
                      </div>
                    )}

                    <div>
                      {/* Live board — the product is real now */}
                      {jobCount !== null && jobCount > 0 && (
                        <div className="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                          <div className="flex items-center justify-center gap-2 text-sm text-white/70">
                            <span className="relative flex h-2 w-2" aria-hidden>
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                            </span>
                            <span>
                              <span className="font-semibold text-white">
                                {jobCount.toLocaleString()}
                              </span>{" "}
                              live contracts on the board — beta is open
                            </span>
                          </div>

                          {featuredJobs.length > 0 && (
                            <ul className="mt-3 space-y-1.5">
                              {featuredJobs.map((job) => (
                                <li key={job.id}>
                                  <Link
                                    href={`/jobs/${job.id}`}
                                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-white/[0.06]"
                                  >
                                    <span className="min-w-0 truncate text-white/80">
                                      {job.title}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                      {job.rate && (
                                        <span className="font-medium tabular-nums text-white">
                                          {job.rate}
                                        </span>
                                      )}
                                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                        Outside IR35
                                      </span>
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}

                          <Link
                            href="/jobs"
                            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                          >
                            Browse all contracts <ArrowRight size={14} />
                          </Link>
                        </div>
                      )}

                      <p className="text-[10px] text-white/40 text-center uppercase tracking-widest mb-3">
                        Counting down to full launch
                      </p>
                      <CountdownTimer />
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-green-400/30 to-emerald-500/30 flex items-center justify-center border border-green-400/40">
                      <CheckCircle2 className="w-8 h-8 text-green-400 drop-shadow-lg" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2 drop-shadow-lg">
                      You&apos;re on the list!
                    </h3>
                    <p className="text-white/90 text-sm drop-shadow-md">
                      We&apos;ll notify you when we launch. Thanks for joining!
                    </p>
                  </div>
                )}
              </div>

              <div className="absolute inset-0 rounded-3xl bg-gradient-to-t from-transparent via-white/[0.02] to-white/[0.05] pointer-events-none" />
            </div>

            {/* Outer glow */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-red-500/10 to-purple-600/10 blur-xl scale-110 -z-10" />
          </div>
        </div>
      </div>
    </main>
  );
}
