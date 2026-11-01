# Status implementasi CF Studio V3 — alpha.5

**Tanggal:** 1 November 2026. **Status:** implementasi lokal dan verifikasi terkontrol; belum final production-ready.

## Yang sudah berfungsi di lokal

| Area | Bukti |
|---|---|
| Database/auth/tenant | PostgreSQL 17 terpisah; delapan migrasi; login/sesi/origin dan API aktual lulus smoke; tenant/brand/capability diuji |
| Menu katalog | 5 menu; CRUD arsip; brand → Preset / Visual Identity; reuse existing assignment; upload dan analisis durable |
| Automation | Empat tab; target lima jenis; draft/active snapshots; run once; timezone; missed slot; claim/heartbeat/fencing |
| Pipeline | Empat sumber video memakai executor yang sama; Multiplier satu creative call; Recipe/Editorial/Product memakai planner lebih dahulu; CEP output-only |
| Media | G-Labs gateway/task ledger; source checksum; single/multi voice dan MiniMax/Gemini fallback diimplementasikan; common I2V/T2V/native, FFmpeg dan static grid/text diuji lokal; parity seluruh variasi tetap gate pilot |
| Review | Creative manual/auto preset; final manual exact revision; caption edit; regenerate; archive; self-approval dua izin |
| Telegram | Challenge private chat; scoped recipients; quiet hours; grouped error/escalation/recovery/partial summary; durable outbox; fake transport diuji |
| Repliz | Explicit account mapping; media/approval preflight; durable intent; cancel; unknown guard; automatic/manual reconciliation; published proof |
| Pemulihan | Backup lokal + restore drill lulus; source V2 tidak ditulis |

## Trial import default tenant

| Domain | Jumlah |
|---|---:|
| Product | 27 |
| Deconstruct | 202 |
| Brand | 7 |
| Preset | 23: 21 tenant + 2 sistem |
| Visual Identity | 12: 6 tenant + 6 sistem |
| Product–brand binding | 23 |
| Dependency | 15: 9 batch Deconstruct + 6 universe |
| Total | 309 |

Import awal `beb8bf64-3668-418e-bf23-63d927e5ccc1`; pengulangan `9bfb534e-8907-482f-9902-ff77d9466a17`: insert/update 0, reuse 309, conflict 0, unresolved binding 0. Media: 67 file / 34,406,141 byte terverifikasi; 199 referensi hilang; 2 API route dan 2 Drive URL belum dibuktikan. 15 foto approved memiliki reference canonical terverifikasi. Analisis yang tersedia dipertahankan; ketiadaan video sumber tetap membatasi preview/reanalysis.

Preset tanpa assignment brand tetap berada di koleksi tenant. Pengguna memilih dan menautkannya; tidak dibuat ulang dan tidak dipetakan otomatis dari nama.

## Verifikasi

