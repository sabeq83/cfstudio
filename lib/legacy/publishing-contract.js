/**
 * Publishing Scheduler Contract & Constants Module
 * Standardizes lifecycle statuses, platform definitions, input validation, and provider error classification.
 */

export const PUBLISHING_PLATFORMS = [
  'facebook', 'instagram', 'threads', 'tiktok', 'linkedin', 'youtube'
];

export const PUBLISHING_MODES = ['draft', 'live'];

export const PUBLISHING_STATUSES = [
  'validating',
  'scheduled',
  'processing',
  'creating_container',
  'uploading_media',
  'waiting_media',
  'publishing',
  'verifying',
  'retry_wait',
  'draft_created',
  'published',
  'failed',
  'needs_review',
  'cancelled'
];

export const APPROVAL_STATUSES = [
  'not_required',
  'pending_approval',
  'approved',
  'rejected'
];

export const MEDIA_TYPES = [
  'text_only',
  'image',
  'video',
  'reels'
];

export const FACEBOOK_REELS_STAGES = [
  'creating_container',
  'uploading_media',
  'waiting_media',
  'publishing',
  'verifying'
];

export function validatePlatformMediaContract({ platform, mediaType, publishMode }) {
  if (!['facebook', 'instagram'].includes(platform)) {
    throw new Error(`Platform Meta harus salah satu dari: facebook, instagram`);
  }
  if (!MEDIA_TYPES.includes(mediaType)) {
    throw new Error(`media_type harus salah satu dari: ${MEDIA_TYPES.join(', ')}`);
  }
  if (!PUBLISHING_MODES.includes(publishMode)) {
    throw new Error(`publish_mode harus salah satu dari: ${PUBLISHING_MODES.join(', ')}`);
  }
  if (platform === 'instagram' && publishMode === 'draft') {
    throw new Error('Instagram draft belum didukung. Pilih mode live agar tidak terjadi publikasi diam-diam.');
  }
  if (platform === 'instagram' && mediaType === 'text_only') {
    throw new Error('Instagram membutuhkan media image, video, atau reels.');
  }
  return { platform, mediaType, publishMode };
}

export function validateProviderMediaContract({ provider, platform, mediaType, publishMode }) {
  if (provider === 'repliz') {
    if (!PUBLISHING_PLATFORMS.includes(platform)) {
      throw new Error(`Platform Repliz harus salah satu dari: ${PUBLISHING_PLATFORMS.join(', ')}`);
    }
    if (!MEDIA_TYPES.includes(mediaType)) {
      throw new Error(`media_type harus salah satu dari: ${MEDIA_TYPES.join(', ')}`);
    }
    if (!PUBLISHING_MODES.includes(publishMode)) {
      throw new Error(`publish_mode harus salah satu dari: ${PUBLISHING_MODES.join(', ')}`);
    }
    if (mediaType === 'text_only') {
      throw new Error('Repliz membutuhkan media image, video, atau reels.');
    }
    return { platform, mediaType, publishMode };
  }
  return validatePlatformMediaContract({ platform, mediaType, publishMode });
}

/**
 * Sanitasi pesan error agar tidak membocorkan access token, secret, atau raw private URL.
 * @param {string|Error} err 
 * @returns {string}
 */
