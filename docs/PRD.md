# PRD — CF Studio V3

**Versi dokumen:** 1.8
**Tanggal:** 1 November 2026
**Status:** Baseline implementasi; eksekusi diotorisasi pengguna, keputusan terbuka tetap mengikuti gate teknis
**Basis produk:** MAKNA Flow V2
**Nama aplikasi:** CF Studio
**Generasi:** V3

## 1. Ringkasan produk

CF Studio V3 adalah web app baru berbasis mesin produksi MAKNA Flow V2. Pengguna mengelola brand dan sumber konten, menyusun rutinitas otomatis, meninjau hasil produksi harian, lalu menjadwalkan konten yang disetujui ke Repliz.

Aplikasi menyediakan antarmuka yang berfokus pada otomatisasi. Content Planner, Multiplier, Pillar Campaign, dan Recipe Labs menjadi mesin di belakang Automation tanpa harus menjadi menu utama tersendiri.

Tenant, pengguna, dan hak akses tetap dipertahankan. Pemisahan data, izin tindakan, serta akses per brand diperkuat.

## 2. Masalah dan tujuan

### Masalah

- Produksi berulang membutuhkan perpindahan di antara beberapa halaman dan mesin kampanye.
- Planner, produksi, review, dan penjadwalan belum disajikan sebagai satu rutinitas yang mudah dikelola.
- Pengguna memerlukan kendali atas sumber, jumlah, produk, dan kualitas tanpa menjalankan seluruh langkah secara manual setiap hari.

### Tujuan

1. Pengguna dapat menyimpan rutinitas untuk satu brand dengan satu atau beberapa target produksi.
2. Produksi berjalan di server pada jadwal yang ditentukan, tanpa browser terbuka.
3. Setiap jalur memakai mesin MAKNA Flow yang sesuai dan mempertahankan kualitas produksinya.
4. Pengguna menerima ringkasan Telegram dan melakukan review di aplikasi.
5. Hanya versi konten yang disetujui pengguna berizin yang dapat dijadwalkan ke Repliz.
6. Kegagalan dapat dipulihkan per item atau tahap tanpa menggandakan produksi dan publikasi.

### Ukuran keberhasilan pilot

Target penerimaan pilot yang diusulkan, perlu divalidasi terhadap kapasitas server:

| Ukuran | Target |
|---|---|
| Ketepatan dispatch | ≥95% batch dimasukkan ke antrean dalam 2 menit dari waktu mulai, saat layanan sehat |
| Pelacakan hasil | Seluruh item memiliki status, asal target, dan riwayat tahap |
| Notifikasi | Ringkasan masuk antrean notifikasi ≤1 menit setelah batch mencapai kondisi siap review atau selesai sebagian |
| Approval | Tidak ada dispatch publikasi tanpa persetujuan versi yang sesuai |
| Pemulihan | Restart worker tidak menciptakan batch kedua untuk slot yang sama |
| Isolasi tenant | Seluruh skenario uji akses lintas tenant ditolak |

Waktu selesai produksi bergantung pada antrean dan provider; jam mulai bukan jaminan jam selesai. Keberhasilan pengiriman Telegram atau publikasi juga bergantung pada provider.

## 3. Ruang lingkup versi awal

### Termasuk

- Empat menu adopsi: Product Database, Deconstruct Lab, Brand Profile Manager, Setting.
- Menu Automation dengan tepat empat tab: Setting Automation, Daily Review, Schedule, History.
- Lima jalur produksi yang dijelaskan pada bagian 6.
- Rutinitas berulang, run manual, draf, pause/resume, target dinamis, dan riwayat eksekusi.
- Review kreatif sesuai kebijakan, review hasil final, serta persetujuan publikasi.
- Integrasi Telegram, Repliz, penyimpanan media, dan provider produksi yang diadopsi.
- Multi-tenant, peran pengguna, hak tindakan, pembatasan brand, dan audit.
- Migrasi Product Database, Deconstruct Lab, Visual Identity, Preset Manager, dan Brand Profile dari default tenant MAKNA Flow V2 ke default tenant CF Studio, termasuk relasi dan aset terkait.

### Di luar versi awal

- Publikasi tanpa persetujuan hasil final.
- Platform publishing baru di luar integrasi yang diadopsi dan diverifikasi.
- Penagihan SaaS, marketplace preset, dan optimasi otomatis berdasarkan performa.
- Penggantian seluruh mesin AI atau rewrite total MAKNA Flow.
- Migrasi seluruh riwayat kampanye, antrean produksi, jadwal publikasi, dan media V2 di luar lima domain migrasi yang ditetapkan pada bagian 14.1.
- Deployment production MAKNA Flow yang sudah berjalan.

## 4. Navigasi dan menu adopsi

| Menu | Kebutuhan utama |
|---|---|
| Automation | Pusat operasional rutin: pengaturan, review, jadwal, riwayat |
| Product Database | Tambah/import produk, edit data produk dan foto, kelola informasi pendukung produksi serta relasi produk–brand |
| Deconstruct Lab | Masukkan video referensi menggunakan metode V2 yang didukung, analisis, simpan hasil deconstruct, dan pilih sebagai sumber Multiplier |
| Brand Profile Manager | Kelola profil brand, audiens, arahan komunikasi, produk terkait, Visual Identity, dan Preset |
| Setting | Integrasi, pengaturan tenant, pengguna/izin, notifikasi, dan status koneksi sesuai kewenangan |

### 4.1. Brand Profile Manager — daftar dan detail per brand

Halaman awal Brand Profile Manager menampilkan **daftar brand** yang dapat diakses pengguna. Nama brand merupakan tautan/tombol menuju halaman detail brand tersebut.

Alur wajib: **Brand Profile Manager → daftar brand → klik nama brand → detail brand dengan tab Preset dan Visual Identity**.

