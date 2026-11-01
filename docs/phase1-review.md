# Fase 1 — Paket Review UI dan Kontrak

Tanggal: 1 November 2026. Status: artefak siap direview; dua kebijakan approval telah dikonfirmasi; review keseluruhan mockup belum diasumsikan.

## Artefak

- Mockup standalone: `public/mockup_cfstudio_phase1.html`.
- Preview lokal: http://127.0.0.1:3101/mockup_cfstudio_phase1.html
- Kontrak: `docs/phase1-contracts.md`.
- React aplikasi, database, worker/provider dan sumber V2 tidak diubah pada fase ini.

Semua state mockup berada di memori browser, hilang saat reload. Contoh preset/brand adalah materi demonstrasi interaksi, bukan hasil import selesai. Tidak ada video/foto generatif nyata, pesan Telegram, atau jadwal Repliz dibuat.

## Cakupan mockup

1. Lima menu; Automation mempunyai tepat Setting Automation, Daily Review, Schedule, History.
2. Target dinamis lima jalur; Product Campaign memerlukan produk dan menampilkan CEP sebagai output otomatis.
3. Draf tersimpan, revisi aktif, perubahan belum diterapkan, pause/resume dan run once dari snapshot revisi terpilih.
4. Creative manual/auto dan review final manual terpisah. Edit caption/regenerate membatalkan approval versi sebelumnya.
5. Role demo Admin/Operator/Reviewer/Publisher/Viewer; tindakan dibatasi sesuai capability. Ini tidak menggantikan validasi server.
6. Error klip, preview Telegram, retry satu item, pemulihan dan timeline History.
7. Schedule dengan kalender tujuh hari/filter tanggal, konfirmasi tanggal/jam/akun, outcome ambigu/reconcile, simulasi terbit dan cancel terkonfirmasi demo.
8. Daftar brand → klik nama → Preset (default) / Visual Identity; pilih preset impor menjadi assignment tanpa membuat preset duplikat.
9. Empty states, gap media dan konflik import yang tidak menimpa edit tujuan.
10. Theme tokens light/dark dan layout responsif. Uji mobile/estetika final dilakukan manual pengguna.

## Pemeriksaan singkat yang sudah dilakukan

- Syntax JavaScript final valid.
- Save+activate r1, edit+save r2: UI menunjukkan draf r2 dan active r1; batch berikutnya memakai r1.
- Manual creative: empat video menunggu creative review dan dua resep statis siap final. Approve creative kemudian final membuka konfirmasi enam slot jadwal.
- Schedule ambiguous → reconcile: provider ID lama tetap sama dan tidak ada intent kedua dari tindakan reconcile.
- Daftar brand Dapur Botani → default Preset → pilih preset existing: assignment muncul tanpa membuat entri library baru.
- Viewer tidak dapat memilih assignment preset; tombol dinonaktifkan.
- Creative auto: batch langsung masuk review final demo; final tidak otomatis disetujui.
- Simulasi error video menampilkan brand, run, jalur, tahap, status retry dan item pada preview Telegram.
- Retry item menghasilkan event pipeline.recovered dan tidak mengulang batch.
- Kalender tujuh hari dan konflik import ditambahkan setelah smoke utama, diverifikasi syntax; interaksi dan tampilan lanjut tersedia untuk review manual pengguna.

Ini smoke interaksi prototype, bukan tes backend, transaksi DB, provider, atau bukti seluruh skenario keamanan lulus. Tidak menjalankan browser automation berulang berlebihan untuk perubahan visual.

## Kebutuhan yang sudah dikonfirmasi sebelumnya

- Lima menu utama, empat tab Automation, lima jalur produksi, produk wajib dan CEP otomatis.
- Shared render pipeline, final approval manusia, tenant/brand isolation.
- Impor preset default tenant; tidak membuat ulang. Brand detail Preset dan Visual Identity.
- Error Telegram, eskalasi dan pemulihan, gap media terdokumentasi.
- Baseline kode lokal/data staging; akun baru, storage terpisah dan pengembangan port 3100 dahulu.

## Keputusan approval sudah dikonfirmasi

1. Creative approval default otomatis berdasarkan preset, dapat diubah menjadi manual per rutinitas. Mockup kini membuka mode otomatis secara default.
2. Pengguna dengan izin produksi dan approval sekaligus boleh menyetujui hasilnya sendiri. Final approval tetap manual, exact revision dan tercatat audit; scope tenant/brand tetap berlaku.

## Review yang masih terbuka

Review keseluruhan mockup: persetujuan atau koreksi terhadap navigasi, revision, review, schedule dan brand detail sebelum kode UI utama mengikuti rancangan baru. Jawaban kebijakan tidak dianggap persetujuan semua detail UI.

## Gate menuju Fase 2

Artefak dan kontrak tersedia. Checklist induk Fase 1 belum ditutup sampai review keseluruhan pengguna dicatat; kedua keputusan kebijakan sudah ditutup. Tidak mengaktifkan provider, migrasi apply atau perubahan UI utama sambil menunggu. Fondasi aplikasi yang sudah ada tetap alpha dan status belum selesai pada rencana tetap berlaku.
