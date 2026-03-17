/* global CONFIG */
'use strict';

const CONFIG = {
  // ── Replace with your actual Render backend URL after first deploy ──
  API_BASE: 'https://mychat-v7-backend.onrender.com/api',

  PEERJS_CONFIG: { debug: 0 },

  MAX_FILE_SIZE_MB:       25,
  CHUNK_SIZE_BYTES:       16384,
  ROOM_ID_LENGTH:         6,
  PERMANENT_ID_MAX:       8,
  PERMANENT_ID_MIN:       3,
  TOTP_WINDOW_SECONDS:    300,
  MAX_SCREENSHOT_STRIKES: 3,
  PING_INTERVAL_MS:       10000,
  PING_TIMEOUT_MS:        15000,
  TYPING_DEBOUNCE_MS:     2000,
  TYPING_CLEAR_MS:        3000,
  VOICE_MAX_MS:           300000,  // 5 minutes
  MAX_GROUP_SIZE:         50,
  HEALTH_TIMEOUT_MS:      2000,
  HEALTH_POLL_MS:         3000,
  KEEPALIVE_MS:           840000   // 14 minutes
};
