# Changelog

## 3.0.0-alpha.4 — 2 November 2026
- Tema terang menjadi default sejak HTML awal, termasuk halaman login; tombol ganti tema tetap tersedia.

## 3.0.0-alpha.3 — 1 November 2026
- Settings khusus Gemini pool, MiniMax, G-Labs dan Repliz + Google Drive; konfigurasi bot Telegram tetap tersedia.
- Pool tenant terenkripsi dengan anggaran project/key, reservasi atomik, cooldown persisten dan pemeriksaan tersamarkan; planner/creative/analisis/TTS memakai gateway bersama.
- OAuth CF Studio, refresh terenkripsi, folder tenant, upload idempotent, verifikasi unduh anonim serta retensi salinan publishing.
- Repliz memakai salinan Drive hanya setelah approval; kegagalan sebelum POST aman untuk pemulihan, hasil POST ambigu tidak dikirim ulang.
- Tes provider tiruan/SQL/FFmpeg, concurrency PostgreSQL aktual dan backup/restore lokal; pengujian layanan nyata tetap gate pilot.

## 3.0.0-alpha.2 — 1 November 2026
- PostgreSQL development terpisah dan trial import 309 objek/preset dengan 67 media terverifikasi.
- UI lima menu, empat tab Automation, brand preset/identity, katalog upload/analysis, routine snapshots dan Daily Review.
- Shared production worker, G-Labs routing/checkpoint, VO/FFmpeg, Telegram outbox serta Repliz intent/cancel/reconcile.
- Pengujian SQL/worker/provider tiruan/FFmpeg dan restore drill; dispatch provider tetap OFF.
- Gate provider nyata, parity V2, pilot, remote dan deployment tetap terbuka; bukan rilis production.

## 3.0.0-alpha.1
- Fondasi aplikasi terpisah, kontrak pipeline bersama, dan perencanaan migrasi staging.
