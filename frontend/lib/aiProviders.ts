export const AI_PROVIDER_LABEL = "OpenRouter";

export function modelBadgeLabel(model: string | null): string {
  if (!model) return "Not configured";
  const name = model.split("/").pop() ?? model;
  return name;
}
