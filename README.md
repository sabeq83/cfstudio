# CF Studio V3

Aplikasi pengembangan lokal berbasis kontrak MAKNA Flow V2: lima menu, Automation empat tab, lima sumber produksi, satu pipeline render bersama, review dan integrasi Telegram/Repliz.

Buka `http://127.0.0.1:3100`. Status jujur implementasi dan gate live ada di [delivery status](docs/delivery-status.md); panduan menjalankan, koneksi dan backup ada di [operations](docs/operations.md).

```sh
npm ci
npm run db:local -- status
npm run build
npm run start
npm test
npm run smoke:local
```

PostgreSQL development terpisah pada loopback port 55432. Akun dan credential hanya di `.env.local` atau koneksi Settings terenkripsi. Worker dijalankan terpisah dengan `npm run worker`; dispatch default OFF.

Trial migration: 309 objek, termasuk 21 preset tenant lama dan 2 sistem. 67 media pulih; 199 referensi sumber masih hilang. Import ulang memakai origin ledger dan melindungi perubahan tujuan.

Pengujian lokal mencakup SQL, tenant/capability, durabilitas, lima jalur dengan provider tiruan dan FFmpeg nyata. Integrasi provider hidup, parity kualitas V2, pilot, final cutover dan deployment belum dinyatakan lulus. Tidak ada credential V2 yang digunakan oleh adapter CF Studio secara otomatis.
