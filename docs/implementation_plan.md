# Implementation Plan — CF Studio V3

**Tanggal:** 1 November 2026
**Basis:** PRD versi 1.6 (`sot/cf-studio-v3/PRD.md`)
**Revisi:** 1.1 — diperjelas setelah audit pipeline produksi bersama.
**Status:** Eksekusi dimulai. Fondasi aplikasi lokal terverifikasi; migrasi apply dan provider belum berjalan.

## 1. Hasil akhir dan batas kerja

Membangun aplikasi baru CF Studio V3 dengan menu Product Database, Deconstruct Lab, Brand Profile Manager (termasuk Visual Identity dan Preset), Setting, dan Automation. Automation mempunyai empat tab: Setting Automation, Daily Review, Schedule, History.

Kelima jalur produksi: Multiplier, Recipe Campaign video, Recipe Labs foto/teks, Brand Editorial video, dan Product Campaign video. Product Campaign mewajibkan produk; Content Planner menghasilkan CEP secara otomatis. Semua publikasi memerlukan approval final versi konten oleh manusia yang berizin.

Migrasi yang wajib: Deconstruct Lab, Product Database, Visual Identity, Preset Manager, dan Brand Profile dari default tenant MAKNA Flow V2 ke default tenant CF Studio, termasuk relasi dan media terkait.

Rencana ini tidak memulai coding aplikasi, panggilan AI, migrasi database, pemindahan media, atau deployment. Root `implementation_plan.md` milik tugas sebelumnya tidak ditimpa. Sumber V2 tetap dipertahankan.

## 2. Keputusan arsitektur dan asumsi

1. **Aplikasi terpisah:** usulkan repository CF Studio tersendiri. Lokasi checkout, remote, URL, port, dan host deployment ditetapkan sebelum bootstrap; tidak mengarang target tersebut. Semua path aplikasi pada bagian 12 relatif terhadap root repository baru ini, bukan instruksi menulis ke root MAKNA Flow.
2. **Fondasi kompatibel terlebih dahulu:** gunakan versi framework/runtime yang kompatibel dengan modul V2; kunci versi dalam lockfile. Jangan sekaligus melakukan major upgrade framework. Dokumentasi Next.js terpasang telah ditinjau untuk konteks awal; baca guide routing, auth, server/client boundary, dan deployment yang relevan lagi saat tahap coding.
3. **PostgreSQL terisolasi:** usulkan database khusus CF Studio dengan role aplikasi/migrasi sendiri. Jika infrastruktur mengharuskan schema terpisah, hindari fallback ke tabel operasional V2 melalui `public`; uji resolusi tabel dan grants. Akun pembaca migrasi hanya membaca sumber.
4. **Mesin diadopsi, navigasi disederhanakan:** pertahankan processor produksi terpilih, gunakan compiler/normalizer per sumber sampai paket produksi standar; tahap rendering hanya satu implementasi bersama. Tidak perlu memindahkan semua halaman/menu V2.
5. **Worker terpisah dari web:** proses web tidak otomatis menyalakan scheduler saat boot. Worker CF Studio memiliki antrean, lease, identitas, media namespace, dan konfigurasi sendiri. Callback G-Labs/provider harus memiliki routing namespace CF Studio; ID task tidak boleh bertabrakan dengan V2.
6. **Snapshot berversi:** run merujuk revisi rutinitas aktif, konfigurasi brand/produk/preset/sumber pada saat dispatch. Perubahan draft tidak mengubah run berjalan.
7. **Keputusan tetap terbuka:** default creative approval otomatis/manual, login import/SSO, self-approval, batas kapasitas/biaya/retensi, dan kemampuan akun Repliz. Ditutup sebelum fase yang bergantung padanya, bukan sebelum seluruh pekerjaan bisa dimulai.

## 3. Temuan awal yang memengaruhi implementasi

| Temuan V2 | Implikasi untuk CF Studio |
|---|---|
| `lib/tenant-context.js` mempunyai fallback default tenant | Ganti dengan tenant context wajib pada jalur aplikasi/worker; default tenant bukan fallback untuk request tak dikenal |
| `lib/db-pg.js` mempunyai konfigurasi koneksi fallback, penambahan `public` ke search path, dan migrasi saat startup | Jangan menyalin apa adanya; wajib konfigurasi eksplisit, role terbatas, migrasi terpisah, tanpa credential literal |
| `instrumentation.js` menyalakan beberapa layanan latar belakang | Jangan menyalinnya sebagai bootstrap CF Studio; web dan worker dipisahkan |
| Automation contract V2 berorientasi operator request dan memiliki pembatasan pilot | Perlu model rutinitas multi-target dan adapter; jangan sekadar menambah opsi dropdown |
| Multiplier menggunakan hasil deconstruct; jalur resep/video memiliki processor berbeda | Validasi sumber berdasarkan jalur, bukan satu field sumber generik untuk semua |
| Auth V2 memiliki role admin/superadmin, menu permission dan brand assignment | Pertahankan kompatibilitas identitas, tambah capability server-side dan pengujian akses objek |
| Exact revision approval sudah tersedia pada beberapa jalur V2 | Adopsi invariant tersebut, perluas ke approval final dan publishing intent |
| PRD menetapkan media sebagai bagian migrasi | Inventaris database saja tidak cukup; perlu manifest media, dependency, serta verifikasi akses/checksum |

Temuan berasal dari inspeksi kode, bukan audit database atau verifikasi layanan hidup. Jumlah data, ukuran media, kelengkapan dependency, dan throughput belum diketahui.

## 4. Urutan implementasi dan keluaran tiap fase

### Fase 0 — Baseline, dependency dan keputusan operasional

- Catat commit SHA sumber V2, dependency terpakai, skema/tabel aktual, provider, callback, storage, dan proses yang berjalan.
- Inventaris lima domain default tenant secara read-only: jumlah, foreign/reference dependencies, status arsip, duplikasi dan media.
- Pastikan apakah data operasional yang ingin diimpor berasal dari schema dev/staging/public atau lingkungan lain; jangan menganggap default tenant identik pada semua schema.
- Petakan preset sistem/global dan dependency universe/karakter serta assignment yang dibutuhkan tanpa membawa objek tenant lain.
- Selesaikan lokasi repository baru, ruang database/storage, host/port, dan login baseline.

**Keluaran:** manifest adopsi berisi file+SHA, dependency map, laporan inventaris tanpa secret, decision log, serta baseline pengujian mesin.
**Gate:** tidak ada mutasi database sumber; tidak ada worker CF Studio terhubung ke antrean V2.

### Fase 1 — Mockup seluruh flow dan kontrak

- Perluas mockup HTML standalone yang sudah ada agar menampilkan tepat empat tab Automation; tab History saat ini belum ada pada mockup.
- Lengkapi state draf/aktif/revisi belum diterapkan, lima jalur, CEP otomatis, creative review, final review, kalender, riwayat dan keadaan gagal.
- Tambahkan simulasi role/capability, konteks tenant/brand, media hilang dan konflik import pada materi review bila diperlukan.
- Tunjukkan mockup untuk review pengguna sebelum menulis/mengubah komponen React terkait, sesuai SOP.
- Tetapkan kontrak API, state transition dan error taxonomy per domain. Kontrak membedakan draft save, activation, run once dan publishing.