- 62 tes kontrak/SQL/worker/provider tiruan dan FFmpeg lokal lulus; mencakup pool, OAuth, Drive recovery, retensi dan penghalang Repliz saat public download gagal. Build/HTTP smoke alpha.3 dicatat pada penutupan di bawah.
- Kelima jalur menghasilkan artifact pada pengujian terkontrol, termasuk resep statis tanpa TTS/klip dan native video tanpa audio input.
- Unknown POST tidak dikirim dua kali, jadwal idempotent, revision approval invalidation, active snapshot anti-forgery, stale fencing, rate-limit retry, route pinning G-Labs dan konflik analisis diuji.
- HTTP smoke memakai akun lokal/environment tanpa mencetak credential; counts katalog sesuai tabel. Uji mutasi aktual mencakup upload/review foto dan dua edit konkuren (satu berhasil, satu 409); data uji diarsipkan.
- Final build alpha.2 lulus; npm audit seluruh dependency: 0 vulnerability. Delapan migrasi terpasang. Rilis `v3.0.0-alpha.2` / commit `f97fd041985a0e0e207c1c00e8b2ce9efce9da7d` telah diunggah ke main repository CF Studio; SHA dan tag remote diverifikasi. CI GitHub [41280372228](https://github.com/sabeq83/cfstudio/actions/runs/41280372228) completed/success.
- Source staging read-only; tidak ada panggilan provider hidup, pesan Telegram nyata atau publikasi nyata selama pengujian.

## Gate yang belum selesai

1. Isi koneksi CF Studio melalui Setting/environment. Belum ada koneksi Gemini/G-Labs/MiniMax/Telegram/Repliz nyata yang diisi pada database lokal.
2. Bandingkan hasil nyata dengan golden output V2. Kontrak/preset/helper diadopsi, tetapi adapter dan prompt baru belum membuktikan parity kualitas seluruh fitur V2, khususnya mode Visual Identity/visual universe kompleks, native dialogue/cast serta variasi durasi/model provider.
3. Pilot Nutribake dengan batch sasaran, verifikasi Telegram nyata, Repliz/media HTTPS, failure recovery, biaya/kapasitas dan waktu dispatch. Fake transport tidak menggantikan pilot ini.
4. Media 199 referensi hilang tetap exception. Scraper URL marketplace V2, bulk ingestion V2, serta bot webhook/penanganan trafik besar belum diadopsi penuh; versi ini menyediakan input deskripsi, upload dan analisis baru.
5. Jalur salinan Google Drive dengan retensi sesuai jadwal sudah diimplementasikan; OAuth, public sharing dan konsumsi Repliz nyata tetap perlu dibuktikan. Tidak ada lagi fallback signed localhost URL.
6. Final snapshot/delta migration/cutover, remote CF Studio dikonfirmasi ke https://github.com/sabeq83/cfstudio.git; deployment target belum ditetapkan/diuji. Worker belum dipasang sebagai service boot otomatis. Production tidak dideploy.

Karena gate di atas, Fase 5D dan penerimaan live Fase 6–8 tetap terbuka. Jangan menyatakan seluruh fase selesai atau produksi siap hanya karena build dan pengujian lokal lulus.

## Settings adoption alpha.3

Empat panel khusus, bot Telegram, tenant Gemini pool, default provider, G-Labs pacing/pola start frame, OAuth Drive terenkripsi dan staging/retensi terhubung ke Repliz. Semua panggilan pengujian provider memakai transport tiruan. Tidak ada credential/token V2 diaktifkan. PostgreSQL aktual diuji dengan 8 reservasi bersamaan (2 slot, 3 budget harian); tidak melewati batas. Backup dengan delapan migrasi dan restore drill lulus.

Konfigurasi layanan/OAuth nyata belum diisi; dispatch tetap OFF. Pilot nyata dan gate fase sebelumnya tetap terbuka.

Alpha.3 penutupan lokal: 62/62 tes, build, API aktual termasuk Settings, pemeriksaan tampilan empat panel, npm audit 0 vulnerability, backup/restore dan concurrency PostgreSQL lulus. Server lokal diperbarui pada port 3100. Jumlah impor tidak berubah.

Rilis `v3.0.0-alpha.3` / kode `b0854f39881b8ba19769ef7eb03669aea8e70bca` telah diunggah dan tag remote diverifikasi. CI [41320861832](https://github.com/sabeq83/cfstudio/actions/runs/41320861832) dan [41320861800](https://github.com/sabeq83/cfstudio/actions/runs/41320861800) completed/success.

## Gemini V2 parity alpha.5
UI dan API mengikuti mockup yang disetujui, tanpa Project group/TTS model/timezone pada editor. Anggaran/cooldown per key, impor live precheck, masked diagnostics, arsip/pulihkan, tier/model/fallback/routing dan cache diimplementasikan. Riwayat project lama dipertahankan, tidak lagi mengatur kapasitas baru. Seluruh tes layanan menggunakan transport tiruan; koneksi nyata, katalog model yang tersedia dan manfaat cache tetap membutuhkan pilot.

Alpha.5 verifikasi: 71 tes lulus; build dan API aktual Settings termasuk mutasi tenant sementara lulus; isolasi/concurrency PostgreSQL, delapan migrasi, backup/restore dan npm audit 0 vulnerability lulus. Tampilan aktual tersedia pada port 3100, termasuk Single/Bulk dan Free Tier cache-off. Data uji tenant sementara dibersihkan. Dispatch tetap OFF, koneksi/model/cache nyata tetap gate pilot.