- Detail menampilkan identitas/nama brand yang sedang dipilih dan navigasi kembali ke daftar brand.
- Tab detail berurutan: **Preset**, lalu **Visual Identity**. Default saat pertama membuka detail adalah Preset.
- Tab Preset menampilkan dan mengelola preset yang terkait brand tersebut, termasuk versi, assignment dan pilihan preset aktif sesuai capability pengguna.
- **Preset lama wajib diimpor dan digunakan kembali:** seluruh preset kustom yang ada pada default tenant staging MAKNA Flow dimigrasikan ke default tenant CF Studio. Pengguna tidak perlu mengetik ulang atau membuat ulang preset untuk memakai konfigurasi yang sama. Inventaris awal menemukan 21 preset kustom; jumlah final mengikuti snapshot saat migrasi, bukan dibatasi 21.
- Impor mempertahankan nama/key, konfigurasi lengkap non-secret, versi yang tersedia, kompatibilitas jalur produksi, serta referensi Visual Identity/produk/brand yang dapat dipetakan. Konfigurasi provider yang mengandung secret dikecualikan dan koneksinya diatur ulang secara terpisah; jangan membuang konfigurasi kreatif yang aman.
- Pada detail brand, tampilkan preset hasil impor yang sudah terkait dengan brand tersebut. Aksi **Pilih preset yang sudah ada** membuka katalog preset default tenant CF Studio, termasuk hasil impor, untuk dipakai/dikaitkan ke brand tanpa menyalin atau membuat preset baru.
- Jika sumber tidak menyimpan assignment brand yang eksplisit, preset tetap masuk katalog tenant dengan status belum ditautkan. Pengguna cukup memilih preset hasil impor untuk brand; jangan mengarang assignment atau membuat ulang konfigurasinya.
- Preset sistem/bawaan yang dirujuk preset kustom atau tersedia sebagai pilihan V2 juga tetap dapat dipakai melalui pemetaan key+versi kompatibel atau salinan dependency terverifikasi. Status baca-saja dan asal sistem tetap jelas.
- Membuat preset baru merupakan pilihan tambahan, bukan prasyarat onboarding atau produksi. Jika reference hasil impor belum tersedia, jelaskan bagian yang perlu dipetakan/diperbaiki tanpa meminta pengguna membuat ulang seluruh preset.
- Tab Visual Identity menampilkan dan mengelola identitas visual yang terkait brand tersebut, termasuk assignment dan pilihan identity aktif sesuai capability pengguna.
- Katalog tenant/sistem yang boleh dipilih dapat tersedia melalui aksi tambah/pilih dalam tab. Tidak menampilkan seluruh assignment brand lain seolah-olah milik brand aktif.
- Profil dasar, audiens, arahan komunikasi dan relasi produk tetap dapat dikelola melalui aksi Edit Brand atau area informasi profil. Tidak membuat tab Overview/Products sebagai tab utama detail tanpa perubahan kebutuhan yang disepakati.
- Setiap query/mutasi memeriksa tenant, brand yang dipilih, dan capability di server. Mengubah URL brand tidak membuka akses brand yang tidak ditugaskan.
- Preset/identity dari migrasi tetap mempertahankan relasi asal; data tenant yang belum mempunyai assignment tidak otomatis dikaitkan ke seluruh brand. Tampilkan belum terhubung dan sediakan pemilihan eksplisit.
- Brand tanpa preset/identity mempunyai empty state dengan aksi tambah/pilih sesuai izin. Viewer hanya dapat membaca.

Kedua tab ini milik detail brand dan terpisah dari empat tab Automation.

Preset menyimpan konfigurasi produksi yang dapat dipakai ulang. Preset sistem bersifat baca saja bagi pengguna tenant; pengguna dapat membuat salinan tenant/brand. Perubahan preset membuat versi baru dan tidak mengubah batch yang sedang berjalan.

Menu kampanye lama tidak ditampilkan di navigasi utama CF Studio. Informasi tahap dan konfigurasi yang tetap dibutuhkan tersedia melalui detail target atau detail item.

## 5. Pengguna dan hak akses

### Prinsip

Adopsi autentikasi, sesi, tenant context, role, menu permission, dan assignment brand V2. Kode saat ini menunjukkan role `superadmin`, `admin`, serta izin menu `can_read`/`can_write`. Inventaris seluruh role/data aktual wajib dilakukan sebelum migrasi; tidak mengasumsikan semua role usulan sudah tersedia.

### Model izin yang diusulkan

| Peran/preset izin | Kewenangan |
|---|---|
| Superadmin platform | Kelola tenant dan konfigurasi platform; akses operasional tenant hanya setelah memilih konteks tenant secara eksplisit dan tercatat |
| Admin tenant | Kelola anggota, assignment brand, integrasi tenant, rutinitas dan operasional tenant |
| Operator | Kelola target/rutinitas, jalankan produksi, edit dan regenerasi pada brand yang ditugaskan |
| Reviewer | Melihat dan menyetujui/menolak versi konten pada brand yang ditugaskan |
| Publisher | Menjadwalkan, menjadwalkan ulang, dan membatalkan publikasi konten yang telah disetujui |
| Viewer | Membaca konten, jadwal, dan riwayat sesuai assignment brand |

Operator/Reviewer/Publisher/Viewer merupakan preset izin usulan. Implementasi boleh menggunakan role yang sudah ada dengan capability tambahan. Satu pengguna boleh memiliki beberapa capability.

Izin minimal: `automation.read`, `automation.manage`, `production.run`, `content.edit`, `content.approve`, `publishing.schedule`, `publishing.cancel`, `integration.manage`, dan `tenant.users.manage`.

Seluruh izin diverifikasi di server, termasuk pada aksi bulk dan worker. Menyembunyikan tombol bukan kontrol akses. Izin per brand berlaku pada produk, sumber, media, run, notifikasi, dan akun tujuan terkait. Worker menggunakan identitas layanan dengan tenant dan ruang lingkup yang eksplisit. Tenant nonaktif tidak boleh memulai produksi atau dispatch publikasi baru; tindakan yang sudah diterima provider harus direkonsiliasi dan ditandai untuk penanganan admin.

## 6. Lima jalur produksi

| Jalur | Input wajib | Alur | Output |
|---|---|---|---|
| Video Multiplier | Hasil deconstruct yang siap digunakan, jumlah, preset produksi | Deconstruct source → remake storyboard/narasi → gambar awal → produksi suara dan klip → penggabungan | Video final dan paket sosial |
| Video Recipe Campaign | Konfigurasi Recipe Planner, jumlah, preset produksi; produk opsional sesuai mode | Content Planner Recipe Campaign → pilih baris resep → ingest ke Pillar Campaign → produksi | Video resep dan paket sosial |
| Resep foto & teks | Kategori/arahan resep, jumlah, preset Recipe Labs | Recipe Labs → resep lengkap dan prompt foto → gambar → grid/poster sesuai preset → ekspor | Foto/gambar, grid bila diaktifkan, teks resep dan caption |
| Video Brand Editorial | Brand profile, jumlah, preset editorial | Content Planner membuat plan Brand Editorial → ingest ke Pillar Campaign → produksi | Video editorial dan paket sosial |
| Video Product Campaign | Brand profile, produk dari katalog tenant yang terkait brand, jumlah, preset | Content Planner menghasilkan CEP otomatis dan plan berdasarkan produk/konteks brand → ingest ke Pillar Campaign → produksi | Video produk, CEP hasil planner, dan paket sosial |

### Arsitektur eksekusi bersama

Lima jalur membedakan asal/strategi materi kreatif, bukan jumlah worker G-Labs. Empat jalur video menghasilkan satu kontrak ProductionPackage berversi melalui compiler/normalizer masing-masing. Setelah package valid, seluruhnya memakai satu implementasi shared start-frame, TTS, clip dan FFmpeg pipeline. Reference produk, multi-voice, mode I2V/T2V, fallback suara, Smart Sync dan konfigurasi audio/visual tetap dipertahankan sebagai parameter/capability paket.

Resep foto/teks memakai shared image service lalu static finishing (grid/layout/teks/export), melewati TTS, klip video dan FFmpeg. Satu jenis G-Labs worker/gateway menangani image/video semua sumber; jumlah instance dapat diskalakan. TTS, FFmpeg dan scheduler adalah peran terpisah, bukan alasan membuat worker G-Labs per jalur.

Audit statis menunjukkan V2 sudah berbagi client provider dan helper mux, tetapi orchestration masih terpisah dan memerlukan konsolidasi dengan pembuktian paritas. Lihat `production_pipeline_audit.md`; tidak mengasumsikan semua metode legacy identik.

### Aturan jalur