**Keluaran:** mockup reviewable, daftar keputusan UI yang diterima, kontrak data/API.
**Gate:** mockup alur UI disimulasikan kepada pengguna sebelum coding UI utama. Persetujuan produk yang belum jelas ditandai dan tidak diasumsikan.

### Fase 2 — Bootstrap aplikasi, database dan akses

- Buat repository/checkout baru dan branch dengan prefix `codex/`; identitas produk CF Studio V3. Nomor versi aplikasi baru tidak memakai nomor patch MAKNA Flow.
- Setup Next.js, konfigurasi eksplisit, semantic theme tokens V2, layout lima menu, error handling dan logging terstruktur.
- Buat migration runner terpisah, tabel tenant/user/permission dan default tenant tujuan. Tidak ada auto-migration ketika build/web boot.
- Adopsi sesi/auth V2 sesuai keputusan login; tambah capability dan scope brand/tenant pada API, worker dan URL media.
- Siapkan worker entrypoint, tetapi execution/provider dispatch tetap OFF sampai gate kesiapan.

**Keluaran:** aplikasi dapat login, navigasi dan tenant context benar, database terisolasi, build lulus.
**Gate:** uji akses lintas tenant dan role lulus sebelum memuat katalog migrasi ke UI.

### Fase 3 — Menu adopsi dan trial migration

- Adopsi Product Database dan Deconstruct Lab dengan service/API/UI yang diperlukan.
- Adopsi Brand Profile Manager sebagai daftar brand. Klik nama membuka detail brand dengan tab Preset (default) dan Visual Identity. Profil/produk melalui Edit Brand/area informasi; bukan tab utama tambahan. Pisahkan preset tenant dari preset sistem baca-saja dan validasi assignment per brand.
- Buat migrator: inventory → plan/dry-run → snapshot/export → import dependencies/objects → media → relink → reconcile.
- Tentukan urutan berdasarkan graph relasi aktual. Relasi siklik ditangani dua tahap: objek dasar dulu, kemudian binding/reference.
- Gunakan origin key unik per sistem+tenant+domain+ID sumber. Simpan import batch, pemetaan ID, hash/revisi sumber dan konflik tujuan.
- Trial import ke database CF Studio disposable, ulangi import untuk membuktikan idempotensi. Delta tidak menimpa edit tujuan tanpa resolusi eksplisit.

**Keluaran:** kelima menu/domain dapat digunakan pada data trial, laporan relasi/media/konflik, runbook migrasi.
**Gate:** manifest lengkap dan tidak ada dangling reference internal yang dianggap berhasil. Dependency kritis hilang membuat objek belum siap produksi.

### Fase 4 — Rutinitas dan jadwal durable

- Buat routine draft/active revision dan production targets dinamis; produk wajib hanya untuk Product Campaign.
- Terapkan validasi sumber siap, brand-product binding, preset kompatibel, tenant aktif dan capability saat save/activate/run.
- Jadwal timezone-aware, missed-run skip/run-latest, manual run terpisah, pause/archive dan batas concurrency.
- Claim run dengan unique slot key, transaksi/lease, checkpoint, recovery dan pembatalan; jangan menggunakan timer memori sebagai satu-satunya sumber jadwal.
- Update draft rutinitas aktif tidak otomatis mengganti revisi aktif; tampilkan pending changes.

**Keluaran:** empat tab dasar memakai data nyata; routine run dapat diklaim tepat sekali per slot saat dua worker bersaing.
**Gate:** restart, crash di batas transaksi dan konflik edit tidak menciptakan run ganda.

### Fase 5 — Kompilasi materi dan konsolidasi pipeline bersama

**Dasar keputusan:** `production_pipeline_audit.md`. Lima jalur bukan lima worker G-Labs. Empat jalur video memakai compiler berbeda dan satu shared production pipeline. Resep foto/teks memakai shared image service + static finishing.

**5A — Characterization sebelum konsolidasi**

- Simpan fixture payload/storyboard/config empat sumber tanpa secret; cocokkan perilaku reference, durasi, voice, visual mode, mux dan recovery.
- Audit dependency shared helper, terutama akses batch TTS/database legacy di fungsi mux, serta format antrean/endpoint provider.
- Tentukan mode dispatch (queue atau direct) eksplisit. Jangan mempertahankan fallback direct saat enqueue gagal yang dapat mem-bypass antrean.

**5B — Kontrak paket dan compiler**

- Kontrak `ProductionPackage v1` berisi revision/fingerprint, scene IDs, prompt/mode/durasi/reference, voice/segments/fallback, kebijakan kreatif, mux settings dan metadata output.
- Compiler Multiplier: deconstruct + variation → materi kreatif → normalizer paket.
- Compiler Recipe video: Recipe Planner → recipe creative adapter → normalizer paket.
- Compiler Brand Editorial: Content Planner editorial → creative generator → normalizer paket.
- Compiler Product Campaign: produk → Content Planner CEP otomatis dan plan → creative generator → normalizer paket.
- Builder Recipe statis: Recipe Labs → teks + image requests; output kind static.
- Compiler tidak submit gambar/video, membuat audio atau memanggil FFmpeg. Source kind hanya menentukan compiler dan lineage, bukan metode render.

**5C — Shared execution**

- Start frame: lifecycle asset/revision/checkpoint/lane dari fondasi Pillar digeneralisasi, memakai shared image service.
- TTS: satu executor untuk single/multi-voice, MiniMax/Gemini, fallback dan language/model/speed/volume.
- Clip: satu executor I2V/T2V, persisting task ID/endpoint, reconcile sebelum retry dan reuse scene selesai.
- FFmpeg: satu executor dengan manifest audio/video eksplisit, Smart Sync, bridge, scale, BGM/SFX dan validasi completeness. Dukungan native audio/TTS-off harus eksplisit.
- G-Labs: satu jenis worker/gateway image/video, dapat beberapa instance; identitas tenant dari payload diperiksa dan tenant context dipasang. Secret diselesaikan server-side melalui connection reference.
- Coordinator stage tidak menjadi submitter/poller kedua. Gunakan stage lease+heartbeat+fencing token agar hasil stale worker tidak mengubah revision aktif.
- Static finishing: grid/layout/text/export setelah shared image service. Lewati TTS/clip/mux.

**5D — Pembuktian paritas**

- Fake provider membandingkan request/manifest dari package setara untuk empat sumber; jangan membandingkan byte hasil AI nondeterministik.
- Uji retry satu scene, reference kritis, dialog/multi-voice, fallback codec, zero-valued settings, T2V/I2V, approval dan pemulihan submit ambigu.
- Setelah tes kontrak lulus, satu item nyata per capability/jalur pada tenant uji, lalu pilot batch.