export function sanitizeErrorMessage(err) {
  if (!err) return 'Unknown error';
  let message = typeof err === 'string' ? err : (err.message || String(err));

  // Mask tokens
  message = message.replace(/(access_token|token|key|secret|password)=([^\s&"'`]+)/gi, '$1=***REDACTED***');
  message = message.replace(/EAA[A-Za-z0-9]+/g, '***TOKEN_REDACTED***');
  message = message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***TOKEN_REDACTED***');

  // Shorten excessively long error messages
  if (message.length > 500) {
    message = message.substring(0, 497) + '...';
  }

  return message;
}

/**
 * Validasi payload penjadwalan publikasi.
 * @param {Object} input 
 * @returns {Object} Normalized input or throws error
 */
export function validateScheduleRequest(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Payload jadwal tidak valid.');
  }

  const {
    content_id,
    account_ids, // array or single
    platform,    // optional if account provides it, or explicit
    publish_mode = 'live',
    media_type = 'text_only',
    title = '',
    caption = '',
    media_url = '',
    scheduled_at,
    schedules = {},
    timezone = 'Asia/Jakarta',
    is_ai_generated
  } = input;


  if (!content_id || typeof content_id !== 'string') {
    throw new Error('content_id wajib diisi.');
  }

  const accounts = Array.isArray(account_ids) ? account_ids : (input.account_id ? [input.account_id] : []);
  if (accounts.length === 0) {
    throw new Error('Minimal satu account_id wajib dipilih.');
  }

  if (!PUBLISHING_MODES.includes(publish_mode)) {
    throw new Error(`publish_mode harus salah satu dari: ${PUBLISHING_MODES.join(', ')}`);
  }

  if (!MEDIA_TYPES.includes(media_type)) {
    throw new Error(`media_type harus salah satu dari: ${MEDIA_TYPES.join(', ')}`);
  }

  if ((media_type === 'image' || media_type === 'video' || media_type === 'reels') && !media_url) {
    throw new Error(`media_url wajib diisi untuk media type '${media_type}'.`);
  }

  if (!scheduled_at) {
    throw new Error('scheduled_at wajib diisi.');
  }

  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime())) {
    throw new Error('Format scheduled_at tidak valid (gunakan format ISO 8601 UTC).');
  }

  const validatedSchedules = {};
  if (schedules && typeof schedules === 'object') {
    for (const [accId, timeVal] of Object.entries(schedules)) {
      if (timeVal) {
        const d = new Date(timeVal);
        if (!isNaN(d.getTime())) {
          validatedSchedules[accId] = d.toISOString();
        }
      }
    }
  }

  const isAiGen = is_ai_generated !== undefined
    ? !!is_ai_generated
    : (platform === 'tiktok' ? true : false);

  return {
    content_id: content_id.trim(),
    account_ids: accounts.map(a => String(a).trim()),
    platform: platform ? String(platform).trim().toLowerCase() : null,
    publish_mode,
    media_type,
    title: String(title || '').trim().replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 100),
    caption: String(caption || '').trim(),
    media_url: String(media_url || '').trim(),
    scheduled_at: scheduledDate.toISOString(),
    schedules: validatedSchedules,
    timezone: timezone || 'Asia/Jakarta',
    is_ai_generated: isAiGen
  };
}

/**
 * Klasifikasi kegagalan dari Meta Graph API / Provider:
 * - 'transient': error sementara (429, timeout sebelum respon, network connection reset) -> boleh retry backoff
 * - 'permanent': error permanen (401 invalid token, 403 permission denied, 400 bad request / invalid media format) -> status 'failed'
 * - 'unknown_outcome': request publish mungkin sudah terkirim tapi timeout di response -> status 'verifying'
 * - 'needs_review': butuh perhatian operator (misal token expired atau container rejected)
 */
