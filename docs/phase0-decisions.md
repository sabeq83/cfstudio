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
| Source kode lokal vs release staging | Menunggu jawaban | SHA berbeda; pertanyaan sudah diajukan |
| Arsip untuk 199 missing file references | Menunggu informasi | Pemeriksaan path/temp staging; pertanyaan sudah diajukan |
| Import credentials/sessions/active queues | Dikecualikan | PRD; tidak diperlukan membuat ulang preset |
| Brand assignment preset dari nama | Dilarang diinferensikan | Tidak ada field assignment eksplisit pada preset diaudit |

Tidak ada izin deployment production atau mutasi sumber yang disimpulkan dari keputusan ini.