- CEP tidak menjadi input manual atau field wajib pengguna. CEP ditampilkan sebagai hasil Content Planner setelah planning selesai.
- Produk wajib untuk Product Campaign; validasi pada penyimpanan, penjadwalan, dan eksekusi. Produk yang diarsipkan atau relasi brand yang tidak valid menahan target dan memberikan alasan.
- Recipe Campaign dapat organik atau melibatkan produk sesuai konfigurasi mesin yang didukung.
- Resep foto & teks memakai Recipe Labs; tidak harus melewati planner video atau mesin Pillar Campaign.
- Multiplier membutuhkan hasil deconstruct, bukan sekadar nama kampanye yang belum memiliki sumber valid.
- Storyboard, VO, dan visual resep harus menjaga bahan, takaran, urutan memasak, identitas makanan, dan kontinuitas.
- Adopsi aturan Single-Pass Strategic Engine V2; jangan menghidupkan kembali Call 2 terpisah yang sudah deprecated pada pipeline tersebut. Perencanaan, creative generation, rendering, dan regenerasi merupakan tahap berbeda; single-pass tidak berarti seluruh batch hanya membutuhkan satu panggilan provider.
- Artefak per jalur mempertahankan caption, judul platform jika dibutuhkan, hashtags, dan CTA yang memang dihasilkan/didukung mesin.

## 7. Automation — Setting Automation

### Rutinitas

Pengguna dapat membuat beberapa rutinitas per tenant. Satu rutinitas memiliki satu brand profile, nama, arahan editorial, timezone, frekuensi, waktu mulai produksi, dan kebijakan review/notifikasi/pemulihan.

Frekuensi awal: harian, hari tertentu dalam minggu, dan mingguan. Timezone default Asia/Jakarta; timezone disimpan eksplisit. Perubahan jadwal memperlihatkan waktu eksekusi berikutnya sebelum dikonfirmasi.

### Target produksi dinamis

- Tambah, simpan, edit, hapus, dan centang target untuk mengikutkannya dalam batch.
- Tidak wajib memakai semua jalur. Jalur yang sama boleh memiliki beberapa target dengan sumber atau preset berbeda.
- Setiap target memiliki nama, jalur, jumlah konten, sumber/preset yang relevan, serta produk bila wajib.
- Form menampilkan pengaturan sesuai jalur; tidak memaksakan field resep pada editorial atau produk pada resep organik.
- Jumlah konten memiliki batas konfigurasi tenant, beserta estimasi kebutuhan produksi bila tersedia.
- Menghapus target dari rutinitas tidak menghapus batch, artefak, atau jadwal publikasi yang sudah dibuat.
- Sumber yang habis/tidak valid menahan target terkait; jangan beralih sumber tanpa kebijakan yang terlihat oleh pengguna.

### Siklus pengaturan

`Draf → Tersimpan → Aktif/terjadwal → Dijeda → Diarsipkan`.

Simpan bukan aktivasi. Tombol Jadwalkan mengaktifkan eksekusi berulang setelah validasi. Simpan perubahan pada rutinitas aktif membuat revisi draf; jadwal tetap menggunakan versi aktif sampai pengguna menerapkan revisi tersebut. UI harus memperlihatkan versi aktif dan adanya perubahan yang belum diterapkan. Penghapusan rutinitas yang pernah berjalan berupa arsip; tidak menghilangkan riwayat.

Run manual memakai konfigurasi tersimpan yang dipilih dan memiliki identitas eksekusi terpisah. Run manual tidak menggeser slot berulang atau membuat slot terjadwal dianggap sudah dikerjakan.

### Kebijakan produksi

- Pilihan bila jadwal terlewat: skip atau jalankan slot terbaru. Catch-up banyak slot ditunda sampai kebutuhan dan batas kapasitas tervalidasi.
- Batas retry, batas concurrency, batas batch aktif, batas biaya/kuota bila dapat dihitung, dan auto-pause saat kegagalan beruntun.
- Hindari ide yang sudah digunakan dalam jendela waktu yang dapat diatur; pengulangan hanya melalui kebijakan eksplisit.
- Waktu produksi terpisah dari tanggal publikasi. Default usulan: produksi untuk H+1.

## 8. Automation — Daily Review

### Daftar dan detail

- Filter tanggal produksi, brand, rutinitas, jalur, status, dan batch.
- Kartu menampilkan judul, jenis, target asal, versi, thumbnail, dan progres/masalah.
- Video dapat diputar; foto/grid diperbesar; resep lengkap dan paket sosial dapat dibaca.
- Detail Product Campaign memperlihatkan produk dan CEP hasil planner.
- Detail planner dan materi kreatif dapat dibuka dari item tanpa meninggalkan konteks review.

### Tindakan

- Edit caption dan field sosial yang didukung, simpan revisi, regenerasi tahap yang dipilih, minta revisi/tolak, approve, dan pilih untuk penjadwalan.
- Bulk action hanya untuk item yang memenuhi syarat dan brand yang diizinkan.
- Batch yang selesai sebagian dapat direview; item gagal dapat dicoba ulang sendiri.
- Perubahan konten yang memengaruhi hasil publikasi membatalkan approval final untuk versi sebelumnya.
- Reviewer menyetujui versi tertentu; permintaan dari tampilan lama ditolak dengan informasi agar memuat ulang.

### Dua lapis persetujuan

1. **Persetujuan kreatif sebelum render:** default otomatis berdasarkan preset yang telah disetujui admin, sehingga rutinitas dapat berjalan sampai hasil final. Mode manual tersedia per rutinitas dan menahan produksi sampai storyboard/start frame disetujui. Default ini telah dikonfirmasi pengguna; rutinitas dapat memilih mode manual.
2. **Persetujuan final sebelum publikasi:** selalu manual oleh pengguna dengan izin approve; tidak dapat dilewati oleh preset atau worker.

Persetujuan kreatif otomatis harus dicatat sebagai keputusan sistem berbasis kebijakan dan versi preset, bukan dipalsukan sebagai persetujuan manusia. UI memperlihatkan item yang sedang menunggu review kreatif secara terpisah dari hasil final siap review.

## 9. Automation — Schedule

- Menampilkan kalender dan daftar publikasi yang sudah dijadwalkan, filter brand/akun/status.
- Dari Daily Review, pengguna memilih konten yang telah disetujui lalu membuka konfirmasi jadwal.
- Pengguna menentukan akun tujuan, tanggal, jam, timezone, dan penyesuaian per platform yang diwajibkan provider.
- Slot dapat disarankan dari pengaturan rutinitas; tanggal dan waktu tetap bisa diperiksa sebelum dikirim.
- Slot yang lewat tidak digeser diam-diam; pengguna memilih slot pengganti.
- Jika slot tidak cukup, minta tambahan slot atau kurangi pilihan; jangan menumpuk tanpa persetujuan.
- Validasi koneksi akun, hak akses, media siap diakses provider, tipe/rasio media, caption/judul wajib, dan approval versi sebelum dispatch.
- Foto/grid harus menggunakan format publikasi yang didukung akun/platform; dukungan jenis media diverifikasi saat preflight, tidak diasumsikan universal.
- Tampilkan status lokal terpisah dari status Repliz: siap dikirim, mengirim, diterima, terjadwal, terbit, gagal, dan perlu rekonsiliasi.
- Tampilkan ID provider, waktu provider terakhir diperiksa, permalink jika tersedia, dan alasan kegagalan yang dapat ditindaklanjuti.
- Retry saat respons ambigu harus memeriksa kemungkinan jadwal sudah tercipta sebelum mengirim ulang.
- Reschedule/cancel hanya ditandai berhasil setelah provider mengonfirmasi. Jika belum didukung/tidak pasti, tampilkan perlu tindakan dan jangan menjanjikan pembatalan.
- Jika konten yang sudah dijadwalkan ingin diubah, buat revisi baru; jadwal lama harus dibatalkan/diperbarui secara terkonfirmasi sebelum mengganti versi yang akan terbit. Mengubah draft lokal tidak mengubah kiriman yang sudah diterima provider.

