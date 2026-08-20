import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IR35Careers",
    short_name: "IR35Careers",
    description: "Find and prepare for UK contract roles with IR35 status, rates and working patterns visible.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8f7",
    theme_color: "#087a5b",
    orientation: "any",
    categories: ["business", "productivity"],
    icons: [
      { src: "/images/generated/brand/ir35careers-app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/images/generated/brand/ir35careers-app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/generated/brand/ir35careers-app-icon-256.png", sizes: "256x256", type: "image/png", purpose: "any" },
    ],
  };
}
