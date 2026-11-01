/**
 * Multiplier Audio Config Normalizer & Synchronizer
 * Memastikan kompatibilitas dual-casing (camelCase & snake_case)
 * agar perubahan slider / workflow rendering tidak mereset voice persona.
 */

export function normalizeAudioConfig(rawInput) {
  let raw = rawInput;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw || '{}');
    } catch (_) {
      raw = {};
    }
  }
  raw = raw || {};

  const voiceProvider = raw.voice_provider || raw.voiceProvider || 'minimax';
  const voicePersona = raw.voice_persona || raw.voicePersona || (voiceProvider === 'gemini' ? 'Kore' : 'Indonesian_casual_reporter_vv2');
  const voiceSpeed = raw.voice_speed !== undefined ? Number(raw.voice_speed) : (raw.voiceSpeed !== undefined ? Number(raw.voiceSpeed) : 1.0);
  const voiceVolume = raw.voice_volume !== undefined ? Number(raw.voice_volume) : (raw.voiceVolume !== undefined ? Number(raw.voiceVolume) : 1.0);
  const enableTts = raw.enable_tts !== undefined ? Boolean(raw.enable_tts) : (raw.enableTts !== undefined ? Boolean(raw.enableTts) : true);
  const enableGlabs = raw.enable_glabs !== undefined ? Boolean(raw.enable_glabs) : (raw.enableGlabs !== undefined ? Boolean(raw.enableGlabs) : true);
  const enableFfmpeg = raw.enable_ffmpeg !== undefined ? Boolean(raw.enable_ffmpeg) : (raw.enableFfmpeg !== undefined ? Boolean(raw.enableFfmpeg) : true);
  const ffmpegSyncOption = raw.ffmpeg_sync_option || raw.ffmpegSyncOption || 'smart_sync';
  const ffmpegVideoScale = raw.ffmpeg_video_scale !== undefined ? Number(raw.ffmpeg_video_scale) : (raw.ffmpegVideoScale !== undefined ? Number(raw.ffmpegVideoScale) : 1.1);
  const ffmpegSfxVolume = 0.00;
  const ffmpegBgmVolume = 0.00;

  return {
    ...raw,
    voice_provider: voiceProvider,
    voiceProvider,
    voice_persona: voicePersona,
    voicePersona,
    voice_speed: voiceSpeed,
    voiceSpeed,
    voice_volume: voiceVolume,
    voiceVolume,
    enable_tts: enableTts,
    enableTts,
    enable_glabs: enableGlabs,
    enableGlabs,
    enable_ffmpeg: enableFfmpeg,
    enableFfmpeg,
    ffmpeg_sync_option: ffmpegSyncOption,
    ffmpegSyncOption,
    ffmpeg_video_scale: ffmpegVideoScale,
    ffmpegVideoScale,
    ffmpeg_sfx_volume: ffmpegSfxVolume,
    ffmpegSfxVolume,
    ffmpeg_bgm_volume: ffmpegBgmVolume,
    ffmpegBgmVolume
  };
}

export function syncAudioConfigKeyValue(currentConfig, key, value) {
  const normalized = normalizeAudioConfig(currentConfig);
  const updated = { ...normalized, [key]: value };

  if (key === 'voice_provider') updated.voiceProvider = value;
  if (key === 'voiceProvider') updated.voice_provider = value;
  if (key === 'voice_persona') updated.voicePersona = value;
  if (key === 'voicePersona') updated.voice_persona = value;
  if (key === 'voice_speed') updated.voiceSpeed = Number(value);
  if (key === 'voiceSpeed') updated.voice_speed = Number(value);
  if (key === 'voice_volume') updated.voiceVolume = Number(value);
  if (key === 'voiceVolume') updated.voice_volume = Number(value);
  if (key === 'enable_tts') updated.enableTts = Boolean(value);
  if (key === 'enableTts') updated.enable_tts = Boolean(value);
  if (key === 'enable_glabs') updated.enableGlabs = Boolean(value);
  if (key === 'enableGlabs') updated.enable_glabs = Boolean(value);
  if (key === 'enable_ffmpeg') updated.enableFfmpeg = Boolean(value);
  if (key === 'enableFfmpeg') updated.enable_ffmpeg = Boolean(value);
  if (key === 'ffmpeg_sync_option') updated.ffmpegSyncOption = value;
  if (key === 'ffmpegSyncOption') updated.ffmpeg_sync_option = value;
  if (key === 'ffmpeg_video_scale') updated.ffmpegVideoScale = Number(value);
  if (key === 'ffmpegVideoScale') updated.ffmpeg_video_scale = Number(value);

  return updated;
}
