import { createFileRoute } from "@tanstack/react-router";
import { RecipesPage } from "@/components/cookai";
export const Route = createFileRoute("/recipes")({
  head: () => ({ meta: [
    { title: "AI Recipe Discovery — CookAI" }, { name: "description", content: "Find recipes matched to the ingredients already in your kitchen." },
    { property: "og:title", content: "AI Recipe Discovery — CookAI" }, { property: "og:description", content: "Find recipes matched to the ingredients already in your kitchen." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ]}), component: RecipesPage,
});