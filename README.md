# CF Studio V3

Fondasi aplikasi baru berbasis mesin MAKNA Flow V2 (belum seluruh PRD selesai). Status implementasi aktual terdapat di docs/implementation_plan.md.

## Lokal

`npm ci`, `npm test`, `npm run dev` (port 3100). Preview HTML: `/mockup_automation.html`.

Database khusus PostgreSQL wajib dikonfigurasi dengan DATABASE_URL. Sumber import hanya schema staging melalui SOURCE_DATABASE_URL dan SOURCE_TENANT_ID eksplisit. Tidak menyalin env V2 ke repo ini. Worker/dispatch provider default OFF. UI development tidak menjadi bukti integrasi provider atau migrasi selesai.

`npm run db:migrate` hanya menulis ke database tujuan terkonfigurasi setelah verifikasi isolasi. `npm run inventory:source` hanya membaca sumber. Jangan commit laporan berisi data katalog privat.

Verifikasi awal: 20 tes kontrak lulus, build lulus, npm audit bersih. Database tujuan/provider belum terhubung. Daftar fitur belum selesai tercatat eksplisit di dokumen rencana.
