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

1. Gemini API Pool Manager: simpan model planner/creative/analisis dan model TTS, pilih zona waktu batas lokal, lalu tambah key satuan/bulk. Kelompokkan key dari project Google yang sama dalam project group yang sama. Kuota Google berlaku per project; angka pemakaian/batas di CF Studio adalah catatan lokal, bukan kuota Google langsung. Tes key memakai daftar model; 429/cooldown tidak menonaktifkan key. Archive mempertahankan riwayat. Semua panggilan Gemini memakai pool yang sama setelah pool dibuat.
2. MiniMax AI Configuration: endpoint, key, model, voice default dan pilihan fallback Gemini. Kosongkan key saat menyimpan agar credential lama dipertahankan. Tes suara pendek merupakan panggilan API berbiaya dan hanya berjalan setelah tombol ditekan. Preset mengalahkan default; default baru berlaku pada snapshot rutinitas baru/diaktifkan ulang.
3. G-Labs Webhook Configuration: endpoint/key, model gambar/video default, safety delay min/max, batas job bersamaan dan pola start frame threading/sequential. Delay disimpan di database; worker tidak tertahan tidur. Job yang sedang berjalan tetap memakai koneksi awal.
4. Repliz Publishing Integration: access/secret key, tes koneksi, ambil akun lalu tautkan eksplisit ke brand. Siapkan Google Drive Publishing di panel yang sama sebelum penjadwalan. Lihat langkah OAuth di bawah.
5. Telegram: simpan nama/token bot melalui bagian koneksi bot tenant. Setiap penerima memulai verifikasi, mengirim kode ke bot secara pribadi, lalu menekan Verifikasi. Jam tenang dan akses brand tetap diterapkan. getUpdates belum menggantikan adapter webhook untuk bot yang sudah memakai webhook/trafik besar.

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

Preview media tetap privat di storage CF Studio. Publishing sekarang wajib melalui salinan Google Drive; tidak memakai signed localhost URL dan tidak lagi dibatasi TTL 23 jam. Isi `CF_MEDIA_ALLOWED_HOSTS` bila host download provider berbeda dari endpoint provider.

1. Buat OAuth Web application khusus CF Studio pada Google Cloud, aktifkan Drive API, siapkan consent/test user sesuai lingkungan. Isi Client ID/secret melalui Settings. Daftarkan persis callback yang ditampilkan, lokal `http://127.0.0.1:3100/api/v3/google/callback`; deployment membutuhkan `CF_PUBLIC_BASE_URL` HTTPS dan callback baru. Environment berubah memerlukan restart.
2. Tekan Hubungkan Google dari browser biasa; beri izin `drive.file` dan email serta offline access. Credential/token V2 tidak diimpor otomatis. Dalam mode OAuth Testing, kebijakan expiry Google dapat mengharuskan otorisasi ulang; periksa sebelum pilot berkelanjutan.
3. Tekan Buat / perbaiki folder lalu Tes kesiapan Drive. Folder harus khusus tenant dan dibuat/ditandai oleh aplikasi CF Studio; folder V2 tidak dipakai otomatis. Folder tidak dibuka publik. Hanya salinan final yang telah disetujui dan dijadwalkan dibuat publik.
4. Saat dispatch, worker menyimpan ID Drive sebelum upload, memeriksa checksum/ukuran dan unduh binary anonim, baru mengirim URL ke Repliz. Jika kebijakan Drive melarang public sharing atau URL menghasilkan halaman HTML, publishing berhenti dan History/Telegram mencatat error. Produksi tetap tersedia.
5. Retensi salinan mengikuti nilai terbesar antara minimum retensi dan jadwal terakhir + masa tenggang. Worker membersihkan salinan setelah semua intent terkait published/failed/canceled; status unknown atau aktif menahan pembersihan. Izin publik dicabut dan salinan dipindah ke Trash; file asli tidak dihapus. Lepas koneksi ditolak selama ada publikasi aktif, lalu membersihkan salinan dan membuang token offline lokal. Jika terhenti, gunakan Lanjutkan pelepasan koneksi. Pencabutan grant pada akun Google dapat dilakukan melalui pengelolaan akses akun Google setelah semua koneksi terkait selesai.

OAuth dan konsumsi URL oleh Repliz belum diuji memakai akun nyata. Uji kesiapan folder tidak membuktikan download publik; pemeriksaan binary dilakukan per file saat dispatch. Google Drive bukan CDN, sehingga limit download/kebijakan akun tetap perlu pilot.

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