**Keluaran:** compiler berbeda, satu kode render bersama, manifest artifact standar.
**Gate:** CF Studio tidak memiliki renderer Multiplier/Pillar terpisah permanen; normalizer menjaga paritas fitur V2, dan provider worker tidak digandakan per source kind. Tidak ada perubahan mesin V2 asli dalam konsolidasi ini.

### Fase 6 — Daily Review, approval dan Telegram

- Render video asli/foto/grid, resep lengkap, metadata sosial, target/planner/source lineage, produk dan CEP hasil mesin.
- Creative approval mengikuti keputusan kebijakan; persetujuan otomatis dicatat sebagai sistem berbasis versi preset.
- Approval final selalu manusia, cocokkan revision/hash dan capability brand; edit/regenerasi membuat revision baru dan menginvalidasi approval sebelumnya.
- Bulk approval melaporkan hasil per item, bukan menyembunyikan partial failure.
- Outbox Telegram, verifikasi penerima, preferensi/quiet hours, batch deep-link terautentikasi dan deduplikasi event.
- Pisahkan failure produksi, publishing dan notifikasi.

**Keluaran:** user dapat review sebagian batch, meminta revisi dan menyetujui versi final.
**Gate:** stale approval, akses reviewer brand lain, dan edit setelah approval ditolak/ditangani dengan benar.

### Fase 7 — Schedule, Repliz dan History

- Implementasi publishing intent lokal untuk versi disetujui, akun tujuan dan waktu; preflight sebelum dispatch.
- Uji format media/platform, akses media, judul/caption, token akun dan kemampuan reschedule/cancel yang benar-benar tersedia.
- Rekonsiliasi respons ambigu sebelum retry; satu intent tidak membuat kiriman ganda setelah timeout.
- Schedule memisahkan status lokal dan provider. Published hanya berdasarkan bukti provider, bukan request diterima.
- Perubahan konten yang sudah diterima provider memerlukan pembatalan/pembaruan terkonfirmasi; revisi lokal tidak diam-diam mengganti jadwal lama.
- History menggabungkan run, stage, revision, keputusan, publishing attempt, notification dan audit dengan filter.

**Keluaran:** alur produksi → review → schedule → status provider end-to-end, audit dapat ditelusuri.
**Gate:** production posting tidak dipakai sebagai pengujian tanpa otorisasi tujuan/konten; gunakan akun uji/sandbox jika didukung. Mock provider menguji failure terlebih dahulu.

### Fase 8 — Final migration, pilot dan release

- Ulangi inventory dan dry-run pada sumber/tujuan final; backup dan manifest disiapkan.
- Ambil snapshot konsisten dan tangani delta atau jeda edit terkoordinasi pada lima domain; jangan menghentikan aplikasi V2 secara keseluruhan tanpa kebutuhan.
- Jalankan final import, verifikasi seluruh origin keys, counts, binding/reference, file/checksum, URL eksternal dan exception report.
- Jalankan pilot Nutribake 2 Multiplier + 2 Recipe video + 2 resep foto/teks; uji Brand Editorial dan Product Campaign dalam batch terkontrol.
- Ukur kapasitas/antrean, biaya dan ketepatan dispatch sebelum menaikkan jumlah atau tenant.
- Siapkan dokumentasi operasional, restore drill dan release. CI/build tidak memigrasikan DB atau menyalakan worker.

**Keluaran:** pilot berfungsi, katalog default tenant utuh/pengecualian dijelaskan, paket rilis dan runbook siap.
**Gate:** deployment production hanya setelah instruksi manual eksplisit pengguna; aplikasi baru tidak memakai folder/port/proses V2 tanpa konfigurasi yang disepakati.

## 5. Strategi migrasi dan pemulihan

- Source environment dan source/default tenant ID diverifikasi secara eksplisit; source connection read-only.
- Destination database/schema/tenant/media namespace diverifikasi sebelum apply. Tolak sumber=tujuan.
- Manifest memisahkan object status, media status dan usability; status berhasil tidak diberikan hanya karena INSERT berhasil.
- Inventory/export/import berjalan berbatas batch dengan checkpoint; media dapat dilanjutkan tanpa menyalin ulang file yang sudah cocok.
- Preset global dipetakan berdasarkan key+versi kompatibel, bukan sekadar nama. Dependency lintas tenant tidak ikut diimpor.
- Tidak mengimpor credentials, sessions, antrean aktif, rutinitas aktif atau jadwal Repliz. Import tidak memanggil AI, mengirim pesan atau publishing.
- Pemulihan mengacu import batch dan hanya boleh mengubah objek yang masih cocok dengan fingerprint hasil import. Objek yang sudah diedit/dipakai CF Studio menjadi konflik yang memerlukan resolusi.
- Checksum untuk file yang disalin, access check untuk referensi eksternal, dan laporan media hilang. Sumber V2 tidak dihapus.

## 6. Kontrak API dan keamanan

Gunakan API versioned CF Studio; nama endpoint final dikunci pada fase 1. Keluarga endpoint:

| Area | Tindakan |
|---|---|
| Catalogs | CRUD produk, deconstruct, brand, visual identity, preset dan binding |
| Routines | Save draft, target CRUD, activate revision, pause, archive, run once |
| Runs/items | Read progress, retry stage, cancel, edit revision, creative/final review |
| Publishing | Preflight, create intent, reschedule, cancel, reconcile |
| Notifications | Connect/verify Telegram, preferences, authorized test |
| History/admin | Audit, import report, tenant/user/brand capability |

Mutasi menerima expected revision atau ETag untuk mencegah lost update; create/dispatch menggunakan idempotency key. Semua objek diperiksa tenant+brand+capability di server. Worker memeriksa kembali kebijakan aktif sebelum memulai side effect baru. Tanggapan API tidak menyertakan secret atau log mentah.

## 7. Verifikasi dan Definition of Done

| Kelompok | Pengujian yang diperlukan |
|---|---|
| Kontrak | Lima jenis target, produk wajib, CEP tanpa input manual, source/preset valid |
| Scheduler | Timezone, missed slots, run once, dua worker, lease expiry, restart dan checkpoint |
| Tenant/izin | Dua tenant dan dua brand, ID tebakan, media URL, bulk endpoint, superadmin context, tenant suspended |
| Revisi | Draft vs active, stale edit/approval, regenerate, approval hash dan publishing snapshot |
| Migrasi | Dry-run tidak mutate, rerun tanpa duplikat, delta conflict, dependency siklik, media hilang, resume dan rollback terbatas |
| Paritas produksi | Empat source kind dengan paket ekuivalen memakai request/mux sama; multi-voice, I2V/T2V, reference, fallback dan static skip terjaga |
| Provider | Fake timeout/transient/permanent/unknown outcome, callback duplikat, reconnect, format media dan rate limit |
| UI | Review manual pengguna pada mockup dan aplikasi; light/dark, mobile, keyboard dan state gagal |
| Integrasi nyata | Satu item valid per jalur sebelum batch pilot; Telegram dan Repliz pada tujuan uji yang diotorisasi |

