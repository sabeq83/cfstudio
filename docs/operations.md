# Operasi CF Studio V3

Sumber yang dikonfirmasi: staging MAKNA Flow, default tenant. Database tujuan terpisah. Source access harus READ ONLY pada session dan akun.

## Kesiapan database

Admin menyiapkan database khusus dan user CF Studio lalu menaruh DATABASE_URL di .env.local (tidak di Git). SOURCE_DATABASE_URL terpisah hanya untuk inventory/migration. Jangan menyalin seluruh .env MAKNA Flow. Skrip dijalankan dengan `node --env-file=.env.local scripts/<nama>.mjs`.

1. verify-environment.mjs memeriksa konfigurasi dan isolasi.
2. migrate.mjs dry-run lalu `--apply` setelah source/target diverifikasi.
3. provision-admin.mjs memakai CF_ADMIN_USERNAME, CF_ADMIN_PASSWORD dan TARGET_TENANT_ID dari environment; tidak mencetak password.
4. inventory-source.mjs hanya membaca schema staging.
5. import-default-tenant.mjs masih dry-run; apply sengaja belum tersedia sampai relink dan media verifier selesai.

## Batas versi fondasi

UI dapat berjalan tanpa DB, tetapi API privat mengembalikan DATABASE_NOT_CONFIGURED. Tidak tersedia akun bawaan. Penyimpanan server memerlukan login. Provider dispatch OFF dan worker menolak aktif sebelum gate integrasi. Daily Review/Schedule/History belum terhubung ke hasil provider. Remote Git belum ditentukan.

## Isolasi

Jangan menjalankan worker V2 di root baru; namespace queue, callback, asset dan database CF Studio harus terpisah. Database rollback dan filesystem rollback adalah operasi berbeda.
