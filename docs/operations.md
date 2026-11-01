# Operasi CF Studio pengembangan lokal

## Lokasi dan layanan

- Proyek: `/Users/sabeqmmursyid/_cfstudio`.
- Aplikasi: `http://127.0.0.1:3100`.
- PostgreSQL 17 khusus CF Studio: loopback `127.0.0.1:55432`, database `cfstudio_dev`, pool maksimal 3.
- Cluster: `runtime/postgres`; tidak memakai service PostgreSQL global.
- Media: `storage/`; recovery sumber: `runtime/source-media/`. Keduanya diabaikan Git.
- Sumber data: MAKNA Flow schema staging, transaksi read-only. Jangan menjalankan migrasi CF Studio terhadap database V2.

## Menjalankan kembali

```sh
npm ci
npm run db:local -- status
npm run db:local -- start
npm run build
npm run start
```

Jalankan `db:local start` hanya jika status menunjukkan cluster berhenti. UI membaca `.env.local` melalui Next.js. Username/password pengembangan ada pada variabel `CF_ADMIN_USERNAME` dan `CF_ADMIN_PASSWORD` di file lokal itu; jangan kirim credential melalui chat atau commit. Akun CF Studio baru, bukan password akun V2.

```sh
npm test
npm run smoke:local
npm run smoke:local -- --mutate
npm run verify:environment
npm run worker -- --once
```

Worker membaca hanya environment CF Studio. Ketiga dispatch default false; menjalankan worker dengan flag false tidak memanggil provider. Untuk proses berkelanjutan gunakan `npm run worker` pada terminal/proses terpisah. Menutup browser tidak mematikan worker. Scheduler dan worker harus tetap berjalan untuk otomatisasi harian; belum dipasang sebagai service boot otomatis.

## Mengisi koneksi melalui Setting

Credential dienkripsi AES-256-GCM menggunakan `CF_MASTER_KEY_B64` di environment server. Backup kunci ini secara terpisah dari backup database; kehilangan kunci membuat credential tersimpan tidak dapat dibaca. API daftar koneksi tidak mengembalikan secret.

1. Gemini: endpoint HTTPS resmi/provider yang diotorisasi, model yang tersedia untuk akun Anda dan API key CF Studio. TTS default menggunakan model preview Gemini; kompatibilitas/model/kuota harus diuji pada koneksi nyata.
2. G-Labs: endpoint worker CF Studio dan API key. Provider job menyimpan connection ID. Job yang sedang berjalan tidak dipindahkan ke endpoint baru saat koneksi diganti.
3. MiniMax jika dipakai preset: endpoint dan API key. Pastikan voice ID dalam preset valid untuk akun tersebut. Kecepatan dan volume akhir diterapkan satu kali oleh pipeline media.
4. Telegram: koneksi bot pada scope tenant. Setiap penerima membuka Setting, memulai verifikasi, mengirim kode ke bot secara pribadi, lalu menekan Verifikasi. Jam tenang dan akses brand diterapkan saat pengiriman. Menggunakan getUpdates; bot yang memakai webhook atau trafik lebih dari jendela 100 update perlu adapter webhook sebelum peluncuran ramai.
5. Repliz: access/secret key pada koneksi, ambil daftar akun, pilih akun dan tautkan eksplisit ke brand. Metadata akun tidak dipetakan ke brand berdasarkan nama. Pemeriksaan koneksi provider dilakukan lagi sebelum dispatch.

Koneksi baru menggantikan koneksi configured sebelumnya pada jenis dan scope yang sama. Retensi koneksi lama diperlukan untuk job provider yang sedang berjalan. Mapping akun Repliz baru harus diperiksa setelah mengganti koneksi; intent lama dapat memerlukan rekonsiliasi manual. Jangan menghapus credential lama ketika masih ada pekerjaan aktif tanpa rekonsiliasi.

## Menyalakan dispatch untuk pilot terkontrol

Setelah koneksi dan tujuan uji siap, konfigurasi flag pada environment CF Studio:

```dotenv
ENABLE_PRODUCTION_DISPATCH=true
ENABLE_TELEGRAM_DISPATCH=true
ENABLE_PUBLISHING_DISPATCH=false
```