Definition of Done tiap fase: hasil fase nyata tersedia, tes bermakna lulus, keterbatasan dicatat, tidak ada secret, checklist diperbarui dan perubahan software dirilis sesuai SOP repository terkait. Build seluruh aplikasi diperlukan setelah perubahan lintas modul; hindari mengulang tes luas yang sudah lulus tanpa perubahan relevan. Tidak membuat tes kosmetik yang hanya menyalin implementasi.

## 8. Rilis dan deployment

- Untuk perubahan software MAKNA Flow yang memang diperlukan, ikuti rilis patch non-interaktif dan sinkronisasi main/tag sesuai AGENTS.md. Batasi staging agar file pekerjaan lain tidak ikut ter-commit.
- CF Studio memiliki version/changelog/tag dan remote sendiri setelah ditetapkan; jangan merilis kode CF Studio ke remote MAKNA Flow secara tidak sengaja.
- Dokumen rencana ini tidak memicu perubahan versi aplikasi karena belum mengimplementasikan fitur/refaktor/bugfix.
- Deployment Dev/Staging Mac Mini harus mengikuti SoT atomic: immutable full SHA tersedia di remote, build remote pada release baru, migrasi otomatis dimatikan, shared mutable paths, PM2 delete/start dengan validasi cwd, health dan rollback.
- Jangan menyalin konfigurasi pool antar aplikasi tanpa anggaran koneksi agregat. Batas V2 tetap dipertahankan; alokasi CF Studio ditetapkan sebelum deployment.
- Tidak melakukan polling SSH loop. Selama remote build tunggu melalui sesi deployment yang sama.
- Pemulihan symlink/file tidak memulihkan database. Migrasi schema/data punya backup, kompatibilitas dan prosedur pemulihan sendiri.

## 9. Keputusan dan dependency yang harus ditutup

| Keputusan | Batas waktu | Default usulan |
|---|---|---|
| Repository/path, host/port, database/storage | Sebelum bootstrap | Aplikasi dan ruang data terpisah |
| Sumber data V2 aktual | Sebelum inventory/migration | Pilih satu environment otoritatif secara eksplisit |
| Login akun | Sebelum auth import | Sesi baru; jangan menyalin token sesi |
| Creative approval | Sebelum shared auto-render diaktifkan | Kebijakan per rutinitas; final manual selalu |
| Role mapping dan self-approval | Sebelum final approval/publishing | Capability eksplisit; catat kombinasi izin |
| Kuota, concurrency, retensi | Sebelum provider pilot | Konservatif, berdasarkan inventaris dan pengukuran |
| Provider publishing dan akun uji | Sebelum live integration | Verifikasi kemampuan nyata per akun/media |

Tidak memberikan estimasi kalender sebelum inventaris dependency/data dan kapasitas selesai. Pengerjaan berurutan mengikuti gate; pekerjaan desain kontrak dapat berjalan tanpa menunggu migrasi final. Rencana ini tidak mengasumsikan delegasi ke subagent.

## Execution Task List

Checklist ini wajib diperbarui dari `- [ ]` menjadi `- [x]` setelah setiap tahap benar-benar selesai. Penyusunan rencana tidak menandai implementasi sebagai selesai.

- [x] Baca PRD 1.1, mockup dan modul V2 relevan; identifikasi risiko adopsi.
- [x] Susun rencana fase, pemetaan file, before/after, verifikasi dan gate delivery.
- [ ] Fase 0: tetapkan lingkungan/repository, inventaris dependency dan lima domain default tenant.
- [ ] Fase 1: lengkapi mockup empat tab dan review pengguna; kunci kontrak API/state.
- [ ] Fase 2: bootstrap aplikasi/database terisolasi, auth/tenant/capability dan worker OFF.
- [ ] Fase 3: adopsi menu, trial migration objek/relasi/media, idempotensi dan rekonsiliasi.
- [ ] Fase 4: implementasi routine draft/active, target CRUD, schedule/claim/checkpoint.
- [x] Audit statis tahapan V2 dan dokumentasikan bukti, perbedaan capability serta gap queue/lease.
- [ ] Fase 5A: characterization fixtures dan audit dependency shared services/provider transport.
- [ ] Fase 5B: kontrak ProductionPackage dan empat compiler video + builder resep statis.
- [ ] Fase 5C: shared start-frame/TTS/clip/FFmpeg, satu G-Labs gateway dan static finishing.
- [ ] Fase 5D: uji parity empat sumber, native-audio modes, retry/lease/reference dan provider nyata terkontrol.
- [ ] Fase 6: Daily Review, approval revisi, regenerasi dan Telegram terverifikasi.
- [ ] Fase 7: Repliz preflight/intent/reconcile, Schedule dan History.
- [ ] Fase 8a: final migration lima domain default tenant dan laporan kelengkapan.
- [ ] Fase 8b: pilot lima jalur, failure recovery, isolasi tenant/brand dan kapasitas.
- [ ] Fase 8c: dokumentasi operasi, rilis dan deployment lingkungan yang diotorisasi.

## 10.1. Diagram batas tanggung jawab

```mermaid
flowchart TD
  M[Deconstruct + variasi] --> MC[Multiplier compiler]
  R[Recipe Planner] --> RC[Recipe compiler]
  E[Brand Editorial Planner] --> EC[Editorial compiler]
  P[Produk + Planner menghasilkan CEP] --> PC[Product compiler]
  MC --> PK[ProductionPackage video]
  RC --> PK
  EC --> PK
  PC --> PK
  PK --> SF[Shared start frame]
  SF --> CA[Creative gate]
  CA --> TT[Shared TTS]
  TT --> CL[Shared clip]
  CL --> FF[Shared FFmpeg]
  SF --> GI[Shared image service]
  CL --> GV[Shared video service]
  GI --> G[One G-Labs worker implementation]
  GV --> G
  S[Recipe Labs foto dan teks] --> GI
  S --> ST[Static finishing: grid dan teks]
  GI --> ST
  FF --> OUT[Final review]
  ST --> OUT
  OUT --> PUB[Approved revision ke Repliz]
```

Diagram menunjukkan alur default; skip start frame/TTS atau mode native audio ditentukan capability paket dan preset, bukan jalur sumber. Instance worker dapat ditambah tanpa membuat kode renderer per sumber. Shared service berarti kode dan protokol sama; isolation tenant/environment tetap wajib. Koordinasi kapasitas endpoint fisik yang juga dipakai V2 harus disepakati sebelum pilot.

## 11. Cara memakai daftar file

Bagian 12 adalah baseline file yang direncanakan dibuat/diubah. Contoh After merupakan kontrak/desain ilustratif, bukan kode lengkap yang siap dijalankan. Helper yang disebut akan didefinisikan saat implementasi. Untuk file baru, Before adalah belum ada. File V2 yang diadopsi tanpa perubahan dicatat dalam manifest adopsi berdasarkan SHA; bila ternyata perlu diubah, tambahkan file tersebut beserta potongan Before aktual dan After usulan ke rencana ini sebelum edit.

