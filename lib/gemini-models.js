import { StudioError } from "./errors.js";
// V2 catalog, shared by the editor and execution policy. Provider availability is checked at runtime.
export const MODEL_CATALOG = {
  paid: [
    "gemini-3.6-flash",
    "gemini-1.5-flash-8b",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
  ],
  free: [
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
  ],
};
export const MODULE_MODELS = {
  extraction: "gemini-1.5-flash-8b",
  deconstruct: "gemini-2.5-flash",
  campaign: "gemini-3.6-flash",
};
export function modelConfig(value = {}) {
  const tier = value.tier === "paid" ? "paid" : "free";
  return {
    model: value.model || MODEL_CATALOG[tier][0],
    tier,
    fallbackModel: value.fallbackModel || "",
    smartRouting: value.smartRouting === true,
    contextCaching: tier === "paid" && value.contextCaching === true,
  };
}
export function validateModelConfig(value) {
  const c = modelConfig(value);
  if (value.tier && !["paid", "free"].includes(value.tier))
    throw new StudioError("TIER_INVALID", "Mode API tidak valid.");
  for (const name of [c.model, c.fallbackModel])
    if (name && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(name))
      throw new StudioError("MODEL_INVALID", "Model ID tidak valid.");
  return c;
}
export function modelChain(value, module = "campaign") {
  const c = modelConfig(value),
    primary =
      c.tier === "paid" && c.smartRouting && MODULE_MODELS[module]
        ? MODULE_MODELS[module]
        : c.model;
  return [
    ...new Set(
      [primary, c.fallbackModel, ...MODEL_CATALOG[c.tier]].filter(Boolean),
    ),
  ];
}