## 10. Automation — History

Riwayat berisi batch otomatis/manual, tahap planning/produksi, keputusan review, penjadwalan, rekonsiliasi provider, dan notifikasi.

Detail run menampilkan snapshot konfigurasi, produk, brand, preset, sumber, target jumlah dan hasil aktual, waktu mulai/selesai, percobaan ulang, biaya/usage bila tersedia, serta error yang sudah disamarkan dari secret. Sediakan tautan hasil dan retry tahap gagal sesuai izin.

Audit mencatat aktor manusia/sistem, tenant/brand, waktu, tindakan, versi objek dan hasil. Jadwal batch berikutnya tidak boleh tertukar dengan jadwal publikasi.

## 11. Telegram

- Pengguna menghubungkan Telegram melalui verifikasi kepemilikan akun/chat yang diusulkan, bukan memasukkan tujuan tanpa verifikasi.
- Pengiriman mengikuti izin brand dan preferensi penerima. Ringkasan per brand tidak membocorkan konten brand yang tidak ditugaskan.
- Event awal: siap review kreatif bila manual, hasil siap review, selesai sebagian dengan kegagalan, gagal permanen, dan rutinitas dijeda otomatis.
- Pesan berisi brand, jumlah berhasil/gagal, dan tautan ke batch yang relevan.
- Tautan membuka aplikasi dengan autentikasi dan pengecekan izin; tautan Telegram bukan token persetujuan.
- Notifikasi melalui outbox dengan retry dan deduplikasi; kegagalan Telegram tidak membatalkan konten yang sudah selesai.
- Quiet hours dan preferensi notifikasi dapat diatur. Hindari pesan untuk setiap klip atau tick worker.
- Persetujuan dan penjadwalan dilakukan di web app pada versi awal.

### 11.1. Pelaporan error pipeline melalui Telegram

**Kebutuhan wajib:** pengguna menerima pemberitahuan ketika error terjadi pada pipeline terkait, tanpa harus membuka dashboard atau menunggu seluruh batch selesai. Nama jalur sumber dan tahap eksekusi bersama ditampilkan terpisah agar penyebab dan konten terdampak jelas.

#### Cakupan deteksi

- Penyusunan materi: Content Planner/CEP, deconstruct source resolution, creative generation, normalisasi/validasi paket produksi.
- Produksi bersama: start frame/gambar, TTS, klip G-Labs, FFmpeg, penyimpanan/upload aset, serta grid/export resep statis.
- Operasional: dispatch jadwal gagal, run/stage macet melewati ambang timeout atau heartbeat hilang, rutinitas auto-pause, kuota/koneksi provider yang menghalangi produksi.
- Publishing: preflight akun/media gagal, pengiriman ke Repliz gagal, status pengiriman ambigu yang membutuhkan rekonsiliasi, atau kegagalan publikasi yang dikonfirmasi provider.
- Keadaan normal seperti menunggu approval, antrean aktif, atau menunggu lane kapasitas bukan error. Laporkan hanya bila melampaui batas yang ditentukan dan menimbulkan risiko run macet.

#### Kapan pesan dikirim

| Kondisi | Perilaku notifikasi |
|---|---|
| Error pertama yang tercatat, masih dapat dicoba ulang | Kirim satu pesan awal dengan status retry dan waktu percobaan berikutnya bila tersedia; jangan menunggu retry habis |
| Error tidak dapat dipulihkan otomatis, seperti reference wajib hilang atau otorisasi provider tidak valid | Segera kirim pesan perlu tindakan, dengan instruksi yang sesuai dan aman |
| Retry habis atau stage dinyatakan gagal permanen | Kirim pembaruan status insiden yang sama, jelaskan jumlah percobaan dan dampaknya pada batch |
| Error berulang dengan penyebab sama | Gabungkan; kirim pembaruan hanya bila status, dampak, tingkat keparahan, atau kebutuhan tindakan berubah |
| Pipeline berhasil pulih setelah error | Kirim satu pesan pemulihan untuk insiden yang sebelumnya diberitahukan, dengan tahap berikutnya/status hasil |
| Batch selesai sebagian | Ringkasan berhasil/gagal memuat tautan item bermasalah; hindari mengirim ulang pesan error yang identik |

Target operasional: event error terdeteksi dan masuk outbox dalam ≤1 menit setelah tercatat oleh worker/monitor, saat infrastruktur sehat. Ini bukan jaminan Telegram diterima dalam satu menit. Deteksi run macet mengikuti ambang heartbeat/timeout per tahap, bukan waktu polling UI. Ambang dan cooldown dapat dikonfigurasi; usulan cooldown awal untuk error berulang adalah 15 menit. Eskalasi menjadi gagal permanen/perlu tindakan dan pesan pemulihan tidak ditahan oleh cooldown tersebut.

#### Isi pesan wajib

1. Nama aplikasi CF Studio, brand, rutinitas, batch/run dan identitas konten yang dapat dipahami pengguna.
2. Jalur asal: Multiplier, Recipe Video, Brand Editorial, Product Campaign, atau Resep Foto & Teks.
3. Tahap gagal, misalnya Start Frame / klip 2 dari 4, TTS, atau Pengiriman Repliz.
4. Penjelasan ringkas dalam bahasa pengguna, kode error aman dan waktu kejadian dengan timezone.
5. Dampak: jumlah item tertahan/gagal dan apakah item lain tetap berjalan.
6. Status penanganan: dicoba ulang otomatis, menunggu rekonsiliasi, perlu tindakan pengguna, atau gagal permanen; jumlah percobaan dan retry berikutnya bila diketahui.
7. Tautan **Buka Detail Error** ke item/run atau publishing intent yang tepat. Tindakan retry, penggantian sumber, reconnect, atau review dilakukan di aplikasi sesuai izin.

Contoh pesan:

> CF Studio • Nutribake — Produksi Harian
> Jalur: Video Product Campaign
> Tahap: Start Frame, klip 2/4
> Gambar belum berhasil dibuat karena layanan sementara tidak merespons.
> Status: percobaan 1/3 gagal; retry berikutnya 05.12 WIB.
> Dampak: 1 konten tertahan; 5 konten lainnya tetap diproses.
> Buka Detail Error → halaman item terkait.

Contoh hanya ilustrasi; pesan aktual harus memakai status, hitungan dan waktu yang tersimpan, bukan angka perkiraan. Status pengiriman ambigu tidak boleh dilaporkan sebagai pasti gagal atau pasti terbit.

#### Penerima, keamanan dan pencegahan spam