File dokumentasi hasil fase, fixture, dan unit/integration test baru mengikuti daftar baseline. Jika pemetaan teknis memerlukan file tambahan, perbarui daftar serta before/after terlebih dahulu. Jangan menganggap nama file konseptual ini sudah ada di repository CF Studio.

## 12. File Plan — Before & After Code Snippets

### 12.1. `MAKNA Flow: public/mockup_brand_daily_routine.html`

Revisi mockup empat tab sebelum coding UI.

**Code Sebelum (Current/Before)**

```html
<button data-tab="calendar" onclick="showTab('calendar')">03 &nbsp; Jadwal publikasi</button>
```

**Code Sesudah (Proposed/After)**

```html
<button data-tab="calendar">03 Schedule</button>
<button data-tab="history">04 History</button>
```

### 12.2. `CF Studio: docs/adoption-manifest.json`

Catat sumber copy beserta dependency dan efek startup.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```json
{ "sourceCommit": "VERIFIED_GIT_SHA", "files": [], "sideEffectAudit": [] }
```

### 12.3. `CF Studio: package.json`

Bootstrap runtime/dependency yang dipin setelah audit.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```json
{ "name": "cf-studio", "version": "3.0.0", "private": true }
```

### 12.4. `CF Studio: next.config.mjs`

Konfigurasi aplikasi terpisah, mengikuti guide versi terpasang.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export default { /* konfigurasi hasil audit kompatibilitas */ };
```

### 12.5. `CF Studio: .env.example`

Nama konfigurasi tanpa nilai secret atau fallback jaringan V2.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```dotenv
APP_NAME=CF Studio
APP_ROLE=web
DATABASE_URL=
MEDIA_NAMESPACE=cf-studio
ENABLE_PRODUCTION_DISPATCH=false
ENABLE_PUBLISHING_DISPATCH=false
```

### 12.6. `CF Studio: lib/runtime-config.js`

Fail-fast konfigurasi, tanpa menulis credential literal.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export function readConfig(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL wajib');
  return { databaseUrl: env.DATABASE_URL, appRole: env.APP_ROLE };
}
```

### 12.7. `CF Studio: lib/db-pg.js`

Ganti bootstrap DB V2 berisiko dengan koneksi eksplisit.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export function createAppPool(config) {
  return new Pool({ connectionString: config.databaseUrl, max: config.poolMax });
}
// Migrasi hanya melalui migration runner, bukan startup web.
```

### 12.8. `CF Studio: db/migrations/001_cf_studio.sql`

Tenant, capability, routine revisions, runs, approval, publishing dan import ledger; schema final mengikuti audit. Tambahkan production_packages, scene_assets, provider_jobs dan fencing token pada stage executions.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```sql
CREATE UNIQUE INDEX automation_run_slot_uq
ON automation_runs (tenant_id, routine_id, scheduled_slot)
WHERE execution_mode = 'scheduled';
-- Tambahkan FK tenant-aware dan migration ledger pada schema final.
```

### 12.9. `CF Studio: scripts/migrate.mjs`

Jalankan migrasi berversi dengan lock eksplisit.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
await withMigrationLock(async () => {
  await applyPendingMigrations({ database: targetDatabase });
});
```

### 12.10. `CF Studio: lib/access-control.js`

Server-side tenant, brand, capability untuk API dan worker.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function assertAccess(actor, object, capability) {
  assertTenant(actor.tenantId, object.tenantId);
  await assertBrandAssignment(actor, object.brandId);
  assertCapability(actor, capability);
}
```

### 12.11. `CF Studio: lib/auth.js`

Adopsi sesi V2 dengan pemeriksaan izin baru.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function authorize(request, capability) {
  const actor = await requireSession(request);
  await requireActiveTenant(actor);
  return requireCapability(actor, capability);
}
```

### 12.12. `CF Studio: lib/tenant-context.js`

Hilangkan fallback default tenant pada salinan modul.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export function getActiveTenantId() {
  const tenantId = tenantContext.getStore();
  if (!tenantId) throw new Error('TENANT_CONTEXT_REQUIRED');
  return tenantId;
}
```

### 12.13. `CF Studio: app/layout.js`

Shell baru; menu adopsi dan Automation, bukan semua menu V2.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default function Layout({ children }) {
  return <html lang="id"><body><StudioShell>{children}</StudioShell></body></html>;
}
```

### 12.14. `CF Studio: app/theme.css`

Salin semantic tokens terverifikasi V2 tanpa warna ad-hoc.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```css
:root { /* token resmi disalin dari app/theme.css V2 */ }
[data-theme="light"] { /* token light resmi V2 */ }
.panel { background: var(--surface); color: var(--text-primary); }
```

### 12.15. `CF Studio: lib/catalog-service.js`

Facade domain menu adopsi; setiap query tenant/brand-aware.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function getCatalogItem(actor, domain, id) {
  const item = await repository(domain).findInTenant(actor.tenantId, id);
  await assertAccess(actor, item, domain + ".read");
  return item;
}
```

### 12.16. `CF Studio: app/products/page.js`

Adopsi Product Database setelah dependency audit.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default async function ProductsPage() {
  const actor = await requirePageAccess("products.read");
  return <ProductDatabase items={await listProducts(actor)} />;
}
```

### 12.17. `CF Studio: app/deconstruct/page.js`

Adopsi Deconstruct Lab dengan sumber siap Multiplier.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default async function DeconstructPage() {
  const actor = await requirePageAccess("deconstruct.read");
  return <DeconstructWorkspace assets={await listAssets(actor)} />;
}
```

### 12.18. `CF Studio: app/brands/page.js`

Brand manager menggabungkan produk, identity dan preset.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default function BrandsPage() {
  return <BrandList onSelectBrand={openBrandDetail} />;
  // Detail brand: <BrandDetail tabs={["Preset", "Visual Identity"]} />
}
```

### 12.19. `CF Studio: app/settings/page.js`

User/tenant/integrasi mengikuti capability.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default async function SettingsPage() {
  return <SettingsWorkspace capabilities={await getPageCapabilities()} />;
}
```

### 12.20. `CF Studio: lib/automation-contract.js`

Model lima target; CEP selalu hasil planning.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
const kinds = ['multiplier', 'recipe_video', 'recipe_static', 'brand_editorial', 'product_campaign'];
export function validateTarget(target) {
  assertKnownKind(target.kind, kinds);
  if (target.kind === 'product_campaign') requireProduct(target.productId);
  if ('cep' in target) throw new Error('CEP_IS_PLANNER_OUTPUT');
}
```

### 12.21. `CF Studio: lib/automation-service.js`

