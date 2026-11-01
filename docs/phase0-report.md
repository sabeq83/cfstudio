# Fase 0 — Baseline dan Inventory CF Studio

Tanggal: 1 November 2026. Status: audit selesai; gate keputusan baseline kode masih menunggu jawaban pengguna. Tidak ada migrasi apply atau perubahan sumber.

## Keputusan terkonfirmasi

- Root CF Studio: `/Users/sabeqmmursyid/_cfstudio`.
- Data sumber: schema `staging`, `default_tenant` terverifikasi aktif.
- Tujuan: PostgreSQL khusus CF Studio, storage terpisah, tenant tujuan default tenant.
- Pengembangan lokal port 3100; akun CF Studio baru, role V2 dipetakan ke capability baru.
- Remote Git dan deployment host ditetapkan sebelum rilis.
- Database tujuan belum dikonfigurasi; `.env.local` belum tersedia saat pengecekan. Ini menghalangi fase migrasi apply, bukan kegiatan inventarisasi baca-saja.

## Dua baseline kode yang berbeda

| Baseline | SHA |
|---|---|
| Checkout V2 lokal yang diaudit | `6c645e5cdf84d47d86a7e142c6e5679ba7bd25f2` |
| Release staging yang sedang aktif | `6cb518f7d16b4451f393c9107f4a2b66ae98b533` |

Pemilihan baseline kode telah ditanyakan. Data tetap dari staging terlepas dari pilihan kode. Jangan menganggap source lokal identik dengan release server. Manifest dependency saat ini mendeskripsikan source lokal.

## Data default tenant

| Domain | Jumlah | Temuan kesiapan |
|---|---:|---|
| Produk | 27 | 24 extraction completed; 3 failed. Foto: 15 approved, 12 needs_review |
| Deconstruct asset | 202 | 197 deconstructed, 5 failed |
| Deconstruct batch | 9 | Seluruhnya completed |
| Brand profile | 7 | Profil tersedia; binding divalidasi terpisah |
| Visual identity tenant | 6 | Seluruhnya active |
| Preset kustom | 21 | JSON valid pada tenant_settings.operator_presets_json |
| Brand–product binding | 23 | 22 aktif, 1 nonaktif; tidak ada reference brand/produk yang hilang |

Tidak ada kelompok duplikasi source URL deconstruct terdeteksi. Tidak ada duplikasi nama produk/brand/key identity terdeteksi oleh pemeriksaan yang dilakukan; ini bukan jaminan deduplikasi semantik konten.

Status gagal, needs_review, dan binding nonaktif harus dipertahankan saat import; jangan diubah menjadi siap produksi. Semua record tetap masuk manifest, dengan usability sesuai kondisi sumber.

Tidak ditemukan FK deklaratif pada enam tabel sumber dalam scope query information_schema. Karena itu validasi relasi harus eksplisit di aplikasi/migrator; jangan menganggap integritas ditegakkan database sumber. Tidak ada batch reference deconstruct yang hilang pada audit tenant.

## Preset, identity, dan assignment

- Preset Manager V2 yang diaudit memakai `operator_presets_json` pada tenant_settings; bukan tabel preset kustom tersendiri.
- Kandidat sistem lokal: 2 preset operator, 6 system visual identity, 6 universe starter preset.
- Ada 44 field reference/selector yang dicatat dalam payload yang diperiksa. Selector style bukan FK; `custom` adalah selector override, bukan ID identity yang hilang.
- Selector `custom` yang diperiksa mempunyai payload visual_overrides_json. Payload ini wajib ikut import; tidak perlu membuat ulang preset.
- Field reference identity yang diperiksa dapat diklasifikasikan ke tenant identity atau system identity. Dependency identity/preset harus dipetakan dengan key+versi dan origin ledger.
- Tidak ditemukan field assignment brand eksplisit pada preset yang diperiksa. Nama preset tidak dijadikan bukti kepemilikan brand. Simpan seluruh preset pada katalog tenant, lalu pilih/kaitkan pada detail brand sesuai requirement.
- User default tenant yang dihitung: 1 superadmin, 1 admin, 1 user, semuanya aktif. Hanya agregat role dibaca; password/sesi tidak diimpor. Capability assignment CF Studio masih perlu diverifikasi saat provisioning akun baru.

## Media — batas inventory

Database menghasilkan 324 referensi media pada field terpilih: 322 lokal dan 2 URL eksternal Google Drive. Setelah deduplikasi path, ada 268 referensi lokal unik.