- Penerima adalah pengguna/chat terverifikasi yang berlangganan event error serta berhak mengakses tenant dan brand terkait. Admin dapat menunjuk penerima operasional tenant dengan izin yang sesuai; tidak mengirim ke semua pengguna secara default.
- Pengaturan Telegram memiliki kategori Error Pipeline, Perlu Tindakan, Pemulihan, serta Ringkasan Batch. Status pengiriman dan notifikasi yang dimatikan terlihat di aplikasi.
- Quiet hours mengikuti preferensi penerima. Override untuk error kritis/perlu tindakan hanya jika pengguna mengaktifkan opsi tersebut secara eksplisit; default menghormati quiet hours.
- Gunakan incident key stabil per tenant + run/item + revision + stage + kelompok penyebab. Satu gangguan provider yang memengaruhi banyak item digabung menjadi ringkasan per cakupan brand/penerima yang berizin; jangan mencampur data brand yang tidak dapat diakses penerima.
- Jangan sertakan API key, token, credential, URL bertanda tangan, stack trace atau payload mentah provider dalam pesan. Tautan mengharuskan login dan pemeriksaan izin.
- Event penting dibuat secara durable bersama perubahan status atau melalui transactional outbox; restart dan pemrosesan ulang event tidak membuat notifikasi aplikasi ganda. Pengiriman Telegram tetap dapat mengalami hasil ambigu; catat untuk rekonsiliasi dan jangan mengklaim exactly-once delivery eksternal.
- Telegram gagal tidak menghentikan pipeline lain. Lakukan retry berbatas dan simpan dead-letter/status delivery di History serta indikator aplikasi; jangan melaporkan kegagalan Telegram melalui kanal Telegram yang sama secara rekursif.
- Monitor run macet berjalan terpisah dari proses produksi agar crash worker bisa terdeteksi. Gangguan total infrastruktur/outbox membutuhkan monitoring operasional di luar aplikasi; Telegram dari aplikasi tidak dapat dijamin saat seluruh layanan mati.

## 12. Model data konseptual

| Entitas | Kebutuhan |
|---|---|
| Tenant, User, Membership/Permission | Identitas, status, izin, assignment brand |
| BrandProfile, VisualIdentity, PresetVersion | Konteks kreatif dan konfigurasi berversi |
| Product, BrandProductBinding | Katalog dan relasi produk dengan brand |
| DeconstructAsset | Referensi teranalisis untuk Multiplier |
| AutomationRoutine, RoutineRevision | Draf dan revisi aktif jadwal/kebijakan |
| ProductionTarget | Jalur, jumlah, sumber/preset, produk bila perlu |
| AutomationRun, TargetRun | Slot eksekusi dan snapshot konfigurasi |
| ContentItem, ContentRevision | Artefak produksi, planner/CEP, metadata sosial dan versi |
| ApprovalRecord | Jenis kreatif/final, versi tepat, aktor/kebijakan |
| PublishingIntent, PublishingAttempt | Tujuan, slot, versi disetujui, ID/status provider |
| NotificationOutbox | Pesan, penerima terverifikasi, incident/event key, retry/status dan status delivery |
| PipelineIncident | Tenant/brand, run/item/revision/stage, kelompok error, dampak, percobaan, eskalasi dan pemulihan |
| AuditEvent | Jejak keputusan dan perubahan |

Nama di atas konseptual. Gunakan tabel V2 yang memenuhi kebutuhan; hindari membuat salinan data kedua tanpa alasan. Pemetaan final ditentukan saat desain teknis.

Kunci unik minimal untuk run terjadwal: tenant + rutinitas + slot terjadwal. Perubahan revisi tidak boleh menggandakan run pada slot sama. Target/item memakai kunci turunan deterministik; publishing memiliki kunci per item revision + akun + intent jadwal.

## 13. Status dan perilaku pemulihan

Pisahkan status produksi, approval, dan publikasi; satu kolom status tidak cukup mewakili semua keadaan.

- Produksi: queued → planning → creative → awaiting_creative_approval bila perlu → rendering → ready; alternatif retry_wait, failed, canceled.
- Final review: pending → approved atau changes_requested; revisi baru kembali pending.
- Publikasi: draft → queued → submitting → accepted/scheduled → published; alternatif failed, canceled, unknown/reconciliation_required.
- Ringkasan batch: running, awaiting_review, completed, partially_failed, failed, canceled.

Worker memakai claim/lease dengan masa berlaku dan checkpoint. Restart melanjutkan tahap terakhir yang valid. Timeout provider tidak langsung dianggap gagal permanen. Partial success dicatat per target/item, dan cancel menghentikan tahap berikutnya tanpa menghapus hasil valid yang sudah ada.

## 14. Strategi adopsi MAKNA Flow V2

### Kandidat modul yang telah ditemukan di repository

| Area | Kandidat adopsi |
|---|---|
| Auth dan tenant | `lib/auth.js`, `lib/tenant-context.js`, `lib/tenant-admin.js` |
| Produk dan brand | `lib/brand-product-repository.js`, endpoint brand profiles, Product Database dan Brand Profile UI terkait |
| Visual Identity & Preset | `lib/visual-identity-*`, `lib/operator-presets.js`, modul preset terkait |
| Planner dan orchestration | `lib/operator-job-service.js`, `lib/operator-content-worker.js`, `lib/operator-content-contract.js` |
| Recipe Campaign | `lib/recipe-planner-engine.js`, `lib/recipe-campaign-ingest.js`, `lib/recipe-production-adapter.js` |
| Multiplier | `lib/re-multiplier-worker.js`, modul konfigurasi dan API Multiplier |
| Pillar dan Recipe Labs | `lib/campaign-scheduler.js`, processor terkait pada `lib/scheduler-processors.js` |
| Automation | `lib/content-automation-*`, repository, API, dan halaman automation terkait |
| Publishing | `lib/publishing-*`, `lib/repliz-client.js`, adapter approval/publishing yang relevan |
| Telegram | `lib/notification-outbox-repository.js`, `lib/content-automation-notification-worker.js`, `lib/notification-providers/telegram.js` |

Processor Multiplier/Pillar adalah referensi perilaku dan sumber helper; tidak diadopsi sebagai dua renderer terpisah permanen di CF Studio.

Daftar ini adalah kandidat hasil inspeksi, bukan jaminan seluruh modul siap dipindahkan. Audit dependency, side effect startup, kontrak provider, dan isolasi tenant diperlukan.

### Prinsip implementasi

- Buat aplikasi/repository CF Studio terpisah dengan fondasi V2 yang dipilih; usulan ini menghindari penggantian langsung aplikasi lama.
- Pertahankan mesin yang terbukti; gunakan compiler per sumber sampai ProductionPackage; shared services mengeksekusi render tanpa branching berdasarkan nama jalur.
- Jangan menyalakan worker lama dan worker baru untuk antrean yang sama tanpa pemilik yang jelas.
- Aplikasi baru memiliki konfigurasi deployment, secret, dan ruang data terpisah. Tidak menulis ke tabel operasional production V2 selama pilot.
- Migrasi lima domain pada bagian 14.1 dari default tenant V2 ke default tenant CF Studio merupakan kebutuhan yang telah ditetapkan pengguna. Gunakan pemetaan ID eksplisit; trial migration dan verifikasi mendahului cutover. Migrasi akun pengguna/izin merupakan keputusan terpisah.
- Hash password/sesi memerlukan pemeriksaan kompatibilitas; sesi aktif tidak otomatis disalin ke aplikasi baru. Keputusan berbagi login/SSO ditunda sampai model autentikasi disepakati.
- Feature flag dan pembatasan automation pilot V2 harus ditinjau eksplisit, bukan dihapus untuk memaksa semua jalur berjalan.
- Konvensi framework mengikuti dokumentasi Next.js yang terpasang sebelum coding.

