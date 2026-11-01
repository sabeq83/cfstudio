import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadArtifact, saveArtifact } from "./artifact-store.js";
import { resolveConnection, connectionById } from "./connections.js";
import { gateway, pcmToWav } from "./provider-gateway.js";
import { providerJob } from "./provider-jobs.js";
import { StudioError } from "./errors.js";
const exec = promisify(execFile);
export async function mediaCommand(args) {
  try {
    return await exec(process.env.CF_FFMPEG_PATH || "ffmpeg", args, {
      timeout: 240000,
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new StudioError(
      "FFMPEG_FAILED",
      "Penyusunan media gagal. Periksa input dan pengaturan audio.",
    );
  }
}
export async function duration(file) {
  const r = await exec(
    process.env.CF_FFPROBE_PATH || "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { timeout: 15000 },
  );
  const n = Number(r.stdout.trim());
  if (!Number.isFinite(n) || n <= 0)
    throw new StudioError(
      "MEDIA_DURATION_INVALID",
      "Durasi media tidak valid.",
    );
  return n;
}
export function smartSync(video, audio, scale = 1) {
  const v = video * scale;
  return {
    videoDuration: v,
    audioDuration: audio,
    outputDuration: Math.max(v, audio),
    freezeSeconds: Math.max(0, audio - v),
  };
}
async function temporary(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cf-media-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const save = (pkg, kind, buffer, mimeType, extension) =>
  saveArtifact({
    tenantId: pkg.tenantId,
    brandId: pkg.brandId,
    objectId: pkg.itemId,
    revision: pkg.revision,
    kind,
    buffer,
    mimeType,
    extension,
  });
async function dataReference(pkg, ref) {
  const { asset, buffer } = await loadArtifact(
    pkg.tenantId,
    ref.assetId || ref.id,
  );
  if (
    (asset.brand_id && asset.brand_id !== pkg.brandId) ||
    (!asset.brand_id && !pkg.referenceObjectIds?.includes(asset.object_id))
  )
    throw new StudioError(
      "REFERENCE_BRAND_MISMATCH",
      "Reference tidak terkait brand/produk paket ini.",
    );
  if (ref.sha256 && ref.sha256 !== asset.sha256)
    throw new StudioError(
      "REFERENCE_CHECKSUM_MISMATCH",
      "Checksum reference produk berubah.",
    );
  if (!asset.mime_type.startsWith("image/"))
    throw new StudioError("REFERENCE_TYPE_INVALID", "Reference bukan gambar.");
  return `data:${asset.mime_type};base64,${buffer.toString("base64")}`;
}
async function glabsAsset(pkg, scene, stage, payload) {
  const connection = await resolveConnection(
    pkg.tenantId,
    pkg.brandId,
    "glabs",
  );
  const result = await providerJob(
    pkg,
    connection,
    scene.id,
    stage,
    payload,
    () =>
      gateway.json(
        connection,
        "POST",
        stage === "clips" ? "api/video/generate" : "api/image/generate",
        payload,
      ),
  );
  const routed =
    result._cfConnectionId && result._cfConnectionId !== connection.id
      ? await connectionById(pkg.tenantId, result._cfConnectionId)
      : connection;
  const raw = result.results?.[0] || result.files?.[0] || result.url;
  const file = typeof raw === "string" ? raw : raw?.url || raw?.filename;
  if (!file)
    throw new StudioError(
      "PROVIDER_MEDIA_EMPTY",
      "File provider tidak tersedia.",
    );
  const url = file.startsWith("http")
    ? file
    : new URL(
        "api/files/" + file.split("/").map(encodeURIComponent).join("/"),
        routed.config.baseUrl.endsWith("/")
          ? routed.config.baseUrl
          : routed.config.baseUrl + "/",
      ).href;
  const { buffer, mime } = await gateway.download(url, routed);
  return save(
    pkg,
    stage,
    buffer,
    stage === "clips" ? "video/mp4" : mime,
    stage === "clips" ? "mp4" : mime.includes("jpeg") ? "jpg" : "png",
  );
}
export function mediaServices(checkpoint) {
  return {
    async start_frames(pkg) {
      const outputs = {};
      for (const scene of pkg.scenes.filter((s) => s.mode === "i2v")) {
        const references = await Promise.all(
          (scene.references || []).map((r) => dataReference(pkg, r)),
        );
        outputs[scene.id] = await checkpoint("start_frame:" + scene.id, () =>
          glabsAsset(pkg, scene, "start_frames", {
            prompt: scene.imagePrompt,
            model: pkg.visual.imageModel,
            aspect_ratio: pkg.visual.aspectRatio,
            reference_images: references,
            expected_reference_sha256s: (scene.references || []).map(
              (r) => r.sha256,
            ),
          }),
        );
      }
      return outputs;
    },
    async images(pkg) {
      const outputs = {};
      for (const scene of pkg.scenes) {
        const references = await Promise.all(
          (scene.references || []).map((r) => dataReference(pkg, r)),
        );
        outputs[scene.id] = await checkpoint("image:" + scene.id, () =>
          glabsAsset(pkg, scene, "images", {
            prompt: scene.imagePrompt,
            model: pkg.visual.imageModel,
            aspect_ratio: pkg.visual.aspectRatio,
            reference_images: references,
          }),
        );
      }
      return outputs;
    },
    async creative_gate(pkg, ctx) {
      return ctx.creativeGate(pkg, ctx.results.start_frames || {});
    },
    async tts(pkg) {
      const outputs = {};
      for (const scene of pkg.scenes) {
        outputs[scene.id] = await checkpoint("tts:" + scene.id, async () => {
          const segments = scene.voiceSegments?.length
            ? scene.voiceSegments
            : [{ text: scene.narration, voice: pkg.audio.voice }];
          const clips = [];
          for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const voice =
              segment.voice ||
              pkg.audio.cast?.[segment.speaker] ||
              pkg.audio.voice;
            const jobStage = "tts_" + i;
            let connection;
            try {
              connection = await resolveConnection(
                pkg.tenantId,
                pkg.brandId,
                pkg.audio.provider === "gemini" ? "gemini" : "minimax",
              );
            } catch (e) {
              if (e.code !== "CONNECTION_REQUIRED") throw e;
              connection = await resolveConnection(
                pkg.tenantId,
                pkg.brandId,
                "gemini",
              );
            }
            let audio;
            try {
              audio = await providerJob(
                pkg,
                connection,
                scene.id,
                jobStage,
                {
                  text: segment.text,
                  voice,
                  speed: pkg.audio.speed,
                  volume: pkg.audio.volume,
                },
                async () => {
                  if (connection.kind === "gemini") {
                    const a = await gateway.gemini(connection, segment.text, {
                      audio: true,
                      voice,
                    });
                    const buffer = a.mime?.includes("wav")
                      ? a.buffer
                      : pcmToWav(a.buffer);
                    const asset = await save(
                      pkg,
                      "tts_segment",
                      buffer,
                      "audio/wav",
                      "wav",
                    );
                    return asset;
                  }
                  const result = await gateway.json(
                    connection,
                    "POST",
                    "v1/t2a_v2",
                    {
                      model: pkg.audio.model || "speech-2.8-turbo",
                      text: segment.text,
                      stream: false,
                      voice_setting: {
                        voice_id: connection.config.voices?.[voice] || voice,
                        speed: 1,
                        vol: 1,
                        pitch: 0,
                      },
                      audio_setting: {
                        sample_rate: 32000,
                        bitrate: 128000,
                        format: "mp3",
                        channel: 1,
                      },
                      language_boost: pkg.audio.language.startsWith("en")
                        ? "English"
                        : "Indonesian",
                      output_format: "hex",
                    },
                  );
                  if (result.base_resp?.status_code || !result.data?.audio)
                    throw new StudioError(
                      "TTS_FAILED",
                      "MiniMax belum menghasilkan audio.",
                    );
                  return save(
                    pkg,
                    "tts_segment",
                    Buffer.from(result.data.audio, "hex"),
                    "audio/mpeg",
                    "mp3",
                  );
                },
              );
            } catch (e) {
              if (
                connection.kind === "gemini" ||
                e.code === "PROVIDER_OUTCOME_UNKNOWN"
              )
                throw e;
              const fallback = await resolveConnection(
                pkg.tenantId,
                pkg.brandId,
                "gemini",
              );
              audio = await providerJob(
                pkg,
                fallback,
                scene.id,
                "tts_fallback_" + i,
                { text: segment.text, voice: "Puck" },
                async () => {
                  const a = await gateway.gemini(fallback, segment.text, {
                    audio: true,
                    voice: "Puck",
                  });
                  return save(
                    pkg,
                    "tts_fallback",
                    a.mime?.includes("wav") ? a.buffer : pcmToWav(a.buffer),
                    "audio/wav",
                    "wav",
                  );
                },
              );
            }
            clips.push(audio);
          }
          if (clips.length === 1) return clips[0];
          return temporary(async (dir) => {
            for (let i = 0; i < clips.length; i++)
              await writeFile(
                path.join(dir, i + ".wav"),
                (await loadArtifact(pkg.tenantId, clips[i].id)).buffer,
              );
            const args = clips.flatMap((_, i) => [
              "-i",
              path.join(dir, i + ".wav"),
            ]);
            const filter =
              clips.map((_, i) => `[${i}:a]`).join("") +
              `concat=n=${clips.length}:v=0:a=1[a]`;
            await mediaCommand([
              "-y",
              ...args,
              "-filter_complex",
              filter,
              "-map",
              "[a]",
              "-c:a",
              "pcm_s16le",
              path.join(dir, "out.wav"),
            ]);
            return save(
              pkg,
              "tts",
              await readFile(path.join(dir, "out.wav")),
              "audio/wav",
              "wav",
            );
          });
        });
      }
      return outputs;
    },
    async clips(pkg, ctx) {
      const outputs = {};
      for (const scene of pkg.scenes) {
        outputs[scene.id] = await checkpoint("clip:" + scene.id, async () => {
          const frame = ctx.results.start_frames?.[scene.id];
          const references = frame ? [await dataReference(pkg, frame)] : [];
          return glabsAsset(pkg, scene, "clips", {
            prompt:
              pkg.audioMode === "native"
                ? scene.videoPrompt
                : "silent video, mute, no sound: " + scene.videoPrompt,
            model: pkg.visual.videoModel,
            aspect_ratio: pkg.visual.aspectRatio,
            mode: scene.mode === "i2v" ? "start_image" : "text_to_video",
            video_length: scene.duration,
            duration: scene.duration,
            reference_images: references,
          });
        });
      }
      return outputs;
    },
    async ffmpeg(pkg, ctx) {
      return checkpoint("mux", () => muxPackage(pkg, ctx.results));
    },
    async artifacts(pkg, ctx) {
      return { final: ctx.results.ffmpeg };
    },
    async static_finishing(pkg, ctx) {
      return checkpoint("static_grid", () =>
        temporary(async (dir) => {
          const assets = Object.values(ctx.results.images);
          for (let i = 0; i < assets.length; i++)
            await writeFile(
              path.join(dir, i + ".png"),
              (await loadArtifact(pkg.tenantId, assets[i].id)).buffer,
            );
          const args = assets.flatMap((_, i) => [
            "-i",
            path.join(dir, i + ".png"),
          ]);
          const filters = assets.map(
            (_, i) =>
              `[${i}:v]scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`,
          );
          if (assets.length > 1)
            filters.push(
              assets.map((_, i) => `[v${i}]`).join("") +
                `vstack=inputs=${assets.length}[out]`,
            );
          await mediaCommand([
            "-y",
            ...args,
            "-filter_complex",
            filters.join(";"),
            "-map",
            assets.length === 1 ? "[v0]" : "[out]",
            "-frames:v",
            "1",
            path.join(dir, "grid.png"),
          ]);
          const image = await save(
            pkg,
            "static_final",
            await readFile(path.join(dir, "grid.png")),
            "image/png",
            "png",
          );
          const text = await save(
            pkg,
            "recipe_text",
            Buffer.from(
              JSON.stringify(
                { recipe: pkg.recipe, caption: pkg.caption },
                null,
                2,
              ),
            ),
            "application/json",
            "json",
          );
          return { final: image, text };
        }),
      );
    },
  };
}
export async function muxPackage(pkg, results) {
  return temporary(async (dir) => {
    const normalized = [];
    for (let i = 0; i < pkg.scenes.length; i++) {
      const scene = pkg.scenes[i],
        clip = results.clips[scene.id];
      const video = path.join(dir, i + ".mp4");
      await writeFile(
        video,
        (await loadArtifact(pkg.tenantId, clip.id)).buffer,
      );
      const args = ["-y", "-i", video];
      const audio = results.tts?.[scene.id];
      let audioDuration = 0;
      if (audio) {
        const f = path.join(dir, i + ".wav");
        await writeFile(f, (await loadArtifact(pkg.tenantId, audio.id)).buffer);
        audioDuration = (await duration(f)) / Number(pkg.audio.speed || 1);
        args.push("-i", f);
      }
      const probe = await exec(
        process.env.CF_FFPROBE_PATH || "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "a",
          "-show_entries",
          "stream=index",
          "-of",
          "csv=p=0",
          video,
        ],
        { timeout: 15000 },
      );
      const hasNativeAudio = Boolean(probe.stdout.trim());
      if (!Number.isFinite(pkg.mux.videoScale) || pkg.mux.videoScale <= 0)
        throw new StudioError(
          "VIDEO_SCALE_INVALID",
          "Skala durasi video harus lebih dari nol.",
        );
      if (!audio && !(pkg.audioMode === "native" && hasNativeAudio))
        args.push(
          "-f",
          "lavfi",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
        );
      const videoDuration = await duration(video),
        sync = smartSync(videoDuration, audioDuration, pkg.mux.videoScale);
      const mode = pkg.mux.syncOption || "smart_sync";
      if (!["smart_sync", "trim_video", "stretch_video", "none"].includes(mode))
        throw new StudioError(
          "MUX_MODE_UNSUPPORTED",
          "Mode sinkronisasi belum didukung.",
        );
      const scale =
        mode === "stretch_video" && audio
          ? audioDuration / videoDuration
          : pkg.mux.videoScale;
      const dimensions = {
        "9:16": [720, 1280],
        "16:9": [1280, 720],
        "1:1": [1080, 1080],
      }[pkg.visual.aspectRatio];
      if (!dimensions)
        throw new StudioError(
          "ASPECT_RATIO_INVALID",
          "Rasio video tidak didukung.",
        );
      const [width, height] = dimensions;
      const filter =
        `setpts=${Number(scale)}*PTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30` +
        (mode === "smart_sync" && sync.freezeSeconds > 0
          ? `,tpad=stop_mode=clone:stop_duration=${sync.freezeSeconds}`
          : "");
      args.push("-vf", filter, "-map", "0:v:0");
      if (audio) {
        const speed = Number(pkg.audio.speed ?? 1);
        if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
          throw new StudioError(
            "VOICE_SPEED_INVALID",
            "Kecepatan VO harus antara 0.5 dan 2.",
          );
        if (hasNativeAudio && pkg.mux.sfxVolume > 0)
          args.push(
            "-filter_complex",
            `[1:a]atempo=${speed},apad,volume=${Number(pkg.audio.volume)}[vo];[0:a]apad,volume=${Number(pkg.mux.sfxVolume)}[sfx];[vo][sfx]amix=inputs=2:duration=first:normalize=0[mixed]`,
            "-map",
            "[mixed]",
          );
        else
          args.push(
            "-map",
            "1:a:0",
            "-af",
            `atempo=${speed},apad,volume=${Number(pkg.audio.volume)}`,
          );
      } else if (pkg.audioMode === "native" && hasNativeAudio)
        args.push("-map", "0:a:0");
      else args.push("-map", "1:a:0");
      const outputDuration =
        mode === "trim_video" && audio
          ? Math.min(videoDuration, audioDuration)
          : mode === "stretch_video" && audio
            ? audioDuration
            : mode === "smart_sync"
              ? sync.outputDuration
              : sync.videoDuration;
      const out = path.join(dir, "norm-" + i + ".mp4");
      args.push(
        "-t",
        String(outputDuration),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        out,
      );
      await mediaCommand(args);
      normalized.push(out);
    }
    const list = path.join(dir, "list.txt");
    await writeFile(list, normalized.map((f) => `file '${f}'`).join("\n"));
    let out = path.join(dir, "final.mp4");
    await mediaCommand([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      out,
    ]);
    if (pkg.mux.bgmArtifactId) {
      const bgm = path.join(dir, "bgm.audio");
      await writeFile(
        bgm,
        (await loadArtifact(pkg.tenantId, pkg.mux.bgmArtifactId)).buffer,
      );
      const mixed = path.join(dir, "mixed.mp4");
      await mediaCommand([
        "-y",
        "-i",
        out,
        "-stream_loop",
        "-1",
        "-i",
        bgm,
        "-filter_complex",
        `[1:a]volume=${Number(pkg.mux.bgmVolume)}[bg];[0:a][bg]amix=inputs=2:duration=first[a]`,
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        mixed,
      ]);
      out = mixed;
    }
    return save(pkg, "video_final", await readFile(out), "video/mp4", "mp4");
  });
}