Draft save berbeda dari activation; revision guard.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function activateRoutine(actor, id, revision) {
  return transaction(async tx => {
    const draft = await tx.lockRoutineRevision(actor.tenantId, id, revision);
    await validateActivation(actor, draft);
    return tx.setActiveRevision(id, revision);
  });
}
```

### 12.22. `CF Studio: lib/automation-repository.js`

Claim durable atomik, unique slot dan lease.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function claimRun(workerId) {
  return transaction(tx => tx.claimDueRun({
    workerId, lockMode: "SKIP LOCKED", requireActiveTenant: true
  }));
}
```

### 12.23. `CF Studio: lib/production-adapters.js`

Registry compiler kreatif; bukan registry renderer per jalur.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export const compilers = {
  multiplier: multiplierCompiler, recipe_video: recipeCompiler,
  recipe_static: staticRecipeBuilder, brand_editorial: editorialCompiler,
  product_campaign: productCompiler
};
// Masing-masing hanya menghasilkan ProductionPackage; tidak render.
```

### 12.24. `CF Studio: lib/production-worker.js`

Checkpoint, provider reconcile dan retry stage.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function executeClaim(claim) {
  return withRequiredTenant(claim.tenantId, async () => {
    const pkg = await loadValidatedPackage(claim.packageId, claim.revision);
    // Pilih tahap dari capability/manifest; bukan dari source kind.
    return sharedPipeline.executeNextCheckpoint(pkg, claim);
  });
}
```

### 12.25. `CF Studio: scripts/worker.mjs`

Worker process terpisah dari Next web.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
const config = readConfig(process.env);
assertWorkerRole(config);
await startOwnedWorkers({ queueNamespace: 'cf-studio', dispatchEnabled: config.dispatchEnabled });
```

### 12.26. `CF Studio: app/automation/page.js`

Empat tab tepat sesuai PRD.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```jsx
export default function AutomationPage() {
  return <AutomationWorkspace tabs={["Setting Automation", "Daily Review", "Schedule", "History"]} />;
}
```

### 12.27. `CF Studio: app/api/v3/[...segments]/route.js`

Router API dengan handler per domain terotorisasi; pecah file bila perlu saat kontrak dikunci.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function POST(request, context) {
  const { segments } = await context.params;
  return dispatchAuthorizedMutation({ request, segments });
}
```

### 12.28. `CF Studio: lib/review-service.js`

Exact revision approval dan audit.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function approveFinal(actor, itemId, revision) {
  return transaction(async tx => {
    const item = await tx.lockItem(actor.tenantId, itemId);
    await assertAccess(actor, item, "content.approve");
    assertExactRevision(item, revision);
    return tx.recordHumanApproval(item, revision, actor.id);
  });
}
```

### 12.29. `CF Studio: lib/notification-service.js`

Outbox, verified recipient dan scope brand.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function enqueueReviewNotice(event) {
  const recipients = await verifiedAuthorizedRecipients(event);
  return outbox.insertOnce({ eventKey: event.key, recipients, runId: event.runId });
}
```

### 12.30. `CF Studio: lib/publishing-service.js`

Approval snapshot, preflight dan dedup intent.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function createPublishingIntent(actor, input) {
  await assertApprovedRevision(actor, input.itemId, input.revision);
  await preflightMediaAndAccount(actor, input);
  return publishingRepository.createIntentOnce(input);
}
```

### 12.31. `CF Studio: lib/publishing-worker.js`

Respons ambigu tidak langsung membuat jadwal baru.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function processIntent(intent) {
  const known = await reconcileProvider(intent);
  if (known.outcome === "unknown") return markNeedsReconciliation(intent);
  return submitOnlyIfNotAccepted(intent, known);
}
```

### 12.32. `CF Studio: lib/history-service.js`

Timeline aman dan scoped.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function getHistory(actor, filters) {
  return historyRepository.list({ tenantId: actor.tenantId,
    brandIds: await allowedBrands(actor), filters, redactSecrets: true });
}
```

### 12.33. `CF Studio: lib/import-service.js`

Pemetaan origin ID, conflicts, relink dan manifest.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function importObject(source, batch) {
  const origin = [source.system, source.tenantId, source.domain, source.id];
  return importRepository.upsertMapped({ origin, batch,
    conflictPolicy: "report", preserveDestinationEdits: true });
}
```

### 12.34. `CF Studio: scripts/import-default-tenant.mjs`

Dry-run default dan explicit source/destination.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
const options = parseImportOptions(process.argv);
await assertDifferentDatastores(options);
await assertVerifiedTenantMapping(options);
await runImport({ ...options, apply: options.apply === true, sideEffects: false });
```

### 12.35. `CF Studio: tests/cf-studio.integration.test.mjs`

Tes invariant lintas modul bermakna, fixture dua tenant.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```javascript
test("tenant lain tidak dapat menjadwalkan revision yang disetujui", async () => {
  await expectForbidden(() => scheduleAs(otherTenantActor, approvedItem));
});
test("retry import tidak menggandakan origin", verifyIdempotentImport);
test("empat sumber memakai shared renderer yang sama", verifyRenderParity);
```

### 12.36. `CF Studio: docs/operations.md`

Runbook proses, antrean, DB, import dan provider.

**Code Sebelum (Current/Before)**

```text
Belum ada di aplikasi CF Studio baru. Sumber V2 tidak diubah oleh pembuatan file ini.
```

**Code Sesudah (Proposed/After)**

```markdown
# Operasi CF Studio
- Verifikasi target environment dan worker ownership.
- Pisahkan rollback aplikasi, schema, dan import batch.
- Rekonsiliasi provider sebelum mengulangi submission ambigu.
```


## 12A. Tambahan File Plan Setelah Audit

Semua path berikut berada di repository CF Studio baru. Modul V2 asli hanya dibaca sebagai sumber adopsi. Potongan After adalah usulan kontrak, bukan implementasi selesai.

### `CF Studio: lib/production-package.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export function validatePackage(pkg) {
  requireStableSceneIds(pkg);
  validateReferencesVoicesAndMux(pkg);
  return freezeAndFingerprint(pkg);
}
```

### `CF Studio: lib/shared-pipeline.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function executeNextCheckpoint(pkg, claim) {
  const stage = nextReadyStage(pkg, claim.manifest);
  return executeFencedStage(claim, () => stageServices[stage](pkg, claim));
}
```

### `CF Studio: lib/shared-image-service.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function submitImage(request) {
  await assertReferenceIntegrity(request);
  return providerJobs.submitOnce("image", request);
}
```

### `CF Studio: lib/shared-tts-service.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function renderSceneAudio(scene, settings) {
  return renderVoiceSegmentsWithExplicitFallback(scene, settings);
}
```

### `CF Studio: lib/shared-clip-service.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function renderClip(scene, context) {
  await requireStartFrameWhenNeeded(scene);
  return providerJobs.reconcileOrSubmit("video", scene, context);
}
```

### `CF Studio: lib/shared-mux-service.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function renderFinal(manifest, settings) {
  assertOrderedCompleteManifest(manifest, settings.audioMode);
  return muxPrimitive(manifest, settings);
}
```

### `CF Studio: scripts/glabs-worker.mjs`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
await consumeProviderJobs(async job => {
  return withRequiredTenant(job.data.tenantId, () => executeProviderJob(job.data));
});
```

