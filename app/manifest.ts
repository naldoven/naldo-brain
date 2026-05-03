import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Naldo's Dashboard",
    short_name: "Dashboard",
    description: "The ultimate life-management dashboard.",
    start_url: "/overview",
    display: "standalone",
    background_color: "#1a3a2e",
    theme_color: "#6366F1",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