### 14.1. Migrasi default tenant MAKNA Flow → default tenant CF Studio

**Keputusan produk yang telah ditetapkan:** data dari lima domain berikut pada default tenant MAKNA Flow V2 dimasukkan ke default tenant CF Studio. Bukan katalog publik lintas tenant dan bukan migrasi ke tenant lain. Identitas/ID default tenant sumber dan tujuan harus diverifikasi dari lingkungan aktual sebelum eksekusi; jangan mengandalkan nama tampilan atau fallback tenant.

| Domain sumber | Data yang wajib tersedia di CF Studio default tenant |
|---|---|
| Product Database | Seluruh record produk milik default tenant, informasi dan hasil ekstraksi, metadata, foto/referensi gambar, serta relasi produk–brand |
| Deconstruct Lab | Seluruh hasil deconstruct milik default tenant, analisis/storyboard, metadata sumber, referensi video, dan artefak tersimpan yang diperlukan agar sumber bisa dipakai Multiplier |
| Visual Identity | Identitas visual milik default tenant, konfigurasi, referensi gambar, serta dependency universe/karakter/style atau aset lain yang benar-benar dirujuk |
| Preset Manager | Seluruh preset milik default tenant beserta konfigurasi, versi yang tersedia, referensi dan assignment brand; preset sistem yang dirujuk dipetakan ke versi kompatibel atau disalin sebagai dependency dengan asal dan sifat baca-saja tetap jelas |
| Brand Profile | Seluruh profil brand milik default tenant, data profil, audiens, arahan komunikasi, aset brand, serta assignment Visual Identity, preset, dan produk |

#### Aturan migrasi

1. **Salinan terkontrol:** salin ke ruang data CF Studio; tidak memindahkan, menghapus, atau mengubah data sumber V2. Data operasional V2 tetap berjalan.
2. **Inventaris sebelum salin:** catat jumlah record per domain, ukuran/jumlah media, dependency, duplikasi, file hilang, serta URL eksternal. Jangan mengestimasi kapasitas dari jumlah record saja.
3. **Relasi tetap utuh:** petakan ID sumber–tujuan untuk seluruh domain dan dependency. Urutan import mengikuti dependency aktual. Jangan menghasilkan brand, produk, atau identitas tanpa relasi yang sebelumnya valid.
4. **Dapat diulang:** gunakan kunci asal yang mencakup sistem sumber, tenant sumber, tipe objek, dan ID sumber. Pengulangan import tidak membuat salinan kedua. Konflik dengan data tujuan yang sudah ada masuk laporan; jangan menimpa perubahan CF Studio secara diam-diam.
5. **Media ikut tersedia:** salin media milik aplikasi ke penyimpanan CF Studio, perbarui referensinya, dan periksa aksesnya. URL pihak ketiga dicatat serta diuji; file yang tidak dimiliki/tidak dapat diakses tidak dianggap berhasil disalin. Manifest membedakan media yang disalin, referensi eksternal, dan pengecualian.
6. **Snapshot dan perubahan terakhir:** lakukan trial import dari snapshot konsisten. Saat cutover, tangani perubahan sumber sejak snapshot melalui delta import atau jeda edit terkoordinasi pada domain terkait; batas waktu snapshot/cutover dicatat.
7. **Isolasi:** semua objek hasil import dimiliki default tenant CF Studio. Dependency bersama tidak boleh membawa objek tenant lain. Hak akses brand dan pengguna tujuan tetap diberlakukan; impor katalog tidak memberikan akses lintas tenant.
8. **Tanpa efek operasional:** import tidak memanggil provider AI, memulai produksi, mengirim Telegram, mengaktifkan rutinitas, atau membuat ulang jadwal Repliz. Status job sumber tidak boleh otomatis dijalankan di CF Studio.
9. **Tanpa secret dan sesi:** lima domain ini tidak mencakup pemindahan API key, token integrasi, session login, atau akun/role pengguna. Integrasi CF Studio dikonfigurasi secara terpisah; migrasi akun memerlukan keputusan tersendiri.
10. **Verifikasi dan pemulihan:** siapkan backup sumber/tujuan, manifest import dan laporan rekonsiliasi. Pemulihan membatasi perubahan pada import terkait tanpa menghapus data baru CF Studio atau menyentuh sumber V2.

#### Kriteria penerimaan migrasi

- Seluruh record dalam cakupan tercatat pada manifest sebagai berhasil, sudah dipetakan, atau pengecualian yang jelas; tidak ada data yang hilang tanpa laporan.
- Jumlah sumber dan tujuan direkonsiliasi per domain; perbedaan karena pemetaan preset sistem, konflik, atau data invalid dijelaskan per objek, bukan sekadar selisih total.
- Seluruh referensi internal hasil import terhubung ke objek tujuan/dependency valid, tanpa relasi lintas tenant.
- Media yang disalin diverifikasi ukuran/checksum; URL eksternal dan media hilang memiliki hasil pemeriksaan dan tindakan lanjut. Objek dengan dependency kritis hilang ditandai belum siap digunakan.
- Uji pemakaian meliputi produk hasil import pada Product Campaign, hasil deconstruct pada Multiplier, serta brand dengan Visual Identity dan preset hasil import pada produksi terkontrol.
- Import ulang tidak menambah duplikasi dan tidak menimpa perubahan tujuan tanpa resolusi konflik eksplisit.
- Default tenant CF Studio dapat membaca/mengelola hasil import sesuai izin; tenant lain tidak dapat mengaksesnya.
- Laporan jumlah, media, konflik, dan pengecualian direview sebelum data dinyatakan siap pilot. Ukuran aktual, lama migrasi, dan kebutuhan storage ditetapkan setelah inventarisasi.

## 15. Persyaratan nonfungsional

- PostgreSQL menjadi penyimpanan durable untuk jadwal, claim, status, approval, dan audit; tidak mengandalkan memori browser/proses.
- API memvalidasi tenant dan brand pada setiap objek. Background jobs membawa tenant eksplisit dan tidak memakai fallback tenant untuk objek yang tidak dikenal.
- Secret disimpan melalui server environment atau penyimpanan terenkripsi; tidak tampil pada log, ekspor, placeholder, atau respons API.
- Media privat hanya tersedia melalui akses terotorisasi; URL yang dibutuhkan provider dibatasi cakupan/waktunya sesuai kemampuan provider.
- Light/dark mode dan seluruh UI menggunakan semantic tokens dari fondasi theme MAKNA. Dukung desktop dan mobile untuk review/approval.
- Kontrol dapat digunakan dengan keyboard, label field jelas, status tidak hanya dibedakan lewat warna.
- Kuota/concurrency tenant mencegah satu tenant menghabiskan kapasitas bersama; tampilkan antrean, bukan menjanjikan selesai segera.
- Backup, pemulihan, retensi media, retensi audit, dan penghapusan tenant memiliki kebijakan eksplisit sebelum production.
- Provider dapat dipantau dari health/integration status. Kegagalan disajikan dengan tindakan yang dapat dilakukan pengguna.

