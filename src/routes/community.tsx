import { createFileRoute } from "@tanstack/react-router";
import { CommunityPage } from "@/components/cookai";
export const Route = createFileRoute("/community")({
  head: () => ({ meta: [
    { title: "Recipe Community — RASOai" }, { name: "description", content: "Share dishes, discover home cooks, and save community recipes." },
    { property: "og:title", content: "Recipe Community — RASOai" }, { property: "og:description", content: "Share dishes, discover home cooks, and save community recipes." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ]}), component: CommunityPage,
});