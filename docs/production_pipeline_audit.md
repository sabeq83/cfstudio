# Audit Statis — Pipeline Produksi Bersama CF Studio V3

Tanggal: 1 November 2026. Baseline kode V2: `6c645e5cdf84d47d86a7e142c6e5679ba7bd25f2`.
Cakupan: pembacaan kode lokal, bukan pengujian server/provider atau klaim konfigurasi yang sedang aktif. Tidak mengubah mesin MAKNA Flow, tidak memanggil G-Labs/AI dan tidak menjalankan produksi.

## Kesimpulan

Lima jalur adalah lima sumber/strategi penyusunan materi, bukan lima worker G-Labs. Empat jalur video harus menghasilkan satu kontrak paket produksi dan masuk ke satu implementasi pipeline bersama. Resep foto/teks memakai primitive gambar yang sama, dilanjutkan grid/export, tanpa TTS/video/mux.

V2 sudah berbagi client provider dan fungsi mux, tetapi belum memiliki satu orchestration produksi generik. Menyalin worker Multiplier dan processor Pillar sebagai dua pipeline permanen akan mempertahankan duplikasi. Perlu mengekstrak capability yang ada, menormalisasi payload, dan memverifikasi paritas sebelum menghapus kebutuhan wrapper legacy pada CF Studio. Mesin V2 asli tidak perlu diubah untuk langkah ini.

## Bukti kode dan perbedaan aktual

| Area | Bukti sumber V2 | Temuan | Keputusan CF Studio |
|---|---|---|---|
| Sumber kreatif | `lib/re-multiplier-worker.js:347`; `lib/scheduler-processors.js:4899`; `lib/recipe-production-adapter.js` | Multiplier memakai hasil deconstruct; Pillar mendeteksi recipe dan mendelegasikan creative generation | Empat compiler video menghasilkan paket standar, tidak memanggil rendering sendiri |
| Start frame Multiplier | `lib/re-multiplier-worker.js:559` | Loop submit/poll/download sendiri; reference produk pada rentang bridge; model dan aspect ratio dari config | Pindahkan input ke per-scene request; jangan salin loop terpisah |
| Start frame Pillar | `lib/pillar-start-frame-service.js`; `lib/start-frame-worker.js`; `lib/start-frame-provider-adapter.js` | Asset berversi, checkpoint, lane exclusive/shared dan audit canonical context | Kandidat fondasi lifecycle bersama; generalisasi ketergantungan pada tabel/campaign Pillar |
| Reference produk | `lib/opc-start-frame-contract.js:13`; `lib/webhook-client.js:291` | Ada aturan product-critical dan pemeriksaan checksum reference | Wajib menjadi metadata per scene dan enforcement runtime, bukan prompt bebas saja |
| TTS | `lib/re-multiplier-worker.js:674`; `lib/scheduler-processors.js:5983` | Helper MiniMax/Gemini sama, orchestration terpisah. Pillar memiliki voice segments/multi-cast dan fallback eksplisit saat MiniMax gagal; wrapper Multiplier yang dibaca lebih sederhana | Shared TTS service mempertahankan multi-voice, bahasa, model, speed, volume dan kebijakan fallback; tidak menyamakan default secara diam-diam |
| Klip video | `lib/re-multiplier-worker.js:761`; `lib/scheduler-processors.js:6208` | Keduanya memanggil generateVideo, mendukung start image/T2V dan menyimpan task, tetapi recovery/status/indexing berbeda | Satu clip service dengan mode eksplisit, reference terverifikasi, stable scene ID dan manifest provider |
| Mux | `lib/re-multiplier-worker.js:1033`; `lib/scheduler-processors.js:6765`; `lib/video-studio-processor.js:550` | Keduanya memakai processTtsStudioMuxing. Wrapper berbeda pada video scale, BGM/SFX, bridge dan nama/path output. Helper membaca batch TTS dari DB dan memeriksa jumlah pasangan | Ekstrak shared render primitive dengan manifest audio/video eksplisit; pertahankan Smart Sync dan parameter per paket |
| Resep statis | `lib/scheduler-processors.js:9512`, `:9631`, `:9899` | generateImage melalui client sama, lalu grid Sharp, teks dan ekspor; jalur lama juga punya cabang campaign_type video | CF Studio resep statis tegas foto/teks; jangan menggandakan jalur recipe video legacy |
| Provider transport | `lib/webhook-client.js:291`, `:394` | Client gambar/video bersama; dapat langsung HTTP atau enqueue BullMQ; kegagalan enqueue dapat fallback HTTP | Pilih satu mode dispatch eksplisit saat pilot; antrean error tidak otomatis mem-bypass ownership dan limit |
| Queue | `lib/queue.js:33`; `scripts/glabs-worker.js` | Producer memasukkan tenantId dalam job.data, sedangkan consumer membaca tenantId dari job; consumer tidak memasang tenant context eksplisit di entrypoint yang dibaca | Kontrak job eksplisit dan tenant context wajib sebelum lookup endpoint, secret, route atau penyimpanan |
| Endpoint queue | `scripts/glabs-worker.js`; `lib/webhook-client.js:92` | Daemon memakai host global sementara direct client memiliki resolusi override brand. Paritas queue/direct tidak boleh diasumsikan | Resolve endpoint di provider gateway berdasarkan referensi konfigurasi, persist identitas endpoint; secret tidak ditaruh di job payload |
| Lease | `lib/pillar-stage-execution-service.js` | Ada claim/expiry, tetapi completion helper yang dibaca memakai ID tanpa token fencing; belum cukup untuk menyimpulkan exactly-once side effect | Tambah heartbeat dan conditional completion owner+fencing token; provider timeout tetap perlu rekonsiliasi |