| Pemeriksaan server staging | Hasil |
|---|---:|
| File ada pada path yang dapat dipetakan | 67 |
| Ukuran file yang ditemukan | 34.406.141 byte, sekitar 32,8 MiB |
| File tidak ada pada path tercatat | 199 |
| Ditemukan ulang di temp/shared saat ini | 0 dari 199 |
| Referensi berupa route API, bukan file langsung | 2 |
| URL eksternal Drive | 2; akses/file belum diverifikasi |

Referensi file yang tidak ditemukan berasal dari path `data/temp` pada folder legacy atau release lama. Pemeriksaan tidak membuktikan video hilang dari seluruh storage atau backup; hanya tidak ditemukan pada path tercatat dan lokasi temp aktif yang diperiksa. Lokasi arsip lain telah ditanyakan kepada pengguna.

Ukuran 32,8 MiB **bukan** total kapasitas migrasi: tidak termasuk file tidak ditemukan, hasil route API, URL eksternal, maupun dependency yang belum diidentifikasi. Hash yang ada pada laporan missing adalah hash string path untuk pelacakan; bukan checksum konten file.

Hasil analisis/storyboard deconstruct masih ada pada database. Audit kode remake membaca hasil analisis tersebut; ketidaktersediaan raw video tidak otomatis berarti hasil analisis tak dapat dipakai, tetapi re-analysis/preview sumber memerlukan asset yang tersedia. Tentukan usability per operasi, jangan mengklaim media lengkap.

## Source server, transport dan provider

- Symlink current staging mengarah ke release atomic `20261031T085902Z-6cb518f7d16b`.
- PM2 staging UI dan API online, cwd keduanya sesuai resolved release.
- HTTP UI 5010 dan API 7010 `/health`: 200 saat inspeksi.
- Source G-Labs client mendukung direct HTTP atau BullMQ. Queue memiliki gap tenant payload dan endpoint parity sebagaimana audit pipeline; bukan bukti mode tersebut sedang aktif.
- Jalur `/api/webhook/status` yang diaudit adalah polling task, bukan push callback. `/api/webhook/generate` dapat membuat job dan tidak dipanggil selama audit. Google callback adalah auth integration, bukan callback render.
- Storage code mempunyai Nextcloud/Drive/local paths dan brand override. Daftar setting provider yang aman ada pada inventory JSON; credential tidak diekspor. Provider G-Labs/TTS/Telegram/Repliz tidak dipanggil untuk produksi selama Fase 0.
- Host/worker provider terpisah tidak diuji end-to-end; kapasitas/latency dan callback baru harus dibuktikan pada fase integrasi. Tidak menyalakan worker CF Studio ke antrean V2.

## Dependency dan baseline tes

Manifest statis dari 21 seed file menemukan 177 modul lokal dan 31 literal import eksternal/builtin, tanpa literal local import yang unresolved. Ini bukan daftar 31 paket npm: builtin dan subpath termasuk di dalamnya. Computed dynamic imports dan side effect runtime tetap memerlukan audit per adopsi.

Risiko yang dicatat per file: database coupling, environment, timer, subprocess, image/video provider. Prioritas refaktor tetap pemisahan compiler kreatif dari satu pipeline render bersama; jangan menyalin seluruh scheduler.

Tes aman tanpa provider:

- V2: recipe campaign contract, recipe social package, multiplier audio sync — **11 tes lulus**.
- CF Studio: tenant/access/target/pipeline/import/schedule/incident contracts — **20 tes lulus**.
- Tes ini tidak membuktikan render audio/video/provider berjalan. Tidak ada uji AI atau FFmpeg hidup di Fase 0.

## Gate dan tindak lanjut

Audit dan baseline operasional dapat direview sekarang. Checklist induk Fase 0 belum dicentang penuh sampai pilihan baseline kode ditutup. Gap media dapat diterima sebagai daftar pekerjaan fase migrasi hanya setelah arah penanganannya dikonfirmasi; tidak menandai media lengkap.

1. Konfirmasi baseline kode lokal terbaru atau release staging aktif.
2. Konfirmasi apakah ada arsip video sumber lain; jika tidak diketahui, catat gap dan cegah status siap media pada objek terkait.
3. Siapkan database CF Studio sebelum fase DB/import apply; tidak perlu hak CREATE DATABASE pada akun sumber.
4. Fase berikutnya menyempurnakan mockup empat tab dan detail brand Preset/Visual Identity, bukan menjalankan produksi atau migrasi final.

## Artefak

- `phase0-inventory.json`: snapshot hitungan/status/reference terpilih, tanpa credential.
- `phase0-server.json`: proses/media/health staging, tanpa PM2 environment mentah.
- `adoption-manifest.json`: closure dependency dan hash source lokal.
- `phase0-decisions.md`: keputusan dan pertanyaan terbuka.
- `production_pipeline_audit.md`: gap shared render/provider/lease yang telah ditemukan.
