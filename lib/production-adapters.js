import { validatePackage, fingerprint } from "./production-package.js";
import { validateCanonicalRecipe } from "./legacy/recipe-campaign-contract.js";
import { normalizeAudioConfig } from "./legacy/multiplier-audio-config.js";
import { buildRecipeSocialPackage } from "./legacy/recipe-social-package.js";
import { StudioError } from "./errors.js";
export const VIDEO_DNA_FIELDS = [
  "pilar_konten",
  "hook_type",
  "visual_style",
  "signature_moment",
  "camera_pace",
  "primary_emotion",
  "affiliate_integration",
  "affiliate_mention",
  "scene_count",
  "cta_type",
];
export function presetConfig(target) {
  let config = target.presetSnapshot?.payload?.config_json || {};
  if (typeof config === "string") config = JSON.parse(config);
  config = config.config || config;
  const d = target.productionDefaults || {};
  return {
    ...config,
    workflow: { ...d.workflow, ...config.workflow },
    visual_engine: { ...d.visual_engine, ...config.visual_engine },
  };
}
export function buildPlannerPrompt(kind, target, brand) {
  const product = target.productSnapshot?.payload || null;
  const source = target.sourceSnapshot?.payload || null;
  return `You are the MAKNA content planner. Return JSON {title,hook,contentGoal,cep,recipe,outline}. Language Indonesian. Source kind: ${kind}. For product_campaign produce CEP automatically from the actual product; do not invent product claims. For recipe_video or recipe_static produce realistic recipe with title, ingredients[{name,amount,unit}], steps[{index,instruction}], prep_minutes,cook_minutes. Brand: ${JSON.stringify(brand?.payload || {})}. Product: ${JSON.stringify(product)}. Variation: ${target.variation}. Source deconstruct: ${JSON.stringify(source?.original_storyboard_json || null)}. Editorial instruction: ${target.direction || ""}`;
}
export function buildCreativePrompt({ kind, target, brand, plan, identity }) {
  const config = presetConfig(target),
    visual = config.visual_engine || {};
  return `You are the MAKNA creative production compiler. Generate the complete creative package in ONE response: storyboard, VO, prompts, video DNA and social package. Do not issue a separate Call 2. videoDna must contain these 10 V2 fields: ${VIDEO_DNA_FIELDS.join(", ")}. Return JSON {title,caption,videoDna,socialPackage:{title,caption,hashtags,cta},recipe,scenes:[{id,mode,duration,imagePrompt,videoPrompt,narration,voiceSegments,referenceCritical}]}. Source kind: ${kind}. Indonesian narration. English image/video prompts. Stable unique scene IDs. mode is i2v or t2v. Scene count ${visual.target_clips_count || 4}, duration ${visual.clip_duration || 8}. For recipe_static return scenes with imagePrompt only, no video/audio. For recipe content preserve ingredients, measurements, step order and cookware continuity across all scenes. Never add an ingredient absent from recipe. For Multiplier retain the narrative pattern from the deconstructed storyboard while making a new version. Reference requirements are metadata, not invented binary URLs. Plan: ${JSON.stringify(plan)}. Source: ${JSON.stringify(target.sourceSnapshot?.payload?.original_storyboard_json || null)}. Brand: ${JSON.stringify(brand?.payload || {})}. Visual identity: ${JSON.stringify(identity || {})}. Production preset: ${JSON.stringify(config)}. Product truth: ${JSON.stringify(target.productSnapshot?.payload || null)}. Variation ${target.variation}.`;
}
export function normalizeCreative({
  response,
  kind,
  target,
  identity,
  tenantId,
  brandId,
  itemId,
  revision,
  plan,
}) {
  const config = presetConfig(target),
    visual = config.visual_engine || {},
    workflow = config.workflow || {},
    audio = normalizeAudioConfig({ ...config.basic_strategy, ...workflow });
  if (!Array.isArray(response.scenes) || !response.scenes.length)
    throw new StudioError("CREATIVE_INVALID", "Storyboard kosong.");
  if (["recipe_video", "recipe_static"].includes(kind)) {
    validateCanonicalRecipe(plan.recipe);
    if (
      response.recipe &&
      (fingerprint(response.recipe.ingredients) !==
        fingerprint(plan.recipe.ingredients) ||
        fingerprint(response.recipe.steps) !== fingerprint(plan.recipe.steps))
    )
      throw new StudioError(
        "RECIPE_CHANGED",
        "Komposisi resep berubah dari hasil planner.",
      );
  }
  if (kind !== "recipe_static") {
    const expected = Number(visual.target_clips_count || 4);
    if (response.scenes.length !== expected)
      throw new StudioError(
        "SCENE_COUNT_MISMATCH",
        "Jumlah klip tidak sesuai preset.",
      );
    if (
      VIDEO_DNA_FIELDS.some(
        (key) =>
          response.videoDna?.[key] === undefined ||
          response.videoDna?.[key] === null ||
          response.videoDna?.[key] === "",
      )
    )
      throw new StudioError(
        "VIDEO_DNA_INCOMPLETE",
        "Sepuluh parameter Video DNA belum lengkap.",
      );
    if (Number(response.videoDna.scene_count) !== expected)
      throw new StudioError(
        "VIDEO_DNA_SCENE_MISMATCH",
        "Video DNA dan storyboard memiliki jumlah scene berbeda.",
      );
  }
  const productRef =
    target.productSnapshot?.payload?.photo_status === "approved"
      ? target.productSnapshot.payload.photoArtifactId
      : null;
  const scenes = response.scenes.map((scene, index) => {
    let mode =
      visual.visual_mode === "pure_t2v"
        ? "t2v"
        : visual.visual_mode === "hybrid_lock"
          ? "i2v"
          : scene.mode || "i2v";
    const critical = Boolean(
      scene.referenceCritical ||
      (kind === "product_campaign" &&
        config.product_bridging?.is_bridging_active &&
        index + 1 >= config.product_bridging.bridge_at_clip &&
        (config.product_bridging.bridge_duration_clips === 0 ||
          index + 1 <
            config.product_bridging.bridge_at_clip +
              (config.product_bridging.bridge_duration_clips ?? 1))),
    );
    if (critical) mode = "i2v";
    if (critical && !productRef)
      throw new StudioError(
        "PRODUCT_REFERENCE_MISSING",
        "Foto produk terverifikasi belum tersedia.",
      );
    return {
      ...scene,
      id: String(scene.id || "scene-" + (index + 1)),
      mode,
      duration: Number(scene.duration || visual.clip_duration || 8),
      references: critical ? [productRef] : [],
      referenceCritical: critical,
    };
  });
  const recipe = ["recipe_video", "recipe_static"].includes(kind)
    ? plan.recipe
    : response.recipe || plan.recipe;
  const social = ["recipe_video", "recipe_static"].includes(kind)
    ? {
        ...response.socialPackage,
        ...buildRecipeSocialPackage(recipe, {
          ...response.socialPackage,
          hook: plan.hook,
          lang: "id",
        }),
      }
    : response.socialPackage || {};
  if (
    ["recipe_video", "recipe_static"].includes(kind) &&
    plan.hook &&
    scenes[0]
  ) {
    scenes[0].narration = plan.hook;
    if (scenes[0].voiceSegments?.length)
      scenes[0].voiceSegments[0].text = plan.hook;
  }
  return validatePackage({
    schemaVersion: 1,
    tenantId,
    brandId,
    itemId,
    revision,
    sourceKind: kind,
    outputKind: kind === "recipe_static" ? "static" : "video",
    scenes,
    caption:
      social.caption_with_recipe || response.caption || social.caption || "",
    socialPackage: social,
    videoDna: response.videoDna || {},
    recipe,
    cep: kind === "product_campaign" ? plan.cep : null,
    audioMode: workflow.enable_tts === false ? "native" : "tts",
    audio: {
      provider: audio.voice_provider || "minimax",
      voice: audio.voice_persona || "Puck",
      speed: audio.voice_speed ?? 1,
      volume: audio.voice_volume ?? 1,
      model: audio.tts_model_quality,
      language: audio.target_language || "id-ID",
      cast: response.voiceCast || {},
      fallbackProvider:
        workflow.gemini_fallback_enabled === false ? null : "gemini",
      geminiTtsModel: target.productionDefaults?.geminiTtsModel,
    },
    visual: {
      aspectRatio: visual.aspect_ratio || "9:16",
      imageModel: visual.image_model || "nano_banana_2",
      videoModel: visual.video_model || "veo_31_lite",
    },
    mux: {
      syncOption: workflow.ffmpeg_sync_option || "smart_sync",
      videoScale: workflow.ffmpeg_video_scale ?? 1,
      bgmVolume: workflow.ffmpeg_bgm_volume ?? 0,
      sfxVolume: workflow.ffmpeg_sfx_volume ?? 0,
      bridgeAtClip: config.product_bridging?.bridge_at_clip ?? 2,
      bgmArtifactId: workflow.bgm_artifact_id || null,
    },
    referenceObjectIds: [
      target.productSnapshot?.id,
      target.identitySnapshot?.id,
    ].filter(Boolean),
    identitySnapshot: identity || null,
  });
}