### `CF Studio: lib/provider-jobs.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function submitOnce(type, request) {
  return persistAndEnqueueThroughOutbox({ type, request, connectionRef: request.connectionRef });
  // Tidak menyimpan secret dalam payload dan tidak fallback direct diam-diam.
}
```

### `CF Studio: lib/static-finishing-service.js`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
export async function finishStatic(pkg, manifest) {
  return exportRecipeBundle({ images: manifest.images, text: pkg.recipe, layout: pkg.layout });
}
```

### `CF Studio: tests/production-parity.test.mjs`

**Code Sebelum (Current/Before)**

```text
Belum ada pada aplikasi CF Studio baru.
```

**Code Sesudah (Proposed/After)**

```javascript
test("renderer tidak bercabang atas source kind", verifyEquivalentPackages);
test("stale lease tidak menyelesaikan revision baru", verifyFencedCompletion);
test("static recipe melewati TTS/video/mux", verifyStaticStages);
```

## 13. Pembaruan rencana selama eksekusi

Setelah tiap fase, tandai task selesai, tautkan commit/artefak dan hasil verifikasi. Jika scope, file, urutan dependency atau kontrak berubah, revisi rencana ini sebelum perubahan terkait dilakukan. Pertahankan jejak keputusan yang memengaruhi data, biaya, approval dan publikasi. Jangan mencentang trial/final migration sebelum laporan rekonsiliasi tersedia.

## 14. Eksekusi lokal terkonfirmasi

Root `/Users/sabeqmmursyid/_cfstudio`; sumber database schema staging; tujuan PostgreSQL terpisah. Worker dan provider dispatch OFF hingga gate integrasi. Remote CF Studio belum ditetapkan.

### File tambahan bootstrap

File berikut adalah tambahan manifest sebelum implementasi: `AGENTS.md`, `.gitignore`, `jsconfig.json`, `app/page.js`, `app/globals.css`, `app/Studio.js`, `app/api/health/route.js`, `lib/errors.js`, `lib/security.js`, `lib/schedule.js`, `lib/incidents.js`, `scripts/inventory-source.mjs`, `scripts/verify-environment.mjs`, `scripts/release.mjs`, `README.md`, `CHANGELOG.md`.

### `AGENTS.md`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `.gitignore`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `jsconfig.json`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `app/page.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `app/globals.css`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `app/Studio.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `app/api/health/route.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `lib/errors.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `lib/security.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `lib/schedule.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `lib/incidents.js`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `scripts/inventory-source.mjs`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `scripts/verify-environment.mjs`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `scripts/release.mjs`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `README.md`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```

### `CHANGELOG.md`

**Code Sebelum (Current/Before)**
```text
Belum ada pada root proyek kosong.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi fondasi terisolasi sesuai tanggung jawab file; validasi tenant, konfigurasi eksplisit, tanpa dispatch provider.
```


## 15. Manifest fase data/API

### `db/migrations/001_cf_studio.sql`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `scripts/migrate.mjs`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `lib/auth.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `lib/catalog-service.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `lib/automation-service.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `lib/review-service.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `app/api/health/route.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```
### `app/api/v3/[...segments]/route.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi SQL/API/service terotorisasi tenant dan brand sesuai PRD; konfigurasi database eksplisit.
```

## 16. Manifest inventory dan provisioning

### `lib/import-service.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

### `scripts/inventory-source.mjs`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

### `scripts/import-default-tenant.mjs`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

### `scripts/provision-admin.mjs`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

### `lib/automation-repository.js`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

### `docs/operations.md`
**Code Sebelum (Current/Before)**
```text
Belum ada.
```
**Code Sesudah (Proposed/After)**
```text
Implementasi inventory read-only, import dry-run, provisioning tujuan atau repository claim terfencing sesuai domain file.
```

## 17. Progress eksekusi — 1 November 2026

### Selesai dan diverifikasi

- [x] Root proyek baru dibuat di `/Users/sabeqmmursyid/_cfstudio`, sumber V2 tidak diubah.
- [x] PRD 1.4 mencatat root, staging sebagai sumber dan database PostgreSQL terpisah sebagai tujuan.
- [x] Mockup empat tab ditampilkan sebelum React UI; aplikasi lokal berisi lima menu dan empat tab Automation.
- [x] Dependency Next.js diperbarui dari kandidat 16.2.5 ke 16.4.3 setelah audit keamanan; audit paket bersih saat verifikasi.
- [x] Verifikasi default tenant staging dan inventaris tabel read-only: 27 produk, 202 deconstruct, 9 batch deconstruct, 7 brand, 6 identity, 23 binding, 21 preset kustom.
- [x] Manifest dependency V2 dibuat beserta hash file; credential dan env sumber tidak disalin.
- [x] Kontrak tenant wajib, capability+brand, paket produksi bersama, target lima jalur, CEP output-only, dan jadwal timezone dibuat.
- [x] Skema SQL dan migration runner ditulis; belum diaplikasikan atau diuji pada database tujuan.
- [x] API sesi, read katalog, simpan draf/activate revision dan final approval service dibuat; belum diuji integrasi DB.
- [x] Dry-run mapper terhadap data staging selesai untuk domain tabel; source transaction read-only, tidak ada penulisan tujuan. Media belum diverifikasi dan relink belum diterapkan.
- [x] 20 tes kontrak/invariant lulus (fake executor/pure functions, bukan tes PostgreSQL/provider hidup).
- [x] Production build Next.js lulus. Health HTTP 200 dan API privat HTTP 503 DATABASE_NOT_CONFIGURED terverifikasi ketika DB belum diisi.
- [x] Worker default OFF dan menolak dispatch sebelum adapter/gate siap.

### Belum selesai — tidak dianggap sebagai fitur produksi siap

- [ ] Database/user tujuan disediakan admin melalui environment lokal; akun sumber yang tersedia tidak memiliki CREATE DATABASE.
- [ ] Apply skema, provisioning login, tes transaksi PostgreSQL, FK tenant, auth dan CRUD secara end-to-end.
- [ ] Inventaris dependency/media lengkap (lokasi staging, ukuran, checksum, global preset/universe), migrator preset/binding/media, idempotensi apply dan rollback.
- [ ] Adopsi penuh UI dan operasi Product Database, Deconstruct Lab, Visual Identity/Preset Manager; UI sekarang baru fondasi daftar, bukan semua fitur V2.
- [ ] Scheduler loop durable, run once, heartbeat/lease recovery, compiler AI dan shared image/TTS/clip/FFmpeg services nyata. Shared pipeline saat ini kontrak executor terinjeksi; tidak menghasilkan media nyata.
- [ ] Daily Review, Schedule dan History dengan data hasil nyata; tab saat ini empty state yang menyatakan belum aktif.
- [ ] Delivery Telegram/outbox nyata, verifikasi penerima, koneksi Repliz, preflight dan reconciliation. Tes insiden saat ini hanya kontrak deduplikasi/pesan aman.
- [ ] Final migration dan pilot lima jalur sesuai gate PRD.
- [ ] Remote repository CF Studio ditetapkan sebelum push; tidak menggunakan remote MAKNA Flow.

