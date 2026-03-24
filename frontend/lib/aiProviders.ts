import type { AIConfigureBody } from "./api";

export type AIProviderId = AIConfigureBody["provider"];

export const AI_PROVIDERS: {
  id: AIProviderId;
  title: string;
  desc: string;
  dot: string;
}[] = [
  {
    id: "anthropic",
    title: "Claude (Anthropic)",
    desc: "Nuanced, thoughtful coaching",
    dot: "bg-orange-500",
  },
  {
    id: "openai",
    title: "ChatGPT (OpenAI)",
    desc: "Powerful and versatile",
    dot: "bg-emerald-500",
  },
  {
    id: "google",
    title: "Gemini (Google)",
    desc: "Fast and multimodal",
    dot: "bg-blue-500",
  },
];

export const AI_KEY_LINKS: Record<
  AIProviderId,
  { label: string; href: string; placeholder: string }
> = {
  anthropic: {
    label: "Get your API key →",
    href: "https://console.anthropic.com",
    placeholder: "sk-ant-…",
  },
  openai: {
    label: "Get your API key →",
    href: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  google: {
    label: "Get your API key →",
    href: "https://aistudio.google.com/app/apikey",
    placeholder: "AIza…",
  },
};

export function providerBadgeLabel(provider: string | null): string {
  if (!provider) return "Not set";
  const p = AI_PROVIDERS.find((x) => x.id === provider);
  return p?.title ?? provider;
}