Restart UI bila environment berubah, lalu jalankan worker secara terpisah. Uji produksi satu item dahulu, lalu lima jalur. Final approval tetap manual. Aktifkan publishing hanya untuk konten dan akun uji yang diotorisasi; tidak dipakai sebagai uji posting diam-diam.

## Media dan publikasi

Media lokal memakai HMAC signed URL. Isi `CF_PUBLIC_BASE_URL` dengan origin aplikasi HTTPS yang benar-benar dapat diakses Repliz dan `CF_MEDIA_ALLOWED_HOSTS` dengan host download provider yang diotorisasi bila berbeda dari endpoint provider. Jangan memakai URL localhost sebagai public origin. Namespace storage tetap terpisah dari V2.

Implementasi signed media lokal membatasi TTL hingga 24 jam; dispatch menolak jadwal lebih jauh dari sekitar 23 jam. Storage publik dengan retensi/expiry yang sesuai harus disiapkan untuk jadwal panjang. Reachability dan konsumsi media oleh Repliz belum teruji nyata. Tidak menyalin atau mengunggah media ke V2 untuk mengatasi pembatasan ini.

Repliz accepted bukan published. Worker merekonsiliasi status accepted. Status publikasi final memerlukan status provider dan bukti post ID/permalink. Cancel queued lokal langsung dibatalkan; accepted menjadi permintaan pembatalan provider. Status unknown tidak dikirim ulang otomatis; gunakan ID jadwal dari dashboard Repliz untuk mencocokkan akun, media, caption dan waktu.

## Review dan pemulihan

- Draf rutinitas berbeda dari snapshot aktif. Jalankan sekali dapat memakai revisi draf tersimpan; tidak menggeser slot berulang.
- Preset/identity dipilih dari koleksi hasil impor dan ditautkan ke brand. Nama tidak digunakan untuk menebak assignment. Snapshot aktif tidak berubah saat preset diedit.
- Creative review default otomatis memakai preset. Mode manual berhenti pada materi kreatif/start frame sebelum TTS dan render video.
- Persetujuan final terikat revisi/fingerprint. Mengedit caption atau membuat ulang hasil membutuhkan persetujuan final baru.
- Rate limit eksplisit dan kegagalan baca/download yang aman memakai backoff terbatas. Timeout/hasil POST yang ambigu memerlukan rekonsiliasi. Membuat revisi baru dapat menimbulkan biaya baru jika provider lama sebenarnya telah menyelesaikan pekerjaan.
- Error per item tercatat di History. Telegram mengelompokkan kegagalan per batch/tahap/penyebab dan melaporkan eskalasi, pemulihan serta batch selesai sebagian.
- Unggah foto produk memerlukan approval sebelum menjadi reference kritis. Deconstruct baru memerlukan file MP4 maksimal 20 MB. Ekstraksi produk menggunakan deskripsi yang diberikan; URL hanya metadata, belum menjalankan scraper marketplace V2.

## Backup dan pemulihan

```sh
node --env-file=.env.local scripts/backup-local.mjs --verify-restore
```

Perintah ini hanya diizinkan untuk cluster CF Studio lokal. Dump mode 0600 disimpan di `runtime/backups`; verifikasi membuat database sementara baru, memeriksa jumlah tabel, lalu menghapus database uji tersebut. Database utama tidak ditimpa. Media dan kunci enkripsi harus dibackup terpisah. Drill saat implementasi lulus.

Untuk migrasi skema, siapkan SOURCE_DATABASE_URL secara lokal untuk verifikasi pemisahan; jalankan migration runner `--apply` hanya pada database CF Studio. Source dan target harus berbeda. Untuk final data import lakukan backup terlebih dahulu, ulangi inventory dan koordinasikan perubahan/delta V2. Trial import tidak menggantikan cutover final. Jangan rollback database dengan sekadar mengganti build aplikasi.

## Rilis

Alpha lokal bukan persetujuan deployment production. Remote repository CF Studio dikonfirmasi pengguna: https://github.com/sabeq83/cfstudio.git. Jangan memakai remote MAKNA Flow. Production membutuhkan lokasi/domain/storage, konfigurasi provider, hasil pilot dan perintah deployment eksplisit pengguna.