### Bukti

- `docs/source-inventory.json`: kolom/jumlah sumber terverifikasi, tanpa nilai credential/data katalog.
- `docs/adoption-manifest.json`: kandidat adopsi dan hash/dependency.
- `npm test`: 20 lulus.
- `npm run build`: lulus dengan Next.js 16.4.3.
- Preview: `http://127.0.0.1:3100`, mockup: `/mockup_automation.html`.

### Langkah berikutnya setelah environment tujuan tersedia

1. Verifikasi DATABASE_URL berbeda dari sumber dan hak akses hanya database CF Studio.
2. Jalankan migration dry-run/apply pada tujuan dan siapkan admin dengan password dari environment, tanpa menampilkan nilainya.
3. Tes transaksi/isolation dan lanjutkan migrator relasi/media sebelum menampilkan katalog sebagai siap diproduksi.
4. Lanjutkan adapter materi AI dan shared render services dengan fake provider dahulu, kemudian integrasi terkontrol.

## 18. Koreksi kebutuhan — navigasi Brand Profile Manager

Kebutuhan dikonfirmasi pengguna: daftar brand → klik nama brand → detail dengan tab Preset dan Visual Identity. PRD 1.5 bagian 4.1 menjadi acuan; menggantikan usulan tab Overview/Products sebelumnya.

- [x] Perbarui PRD dan usulan struktur detail brand pada rencana.
- [ ] Simulasikan daftar/detail brand dan kedua tab pada mockup HTML sebelum perubahan React terkait.
- [ ] Implementasikan tautan nama brand, detail dan kembali ke daftar; default tab Preset.
- [ ] Hubungkan assignment preset/identity per tenant+brand, termasuk empty state, pemilihan dan capability.
- [ ] Uji assignment hasil migrasi, pergantian brand dan penolakan akses lintas brand.

File tambahan yang direncanakan: `app/brands/[brandId]/page.js`. Pada implementasi, UI awal yang berada di `app/Studio.js` perlu mengarahkan nama brand ke halaman tersebut; kondisi saat ini adalah daftar nama noninteraktif. Endpoint katalog perlu filter brand yang telah divalidasi di server, bukan filter UI saja.

### `app/brands/[brandId]/page.js`

**Code Sebelum (Current/Before)**
```text
Belum ada halaman detail brand di fondasi aplikasi.
```

**Code Sesudah (Proposed/After)**
```jsx
export default async function BrandPage({ params }) {
  const { brandId } = await params;
  const brand = await requireAuthorizedBrand(brandId);
  return <BrandDetail brand={brand} tabs={["Preset", "Visual Identity"]} />;
}
```

## 19. Preset hasil impor wajib dapat dipakai tanpa dibuat ulang

- [x] Tegaskan di PRD 1.6 bahwa preset default tenant staging ikut dimigrasikan dan dapat dipilih kembali.
- [ ] Lengkapi migrator preset dari `staging.tenant_settings` key `operator_presets_json`, bukan mencari tabel preset kustom yang tidak ada.
- [ ] Ambil seluruh preset pada snapshot final; baseline 21 hanya inventaris awal.
- [ ] Pertahankan key/nama, konfigurasi non-secret, versi tersedia dan kompatibilitas campaign; petakan dependency Visual Identity/produk/brand dengan origin ledger.
- [ ] Inventaris preset sistem/bawaan yang tersedia atau dirujuk; petakan key+versi kompatibel dan pertahankan sifat baca-saja.
- [ ] Pertahankan assignment brand yang benar-benar tersedia. Preset tanpa assignment tetap di katalog tenant dan dapat dipilih melalui aksi Pilih preset yang sudah ada.
- [ ] Verifikasi bahwa pemilihan preset hasil impor pada brand tidak membuat preset duplikat, tidak mengharuskan input ulang, dan menghasilkan parameter produksi yang setara dengan konfigurasi sumber.
- [ ] Rekonsiliasi seluruh preset terhadap snapshot final; laporkan dependency yang belum cocok tanpa menyatakan preset tersebut siap produksi.

Tidak diperlukan desain ulang preset dari nol. Import apply saat ini belum tersedia dan masih menunggu tahap migrasi relasi/media serta database tujuan, sebagaimana dicatat pada progress eksekusi.

## 20. Eksekusi Fase 0 — audit baseline lengkap

Baseline disetujui pengguna: pengembangan lokal port 3100, storage media terpisah dari V2, login awal akun CF Studio baru dengan role mapping V2. Remote/deployment host ditetapkan sebelum rilis. Sumber tetap staging default tenant, database tujuan khusus.

- [x] Konfirmasi baseline operasional tersebut.
- [x] Refresh snapshot inventory, status arsip/duplikasi, foreign references dan dependency preset.
- [x] Audit referensi media, jumlah/ukuran file lokal atau server sumber serta pengecualian.
- [x] Catat source SHA, closure dependency, callback/provider/storage dan status proses sumber read-only.
- [x] Jalankan baseline tes mesin yang aman tanpa provider dan catat kegagalan sebagai temuan.
- [x] Tulis decision log, gap, adoption manifest dan laporan gate Fase 0.

### `scripts/phase0-audit.mjs`
**Code Sebelum (Current/Before)**
```text
Belum ada audit lengkap Fase 0; inventory awal hanya menghitung tabel utama.
```
**Code Sesudah (Proposed/After)**
```javascript
await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const report = await auditTenantGraphStatusesAndMedia(source, verifiedTenant);
await source.query('ROLLBACK');
await writeSanitizedReport(report);
```

### `docs/phase0-report.md`, `docs/phase0-inventory.json`, `docs/phase0-decisions.md`
**Code Sebelum (Current/Before)**
```text
Belum ada laporan fase 0 lengkap.
```
**Code Sesudah (Proposed/After)**
```text
Bukti baseline, hitungan/relasi/media, keputusan terkonfirmasi, gap, tes dan status gate; tanpa credential/payload privat.
```

### Skrip bukti tambahan Fase 0

File: `scripts/phase0-dependency-audit.py`, `scripts/phase0-server-inspect.py`.

**Code Sebelum (Current/Before)**
```text
Tool audit lokal sementara; belum disimpan di repository CF Studio.
```
**Code Sesudah (Proposed/After)**
```text
Audit literal imports/hash dan inspeksi SSH baca-saja dengan JSON tersaring; tanpa secret, startup worker atau perubahan layanan.
```

Skrip ini untuk inventory. Daftar path media sementara tidak masuk Git. Tidak ada mutasi sumber.

Fase 0: pekerjaan audit di atas selesai dengan gap yang dinyatakan pada docs/phase0-report.md; gate pilihan baseline kode dan penanganan missing media menunggu jawaban pengguna. Fase berikutnya belum dimulai pada turn ini.
