# Decision Log — Fase 0

| Keputusan | Status | Dasar |
|---|---|---|
| Root /Users/sabeqmmursyid/_cfstudio | Dikonfirmasi | Jawaban pengguna |
| Data staging default tenant | Dikonfirmasi dan terverifikasi read-only | Pengguna + query sumber |
| PostgreSQL khusus CF Studio | Dikonfirmasi; belum tersedia pada environment lokal | Pengguna |
| Lokal port 3100 dahulu | Dikonfirmasi | Jawaban pengguna pada Fase 0 |
| Storage media terpisah V2 | Dikonfirmasi | Jawaban pengguna pada Fase 0 |
| Akun CF Studio baru dan mapping role V2 | Dikonfirmasi | Jawaban pengguna pada Fase 0 |
| Remote dan deployment host | Ditunda sebelum rilis | Jawaban pengguna pada Fase 0 |
| Source kode lokal vs release staging | Dikonfirmasi: kode lokal terbaru | Baseline audit `6c645e5cdf84d47d86a7e142c6e5679ba7bd25f2`; data tetap staging. Perubahan source sesudah SHA ini perlu delta audit sebelum adopsi |
| Arsip untuk 199 missing file references | Dicatat sebagai gap migrasi, lokasi arsip belum diketahui | Pengguna meminta gap dicatat dahulu; tidak menandai media tersedia dan tidak menganggap file hilang dari seluruh storage |
| Import credentials/sessions/active queues | Dikecualikan | PRD; tidak diperlukan membuat ulang preset |
| Brand assignment preset dari nama | Dilarang diinferensikan | Tidak ada field assignment eksplisit pada preset diaudit |

Tidak ada izin deployment production atau mutasi sumber yang disimpulkan dari keputusan ini.