## 16. Skenario penerimaan utama

1. Pengguna dapat membuat rutinitas hanya dengan satu jalur, menyimpannya tanpa aktivasi, lalu mengaktifkannya secara terpisah.
2. Pengguna dapat menambah beberapa target dari jalur sama, mengedit, menghapus, serta memilih subset; batch hanya memproduksi target terpilih pada revisi aktif.
3. Kelima jalur berjalan melalui adapter mesin yang tepat dan menghasilkan artefak sesuai jenis.
4. Product Campaign tanpa produk valid tidak dapat diaktifkan/dieksekusi. Tidak ada input CEP manual; CEP hasil planner dapat dilihat saat review.
5. Brand Editorial membuat plan melalui Content Planner sebelum ingest dan produksi Pillar.
6. Recipe Campaign membuat planner resep sebelum ingest; foto/teks menggunakan Recipe Labs.
7. Jadwal otomatis berjalan ketika browser ditutup. Restart dan dua worker yang bersaing tidak menggandakan batch.
8. Dua item gagal dari enam menghasilkan empat item yang bisa direview; retry hanya menangani item/tahap yang gagal.
9. Mode kreatif manual menahan render dan memberi notifikasi; mode otomatis mencatat kebijakan yang menyetujuinya. Kedua mode tetap memerlukan final approval manusia sebelum publikasi.
10. Mengubah caption/media membatalkan final approval; approval versi lama ditolak. Jadwal lama di provider tidak dianggap otomatis berubah.
11. Publisher tidak dapat menjadwalkan item pending approval atau brand yang tidak ditugaskan, meskipun memanggil API langsung.
12. Respons Repliz ambigu menghasilkan rekonsiliasi, bukan langsung membuat jadwal kedua. Published hanya tampil berdasarkan konfirmasi provider yang dapat dipercaya.
13. Telegram yang gagal tidak menggagalkan batch; retry pesan tidak menggandakan event yang sama.
14. Akses objek tenant lain, termasuk ID tebakan, URL media, bulk action, dan notification recipient, ditolak.
15. Perubahan preset/rutinitas tidak mengubah snapshot run yang sedang berjalan. Arsip target/rutinitas mempertahankan riwayat.
16. Empat sumber video dengan paket ekuivalen melewati shared renderer yang sama; resep statis tidak memanggil tahap audio/video/mux. Paritas reference, multi-voice dan konfigurasi mux dibuktikan sebelum pilot.
17. Migrasi lima domain default tenant memenuhi seluruh kriteria penerimaan bagian 14.1 sebelum pilot menggunakan katalog hasil import.
18. Error pertama pada setiap tahap yang dicakup masuk outbox tanpa menunggu batch selesai; pesan membedakan jalur, tahap, dampak, retry dan tindakan, serta menaut ke detail yang berizin.
19. Retry berulang tidak membanjiri Telegram; eskalasi gagal permanen dan pemulihan menghasilkan pembaruan insiden. Quiet hours, penerima lintas brand dan sanitasi secret diuji.
20. Crash/heartbeat timeout dideteksi monitor terpisah; kegagalan Telegram dicatat dan dicoba ulang tanpa menghentikan produksi atau memicu loop notifikasi.
21. Seluruh preset kustom default tenant staging diimpor dengan konfigurasi non-secret dan reference yang dipetakan; pengguna dapat memilih preset hasil impor pada detail brand tanpa membuat ulang. Assignment asal dipertahankan bila ada; preset tanpa assignment tetap tersedia di katalog tenant. Jumlah direkonsiliasi terhadap snapshot final dan preset sistem terkait tetap tersedia secara kompatibel.
22. Brand Profile Manager membuka daftar brand; klik nama membuka detail brand dengan tab Preset dan Visual Identity. Pergantian brand menampilkan assignment yang benar, empty state tersedia, dan akses brand lain tetap ditolak server.
23. Semua tab dapat digunakan pada light/dark mode dan layar mobile untuk review serta penjadwalan.

## 17. Tahapan delivery yang disarankan

| Tahap | Hasil yang harus direview |
|---|---|
| 1. Validasi produk | Setujui PRD, role/capability, kebijakan kreatif, dan mockup empat tab |
| 2. Fondasi CF Studio | Aplikasi terpisah, tenant/auth/izin, menu adopsi, trial import dan rekonsiliasi lima domain default tenant |
| 3. Pengaturan dan orchestration | Rutinitas berversi, CRUD target, lima adapter, jadwal durable, retry/checkpoint |
| 4. Review dan notifikasi | Artefak nyata, dua lapis approval, Telegram outbox, Daily Review |
| 5. Publishing dan history | Repliz preflight, jadwal, rekonsiliasi, History dan audit |
| 6. Pilot | Default tenant dan brand hasil import, uji lima jalur, verifikasi media/relasi, pemulihan, isolasi data, serta kapasitas |

Pilot awal yang diusulkan: Nutribake dengan 2 Multiplier, 2 video Recipe Campaign, dan 2 resep foto/teks per hari. Brand Editorial serta Product Campaign diuji sebagai batch tambahan terkontrol sebelum rutinitas lima jalur diaktifkan bersamaan.

## 18. Keputusan terbuka sebelum implementasi

1. Keputusan selesai: creative approval default otomatis berdasarkan preset, dapat diubah per rutinitas. Final approval sebelum publikasi tetap manual.
2. Pilih apakah akun pengguna V2 diimpor atau menggunakan login bersama; repository dan ruang data terpisah merupakan rekomendasi awal.
3. Tetapkan batas biaya, jumlah konten, concurrency, dan retensi per tenant berdasarkan kapasitas aktual.
4. Verifikasi pemetaan role V2 ke capability baru saat provisioning. Keputusan self-approval selesai: diperbolehkan bagi pengguna yang memiliki izin produksi dan approval sekaligus, dengan scope tenant/brand tetap diperiksa.
5. Konfirmasi provider/media/platform Repliz yang masuk pilot, termasuk perilaku reschedule/cancel dan rekonsiliasi yang benar-benar tersedia.

Keputusan ini tidak mengubah kebutuhan inti; harus diselesaikan pada desain teknis dan validasi produk sebelum aktivasi pilot.

## 19. Referensi internal

- Mockup: `public/mockup_brand_daily_routine.html` — referensi interaksi, bukan spesifikasi backend atau integrasi nyata.
- `sot/global/operator-api.md` — fondasi headless planner, produksi, checkpoint, dan approval.
- Modul yang tercantum pada bagian 14 — bukti awal kemampuan yang dapat diadopsi.
- `AGENTS.md` — aturan single-pass, semantic tokens, secret, verifikasi, rilis, dan deployment.

Jika mockup berbeda dengan PRD, PRD menjadi usulan perilaku produk berikutnya setelah disetujui. Contoh CEP pada mockup tetap data simulasi; CEP produksi harus dihasilkan oleh Content Planner.

## 20. Keputusan eksekusi terkonfirmasi