Temuan queue/lease adalah gap statis pada kandidat adopsi, bukan bukti insiden di server. Audit runtime dan tes kontrak diperlukan sebelum memilih mode produksi.

## Batas kontrak baru

Storyboard naratif saja belum cukup. Paket produksi versioned memuat:

- identitas tenant, brand, item, revision, source kind dan source IDs;
- output kind video/static; daftar scene/image yang stabil, bukan mengandalkan indeks array legacy;
- prompt T2I/I2V/T2V sesuai mode, durasi, rasio, model, visual identity snapshot;
- reference asset IDs/checksum, product-critical/continuity requirement dan mode image lane;
- narasi atau voice segments, voice cast, provider/model/bahasa/speed/volume dan kebijakan fallback;
- execution flags: start frame wajib/skip, TTS on/off, native audio on/off dan persetujuan kreatif;
- mux settings: sync mode, bridge scene, scale, BGM dan SFX;
- package sosial dan resep sebagai metadata output, tidak sebagai penentu renderer;
- fingerprint dan validasi kapabilitas. Paket yang tidak lengkap ditolak, bukan dilengkapi dengan tebakan runtime.

CEP dihasilkan compiler Product Campaign melalui Content Planner. Tidak ada input CEP manual. Resep harus lolos validasi konsistensi sebelum package ready. Source kind hanya untuk lineage, UI dan compiler; service render tidak mempunyai switch berdasarkan nama campaign.

## Proses/worker yang direncanakan

1. Orchestrator durable menentukan stage yang siap dan claim/checkpoint.
2. Satu implementasi provider G-Labs worker/gateway melayani job image dan video dari semua sumber. Boleh banyak instance; bukan worker per source kind.
3. Shared TTS executor dan shared FFmpeg executor menjalankan tahap sesuai kapabilitas serta kapasitas host. Keduanya bukan tugas G-Labs worker.
4. Shared storage/artifact service menyimpan manifest dan lineage. Static finishing memakai grid/text exporter.

Dispatch/poll provider hanya dimiliki satu lapisan pada satu waktu. Start-frame coordinator mengelola asset/revision/lane, bukan menjadi submitter kedua di samping G-Labs worker. Database menyimpan state otoritatif; jika BullMQ dipakai sebagai transport, DB outbox+unique stage keys menangani enqueue ulang, dan timeout tidak menghasilkan submit baru tanpa rekonsiliasi.

## Urutan konsolidasi

A. Rekam golden fixtures dari payload/output kreatif dan konfigurasi V2 (tanpa secret), serta fake provider responses.
B. Definisikan kontrak dan empat normalizer; validasi parity scene, reference, voice dan mux.
C. Bentuk shared services di CF Studio, gunakan helper V2 yang telah diverifikasi dan lepaskan akses DB legacy dari render primitive.
D. Jalankan paket setara dari empat sumber melalui service yang sama; bandingkan konfigurasi provider dan manifest, bukan hasil AI yang nondeterministik secara byte-per-byte.
E. Uji provider nyata satu item per capability, baru batch pilot. Pengukuran kualitas visual/audio dilakukan manual.
F. Wrappers legacy hanya alat pembanding/adaptasi sementara; gate pilot melarang dua implementasi render berdasarkan source kind di CF Studio.

## Tes wajib sebelum pilot

- Empat source kind dengan package ekuivalen menghasilkan request provider dan mux equivalent, kecuali lineage.
- Hybrid/I2V dan T2V, reference produk kritis, frame replacement/revision serta visual continuity tetap didukung.
- Single/multi-voice, MiniMax→Gemini fallback, bahasa dan parameter bernilai nol tidak berubah menjadi default karena operator truthy.
- Clip ordering eksplisit; bridge memakai scene ID; audio codec/extension konsisten ketika fallback.
- Jumlah audio/video lengkap sebelum mux. Native audio/TTS disabled memiliki mode mux yang didukung; jangan memaksa helper TTS-only untuk kasus itu.
- Retry satu scene tidak mengulang scene selesai; stale worker tidak dapat menulis hasil ke revision baru.
- Timeout setelah submit, restart, double delivery dan enqueue failure tidak menghasilkan blind resubmit.
- Tenant/brand route, callback, artifact dan lane scope benar; jika endpoint G-Labs fisik dipakai bersama V2, anggaran concurrency harus berlaku pada endpoint yang sama, bukan hanya per aplikasi.
- Static recipe menggunakan image service yang sama dan tidak mengeksekusi TTS/clip/FFmpeg.

Keterbatasan: belum audit seluruh variasi menu V2, seluruh isi provider server, data hidup atau performa. Tidak mengklaim satu mesin V2 sudah sepenuhnya seragam. Audit ini memadai untuk memperbaiki arah implementasi dan menetapkan gate pembuktian paritas.