export function classifyProviderFailure(error, httpStatus = 0, stage = 'publishing') {
  const message = (error?.message || String(error || '')).toLowerCase();
  const code = error?.code || error?.error_code || error?.error?.code || null;
  const subcode = error?.error_subcode || error?.error?.error_subcode || null;

  // Unknown outcome: network timeout during the critical publishing step
  if (stage === 'publishing' && (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('esockettimedout') ||
    message.includes('network error') ||
    message.includes('aborted')
  )) {
    return {
      type: 'unknown_outcome',
      shouldRetryImmediately: false,
      targetStatus: 'verifying',
      reason: 'Network timeout saat proses publikasi. Menunggu verifikasi status eksternal.'
    };
  }

  // Transient / Rate limit / Provider 5xx
  if (
    httpStatus === 429 ||
    httpStatus >= 500 ||
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 || // Rate limit Graph API
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('temporarily unavailable') ||
    message.includes('please reduce the amount of data')
  ) {
    return {
      type: 'transient',
      shouldRetryImmediately: false,
      targetStatus: 'retry_wait',
      reason: 'Gangguan sementara provider atau limit kuota.'
    };
  }

  // Google Drive Staging / OAuth Errors
  if (
    code === 'GOOGLE_REAUTH_REQUIRED' ||
    code === 'GOOGLE_DRIVE_FOLDER_MISSING' ||
    code === 'GOOGLE_DRIVE_PERMISSION_ERROR' ||
    code === 'GOOGLE_DRIVE_FOLDER_INVALID' ||
    code === 'GOOGLE_DRIVE_FOLDER_NOT_FOUND' ||
    message.includes('google_reauth_required') ||
    message.includes('invalid_grant')
  ) {
    return {
      type: 'needs_review',
      shouldRetryImmediately: false,
      targetStatus: 'needs_review',
      reason: 'Koneksi atau folder Google Drive untuk staging publikasi bermasalah. Perlu perbaikan di Settings.'
    };
  }

  if (code === 'GOOGLE_TEMPORARILY_UNAVAILABLE') {
    return {
      type: 'transient',
      shouldRetryImmediately: false,
      targetStatus: 'retry_wait',
      reason: 'Layanan Google Drive sementara tidak dapat dihubungi.'
    };
  }

  // Token / Permission issues -> needs_review / operator action
  if (
    code === 190 || // Invalid OAuth access token
    code === 10 ||  // Permission denied
    subcode === 463 || // Expired token
    subcode === 467 ||
    message.includes('session has expired') ||
    message.includes('access token') ||
    message.includes('permission')
  ) {
    return {
      type: 'needs_review',
      shouldRetryImmediately: false,
      targetStatus: 'needs_review',
      reason: 'Token akses atau izin Meta kedaluwarsa/tidak sah. Perlu perbaikan akun.'
    };
  }

  // Permanent failure
  return {
    type: 'permanent',
    shouldRetryImmediately: false,
    targetStatus: 'failed',
    reason: 'Gagal permanen pada validasi Meta Graph API.'

  };
}

/**
 * Hitung delay exponential backoff untuk retry dengan jitter.
 * @param {number} attemptCount (1-indexed)
 * @returns {number} Delay in milliseconds
 */
export function calculateRetryDelay(attemptCount) {
  // Base intervals: 1 min, 5 min, 15 min
  const baseDelays = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
  const baseMs = baseDelays[Math.min(attemptCount - 1, baseDelays.length - 1)] || 15 * 60 * 1000;
  
  // Tambahkan jitter +/- 20%
  const jitterFactor = 0.8 + Math.random() * 0.4;
  return Math.round(baseMs * jitterFactor);
}

/**
 * Klasifikasi error deterministik dari Repliz Provider (Facebook & TikTok).
 * Mengembalikan objek failure terstruktur yang disanitasi.
 */
