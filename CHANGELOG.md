## 3.0.0-alpha.8 — G-Labs V2 configuration
- V2-style host/port, model choices, masked key replacement, safety delay and T2I controls.
- Authorized draft health diagnostics without generation; saved HTTPS/custom models preserved.
- Stable per-tenant worker lanes across connection revisions and completion-relative Sequential spacing.
- Migration 009 retains historical jobs/routes and conservatively counts unknown submissions.

# Changelog

## 3.0.0-alpha.7 — 2 November 2026
- Tab MiniMax menjadi satu input API key dengan simpan/ganti; pengaturan suara tetap mengikuti preset dan default tersimpan.
- Executor TTS bersama memakai empat endpoint V2 berurutan dengan rotasi terbatas untuk penolakan eksplisit dan kegagalan sebelum koneksi.
- Key salah, saldo/kuota habis, parameter ditolak dan hasil POST ambigu berhenti tanpa berpindah provider.
- Pengujian mencakup payload preset, ledger unknown, rotasi endpoint dan artifact MP3 nyata menggunakan transport tiruan.

## 3.0.0-alpha.6 — 2 November 2026
- Free Tier menjadi default konfigurasi Gemini baru dan mockup; pilihan Paid Tier yang tersimpan tetap dipertahankan.

## 3.0.0-alpha.5 — 2 November 2026
- Gemini Settings mengikuti mockup V2: ringkasan/progress, Single/Bulk, validasi impor, status filter, pause, arsip invalid dan pulihkan.
- Project group dihapus dari operasi baru; batas, cooldown dan reservasi dihitung per key, riwayat lama dipertahankan.
- Model Paid/Free, primary/custom, fallback berurutan, routing modul dan Context Caching terhubung ke gateway; konfigurasi rutinitas dibekukan.
- Input Gemini TTS dan zona waktu dihapus dari UI; konfigurasi internal lama tetap dipertahankan.
- Fallback hanya sesudah penolakan eksplisit yang aman; hasil POST ambigu tidak diulang otomatis.

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
