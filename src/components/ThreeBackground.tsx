"use client";

import { useEffect, useRef } from "react";
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

export default function ThreeBackground() {
  const mountRef = useRef<HTMLDivElement>(null);
  const animationIdRef = useRef<number>(0);

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;

    // Scene setup
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

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // --- Main light streak curve ---
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

    // Fragment shader - IR35Careers brand colors (indigo → teal → purple)
    const fragmentShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        // IR35Careers brand gradient: indigo → teal → deep purple
        vec3 color1 = vec3(0.39, 0.4, 0.95);   // Indigo (#6366f1)
        vec3 color2 = vec3(0.08, 0.72, 0.65);   // Teal (#14b8a6)
        vec3 color3 = vec3(0.42, 0.22, 0.82);   // Purple

        vec3 finalColor = mix(color1, color2, vUv.x);
        finalColor = mix(finalColor, color3, vUv.x * 0.7);

        // Glow effect
        float glow = 1.0 - abs(vUv.y - 0.5) * 2.0;
        glow = pow(glow, 2.0);

        // Fade at edges
        float fade = 1.0;
        if (vUv.x > 0.85) {
          fade = 1.0 - smoothstep(0.85, 1.0, vUv.x);
        }
        if (vUv.x < 0.15) {
          fade = smoothstep(0.0, 0.15, vUv.x);
        }

        // Subtle pulse animation
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

    // --- Outer glow layer ---
    const glowGeometry = new TubeGeometry(curve, 200, 1.5, 32, false);

    const glowFragmentShader = `
      uniform float time;
      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vec3 color1 = vec3(0.49, 0.45, 0.95);  // Lighter indigo
        vec3 color2 = vec3(0.18, 0.83, 0.75);   // Lighter teal

        vec3 finalColor = mix(color1, color2, vUv.x);

        float glow = 1.0 - abs(vUv.y - 0.5) * 2.0;
        glow = pow(glow, 4.0);

        float fade = 1.0;
        if (vUv.x > 0.85) {
          fade = 1.0 - smoothstep(0.85, 1.0, vUv.x);
        }
        if (vUv.x < 0.15) {
          fade = smoothstep(0.0, 0.15, vUv.x);
        }

        float pulse = sin(time * 1.5) * 0.05 + 0.95;

        gl_FragColor = vec4(finalColor * glow * pulse * fade, glow * fade * 0.3);
      }
    `;

    const glowMaterial = new ShaderMaterial({
      vertexShader,
      fragmentShader: glowFragmentShader,
      uniforms: {
        time: { value: 0 },
      },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    const glowLayer = new Mesh(glowGeometry, glowMaterial);
    scene.add(glowLayer);

    // --- Second streak (smaller, offset) ---
    const curve2 = new QuadraticBezierCurve3(
      new Vector3(-12, 2, -2),
      new Vector3(0, -1, 0),
      new Vector3(16, 3, -1)
    );

    const tubeGeometry2 = new TubeGeometry(curve2, 150, 0.4, 16, false);
    const material2 = new ShaderMaterial({
      vertexShader,
      fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        void main() {
          vec3 color1 = vec3(0.66, 0.33, 0.97);  // Violet
          vec3 color2 = vec3(0.08, 0.72, 0.65);   // Teal
          vec3 finalColor = mix(color1, color2, vUv.x);
          float glow = 1.0 - abs(vUv.y - 0.5) * 2.0;
          glow = pow(glow, 3.0);
          float fade = 1.0;
          if (vUv.x > 0.9) fade = 1.0 - smoothstep(0.9, 1.0, vUv.x);
          if (vUv.x < 0.1) fade = smoothstep(0.0, 0.1, vUv.x);
          float pulse = sin(time * 1.8 + 1.0) * 0.15 + 0.85;
          gl_FragColor = vec4(finalColor * glow * pulse * fade, glow * fade * 0.5);
        }
      `,
      uniforms: { time: { value: 0 } },
      transparent: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });

    const lightStreak2 = new Mesh(tubeGeometry2, material2);
    scene.add(lightStreak2);

    // Position camera
    camera.position.z = 7;
    camera.position.y = -0.8;

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);
      const time = Date.now() * 0.001;

      material.uniforms.time.value = time;
      glowMaterial.uniforms.time.value = time;
      material2.uniforms.time.value = time;

      // Subtle rotation
      lightStreak.rotation.z = Math.sin(time * 0.2) * 0.05;
      glowLayer.rotation.z = Math.sin(time * 0.2) * 0.05;
      lightStreak2.rotation.z = Math.sin(time * 0.15 + 0.5) * 0.03;

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
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
      tubeGeometry2.dispose();
      material.dispose();
      glowMaterial.dispose();
      material2.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