- Root proyek: `/Users/sabeqmmursyid/_cfstudio`.
- Pengguna mengotorisasi pelaksanaan rencana implementasi.
- Sumber migrasi: MAKNA Flow schema `staging`, hanya default tenant yang diverifikasi.
- Tujuan: database PostgreSQL khusus CF Studio; tidak memakai tabel operasional database V2.
- Secret, sesi, antrean aktif, dan jadwal publikasi V2 tidak dimigrasikan.
- Koneksi sumber inventarisasi dan ekspor bersifat read-only; apply hanya pada database tujuan yang diverifikasi.

## 21. Catatan implementasi fondasi

Source default tenant staging telah diverifikasi read-only pada 1 November 2026. Inventaris awal: 27 produk, 202 hasil deconstruct, 7 brand profile, 6 visual identity, 21 preset kustom dan 23 binding brand–produk. Angka ini baseline awal, bukan manifest final; sumber dapat berubah sebelum cutover.

Repository source V2 tetap read-only untuk adopsi. CF Studio baru menggunakan Next.js 16.4.3 setelah audit dependency. Database tujuan masih menunggu konfigurasi admin. Status implementasi yang otoritatif berada pada bagian Progress eksekusi di implementation_plan.md; keberadaan tab UI bukan bukti backend/provider sudah selesai.

## 22. Keputusan penutupan Fase 0

- Baseline adopsi mesin: kode lokal MAKNA Flow terbaru yang diaudit, SHA `6c645e5cdf84d47d86a7e142c6e5679ba7bd25f2`; perubahan sesudahnya melalui delta audit.
- Data migrasi tetap dari default tenant schema staging.
- Sebanyak 199 referensi file lokal belum ditemukan pada lokasi yang diperiksa. Lokasi arsip belum diketahui; pengguna menetapkannya sebagai gap migrasi dahulu. Simpan analisis deconstruct yang tersedia, pertahankan status media belum terverifikasi/tidak tersedia sesuai bukti, dan jangan mengarang file pengganti atau otomatis mengulang analisis.
- Fase 0 selesai dengan gap terdokumentasi. Database tujuan dan rekonsiliasi media tetap menjadi gate fase migrasi, bukan dinyatakan selesai.

## 23. Kebijakan approval terkonfirmasi

Creative approval default otomatis berdasarkan preset dan dapat diubah per rutinitas. Keputusan otomatis dicatat sebagai sistem berbasis versi preset, bukan manusia. Final approval tetap manual untuk versi yang tepat. Pengguna boleh menyetujui hasil produksinya sendiri jika memiliki izin produksi dan approval sekaligus; status role/nama pembuat tidak menggantikan pemeriksaan capability dan assignment brand. Semua keputusan diaudit.

## Settings adoption contract — 1 November 2026

User approved six sections: Gemini API Pool Manager, MiniMax AI Configuration, G-Labs Webhook Configuration, Repliz Publishing Integration including Google Drive, Telegram Notification and Users/Permissions.

Gemini: single/bulk import, labels/project groups, encrypted keys, local project/key budgets, atomic reservation, durable cooldown, health diagnostics and soft archive. Google quotas apply per project; local counters are not authoritative Google remaining quota. All planner/creative/analysis/Gemini TTS calls use the same pool. Invalid credentials differ from permissions, transient failures and quota. Unknown POST is never repeated using another key.

MiniMax: encrypted key replacement, model/default voice, bounded voice test and Gemini fallback. Presets override production defaults; changing settings does not rewrite an active routine snapshot. G-Labs: endpoint/key, image/video model defaults, persistent safety delay, max concurrency and threading/sequential start-frame dispatch. Shared gateway retains each job's original route.

Repliz publishing requires Google Drive staging. Configure OAuth client ID/secret for CF Studio, callback origin, tenant-bound one-use state and browser nonce, drive.file/email scopes, encrypted offline refresh. No automatic import of V2 credentials/tokens. Create/verify app-owned tenant publishing folder, validate write access, expose only safe status.

Only approved final media is copied to Drive after scheduling. Verify checksum and anonymous binary download before Repliz POST. Persist pre-generated file ID to recover ambiguous uploads without duplicate copies. Reuse staging by tenant/item/revision/checksum/Drive connection. A Drive failure blocks publishing, not production; error is visible and queued for Telegram. No fallback to localhost/signed links.

Retention extends past latest referenced schedule plus grace. Cleanup only when all referencing intents are terminal, never while unknown or active. Revoke the staging file's public permission and move its app-owned copy to trash; never delete originals. Tenant boundaries and explicit publisher/approver permissions remain mandatory. Live OAuth/provider tests require the user's CF Studio credentials; offline tests do not prove live readiness.

## Approved Gemini V2 parity revision — 2 November 2026

Supersedes the earlier project-group requirement: no Project group input or project budget gates in new pool operations. Each key has its own local daily cap, cooldown and concurrency reservation. Historical project-linked records are retained for audit. Summary is local bookkeeping and not authoritative Google quota.

Pool UI follows the approved mockup: active/used/remaining summary, utilization, status filter, masked rows, audit/test, Single Input/Bulk Add with alias prefix/default cap/live precheck, duplicate/rejected/transient summaries, pause/enable, archive invalid and restore paused. Invalid keys require successful retest before activation. Without live precheck, newly imported keys start paused.

Model UI has Paid/Free Tier, primary/custom ID, optional fallback, paid smart module routing and Context Caching. No TTS model or timezone input here. Older internal TTS/timezone configuration remains intact. Free tier forces caching off. Catalog IDs mirror V2; runtime availability/authorization is not assumed. CF Studio exposes routing only for its supported extraction/deconstruct/campaign modules.

The shared gateway records each generation attempt before HTTP. Explicit model 404 or structured 503 UNAVAILABLE may fall back with bounded delay; network loss/unknown POST does not retry under another key/model. Routine and catalog-job policies are snapshotted. Explicit cache uses tenant/credential/model/exact long text identity with 15-minute TTL; unsupported/rejected/uncertain cache preparation falls back inline without repeating generation. No V2 Master KB asset or guaranteed saving is claimed.

## Approved MiniMax simplification — 2 November 2026

Supersedes earlier MiniMax UI fields: show only MiniMax API key with Save/Change/Cancel and stored status. No endpoint/model/voice/fallback or voice-test controls in the panel. Key replacement remains encrypted and preserves existing production defaults; preset snapshots retain model/voice/speed/volume.

All production TTS and the authorized diagnostic service use one executor and fixed V2 order: api.minimax.io, api.minimaxi.chat, api.minimax.chat, api-uw.minimax.io (all HTTPS /v1/t2a_v2). No caller-supplied hosts or redirects. Maximum four attempts with bounded delay, stopping after a valid non-streaming hex audio response. Only explicit internal/system/busy rejections without audio, endpoint 404/405, or known pre-connect failures may rotate. Raw server 5xx, request/processing timeouts, socket loss, malformed/partial audio are unknown, never repeated or sent to Gemini automatically. Authentication, balance/usage exhaustion and input/model/voice rejection are terminal and reported. Account rate limits do not rotate endpoint; existing explicit preset fallback policy may handle safe rejections.

Error mapping follows [MiniMax error codes](https://platform.minimax.io/docs/api-reference/errorcode). Payload/audio contract follows [synchronous TTS](https://platform.minimax.io/docs/api-reference/speech-t2a-http). Four endpoint entries are adopted from local V2, not a claim of live compatibility of every legacy gateway; verify with CF Studio credentials during pilot.