export function classifyReplizFailure({
  platform = '',
  status = '',
  errorMessage = '',
  errorCode = null,
  httpStatus = 0
} = {}) {
  const plat = String(platform || '').toLowerCase().trim();
  const rawMsg = String(errorMessage || '').trim();
  const msg = rawMsg.toLowerCase();
  const code = String(errorCode || '').toUpperCase().trim();
  const http = parseInt(httpStatus || 0, 10);

  // 1. Facebook Permission / Object Access / Graph API Auth Errors
  if (
    plat === 'facebook' &&
    (
      msg.includes('unsupported get request') ||
      msg.includes('object with id') ||
      msg.includes('does not exist') ||
      msg.includes('cannot be loaded due to missing permissions') ||
      msg.includes('permissions issue') ||
      msg.includes('permission') ||
      msg.includes('oauth') ||
      msg.includes('access token') ||
      msg.includes('session has expired') ||
      code.includes('PERMISSION') ||
      code.includes('OAUTH') ||
      code.includes('UNSUPPORTED_GET_REQUEST') ||
      code === '190' || code === '10' || code === '200' || code === '803'
    )
  ) {
    return {
      code: 'REPLIZ_FACEBOOK_PERMISSION_REQUIRED',
      class: 'account_action_required',
      retryable: false,
      targetStatus: 'needs_review',
      provider: 'repliz',
      platform: 'facebook',
      providerStatus: status || 'error',
      providerErrorCode: errorCode || 'OBJECT_OR_PERMISSION_ERROR',
      message: 'Koneksi atau izin Facebook Page di Repliz kedaluwarsa / memerlukan otorisasi ulang.',
      rawMessage: sanitizeErrorMessage(rawMsg),
      action: 'reconnect_account'
    };
  }

  // 2. TikTok / Repliz Internal Transient Errors
  if (
    msg === 'internal' ||
    msg.includes('internal error') ||
    msg.includes('internal server error') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('timeout') ||
    http === 429 ||
    http >= 500 ||
    code === 'INTERNAL' ||
    code === 'INTERNAL_SERVER_ERROR' ||
    code === 'TIMEOUT' ||
    code === 'RATE_LIMIT'
  ) {
    return {
      code: 'REPLIZ_TIKTOK_INTERNAL',
      class: 'provider_transient',
      retryable: true,
      targetStatus: 'retry_wait',
      provider: 'repliz',
      platform: plat || 'repliz',
      providerStatus: status || 'error',
      providerErrorCode: errorCode || 'INTERNAL',
      message: 'Gangguan internal sementara pada penyedia platform (TikTok/Repliz).',
      rawMessage: sanitizeErrorMessage(rawMsg),
      action: 'retry_later'
    };
  }

  // 3. Media Invalid / Format Unsupported
  if (
    msg.includes('invalid_file') ||
    msg.includes('unsupported media') ||
    msg.includes('unsupported format') ||
    msg.includes('corrupt') ||
    msg.includes('aspect ratio') ||
    msg.includes('media error') ||
    code.includes('MEDIA')
  ) {
    return {
      code: 'REPLIZ_MEDIA_INVALID',
      class: 'media_invalid',
      retryable: false,
      targetStatus: 'needs_review',
      provider: 'repliz',
      platform: plat || 'repliz',
      providerStatus: status || 'error',
      providerErrorCode: errorCode || 'MEDIA_INVALID',
      message: 'Format atau file media ditolak oleh platform.',
      rawMessage: sanitizeErrorMessage(rawMsg),
      action: 'replace_media'
    };
  }

  // 4. Request Payload Invalid
  if (
    msg.includes('validation error') ||
    msg.includes('invalid parameter') ||
    msg.includes('missing required') ||
    http === 400
  ) {
    return {
      code: 'REPLIZ_REQUEST_INVALID',
      class: 'request_invalid',
      retryable: false,
      targetStatus: 'failed',
      provider: 'repliz',
      platform: plat || 'repliz',
      providerStatus: status || 'error',
      providerErrorCode: errorCode || 'REQUEST_INVALID',
      message: 'Payload request jadwal tidak valid.',
      rawMessage: sanitizeErrorMessage(rawMsg),
      action: 'review'
    };
  }

  // 5. Fallback Unknown
  return {
    code: 'REPLIZ_UNKNOWN_ERROR',
    class: 'unknown',
    retryable: false,
    targetStatus: 'needs_review',
    provider: 'repliz',
    platform: plat || 'repliz',
    providerStatus: status || 'error',
    providerErrorCode: errorCode || 'UNKNOWN',
    message: rawMsg ? sanitizeErrorMessage(rawMsg) : 'Terjadi kegagalan pada proses eksekusi provider.',
    rawMessage: sanitizeErrorMessage(rawMsg),
    action: 'review'
  };
}

