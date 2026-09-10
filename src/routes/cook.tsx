import { createFileRoute } from "@tanstack/react-router";
import { CookPage } from "@/components/cookai";
export const Route = createFileRoute("/cook")({
  head: () => ({ meta: [
    { title: "Cooking Assistant — CookAI" }, { name: "description", content: "Follow every recipe step with calm, contextual cooking guidance." },
    { property: "og:title", content: "Cooking Assistant — CookAI" }, { property: "og:description", content: "Follow every recipe step with calm, contextual cooking guidance." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ]}), component: CookPage,
});