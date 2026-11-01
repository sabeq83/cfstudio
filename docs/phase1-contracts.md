# Fase 1 — Kontrak Data, API dan State CF Studio V3

Versi kontrak: 0.1, 1 November 2026. Status: rancangan untuk review; endpoint/semantik yang belum ada pada fondasi API bukan dianggap sudah diimplementasikan.

## 1. Invariant lintas domain

- Tenant berasal dari sesi/konteks worker yang terverifikasi, bukan tenantId bebas pada body. Superadmin memilih konteks tenant eksplisit dan diaudit.
- Semua object lookup/mutasi menerapkan tenant + assignment brand + capability; object asing mengembalikan 404 tanpa membocorkan keberadaannya.
- Revision integer monoton; mutation objek existing wajib expected revision. Stale state menghasilkan 409, bukan menimpa data terbaru.
- Timestamp disimpan UTC; timezone IANA dan local schedule disimpan terpisah. UI selalu menampilkan timezone. Snapshot Asia/Jakarta pada mockup adalah batas simulasi, bukan pembatas kontrak timezone aplikasi.
- Satu source kind memilih compiler materi; service render tidak bercabang berdasarkan nama campaign. Reference kritis dan mode audio/visual adalah capability paket.
- Provider dispatch OFF selama gate belum selesai; preview tidak mengirim Telegram/Repliz/G-Labs/AI.
- Tidak ada default tenant fallback, secret pada respons/job payload, atau instruksi otomatis menjalankan ulang antrean sumber saat import.

## 2. Bentuk data inti

### RoutineDraft dan ActiveRevision

```json
{
  "id": "routine-id",
  "revision": 3,
  "name": "Nutribake Harian",
  "brandId": "brand-id",
  "timezone": "Asia/Jakarta",
  "schedule": {"frequency": "daily", "localTime": "05:00", "weekdays": []},
  "creativeApproval": {"mode": "manual", "policyPresetRevision": null},
  "publishingSuggestions": {"dayOffset": 1, "localSlots": ["08:00", "12:00"]},
  "targets": [{"id": "target-id", "kind": "product_campaign", "name": "Video produk", "count": 2, "selected": true, "productId": "product-id", "presetRef": {"id": "preset-id", "revision": 1}}]
}
```

- Jenis: multiplier, recipe_video, recipe_static, brand_editorial, product_campaign.
- Multiplier: deconstructAssetId dengan hasil analisis valid; status media sumber ditampilkan terpisah. Paket yang hanya memerlukan storyboard tidak dianggap memerlukan download video ulang.
- Product Campaign: produk/binding brand valid wajib; `cep` dalam input ditolak. CEP adalah hasil planner pada item.
- Recipe organik tidak memerlukan produk. Recipe statis tidak memerlukan seluruh tahap video.
- `activeRevision` dan snapshot activeConfig terpisah dari draft. Save draft saat aktif tidak mengubah jadwal/konfigurasi aktif; activate revision adalah tindakan terpisah.
- Archive target tidak menghapus run/item/publishing sebelumnya. Routine archive menonaktifkan dispatch berikutnya tanpa menganggap semua pekerjaan provider dibatalkan.

### Run dan ContentRevision

Run menyimpan id, executionMode, routineId, routineRevision, scheduledSlot jika otomatis, snapshot semua target/brand/product/preset/source yang dipakai, status, lease/fencing token dan correlationId. Satu run manual tidak memakan slot terjadwal.

ContentRevision membawa itemId/revision, sourceKind/sourceIds, plannerOutput (termasuk CEP untuk Product Campaign), ProductionPackage v1/fingerprint, caption/media/social package, creative decision, final approval dan artifact manifest. Stable sceneId dipakai lintas tahap; jangan menjadikan indeks array legacy sebagai satu-satunya identitas.

ProductionPackage memuat mode I2V/T2V, prompt, reference ID/checksum, durasi, rasio/model, narasi/voice segments, language/model/volume/speed, fallback, audioMode, Smart Sync/bridge/BGM/SFX dan output kind video/static. Metadata lineage tidak menentukan algoritma render.

### BrandPresetAssignment dan BrandIdentityAssignment

Assignment memuat tenantId, brandId, preset/identity ID, versi pilihan, status aktif dan revision assignment. Impor preset mempertahankan origin/key/config/versi yang tersedia; brand association dibuat eksplisit jika sumber tidak menyimpannya.

Pemilihan existing preset membuat assignment; tidak membuat preset baru. Preset sistem read-only. Edit preset menghasilkan revisi baru tanpa mengganti snapshot batch berjalan. Brand detail hanya memiliki tab Preset dan Visual Identity; profil dasar/produk melalui Edit Brand/area informasi.

### PublishingIntent

Intent menyimpan itemId, contentRevision/fingerprint, accountId yang terotorisasi untuk brand, scheduledAt UTC + display timezone, payload snapshot, local status, provider status/ID dan attempts. Unique identity mencakup tenant+revision+account+schedule intent; duplicate request dengan idempotency key yang sama tidak membuat post kedua.

Perubahan konten setelah provider menerima jadwal tidak mengubah payload lama secara otomatis. Perlu cancel/update provider terkonfirmasi sebelum replacement; race cancel-vs-publish direkonsiliasi.

## 3. Kontrak API usulan

Prefix `/api/v3`. Auth memakai sesi aman; CSRF/origin diperiksa pada mutasi. Jangan memakai mockup role selector sebagai otorisasi.

| Endpoint | Request utama | Hasil dan capability |
|---|---|---|
| GET /brands | filter/pagination | Daftar brand sesuai assignment, `catalog.read` |
| GET /brands/:id | ID | Detail scoped, termasuk informasi profil |
| GET /brands/:id/presets | pagination | Assignment preset brand, bukan semua preset tenant |
| GET /brands/:id/visual-identities | pagination | Assignment identity brand |
| GET /preset-library | kind, pagination | Katalog existing/import/system yang boleh dipilih |
| POST /brands/:id/preset-assignments | presetId, presetRevision | Pengaitan tanpa clone; `catalog.manage`, idempotent |
| POST /brands/:id/identity-assignments | identityId, identityRevision | Pengaitan identity scoped |
| PATCH /brands/:id/assignments/:assignmentId | expectedRevision, active | Perubahan assignment; tidak mengubah run berjalan |
| GET /routines | brand/status/pagination | `automation.read` |
| POST /routines | routine draft | Create draf; `automation.manage`; Idempotency-Key |
| PATCH /routines/:id/draft | expectedRevision, config | Save revisi draf; active tidak berubah |
| POST /routines/:id/activate | expectedRevision, draftRevision | Validasi target/dependency/tenant; commit active snapshot dan next slot atomik |
| POST /routines/:id/pause | expectedRevision | Pause dispatch berikutnya |
| POST /routines/:id/resume | expectedRevision | Resume revisi aktif; hitung next slot |
| POST /routines/:id/archive | expectedRevision | Soft archive, preserve riwayat |
| POST /routines/:id/run-once | sourceRevision, source=draft/active | `production.run`; Idempotency-Key; tidak menggeser recurring slot |
| GET /runs, /runs/:id | brand/date/status | Snapshot, stage, partial results, error dan lineage scoped |
| POST /items/:id/creative-approval | expectedRevision, packageFingerprint | `content.approve`; saat creative manual siap |
| POST /items/:id/final-approval | expectedRevision, contentFingerprint | `content.approve`; hasil final siap saja |
| PATCH /items/:id/content | expectedRevision, allowed edits | `content.edit`; revisi baru dan invalidasi approval final |
| POST /items/:id/regenerate | expectedRevision, stage, sceneIds | `content.edit` + `production.run` bila memanggil provider; checkpoint terpilih |
| POST /items/:id/retry | expectedRevision, failedStage | `production.run`; reconcile provider job dahulu |
| POST /publishing/preflight | itemRevision/account/time | `publishing.schedule`; periksa approval/media/platform/akun/brand |
| POST /publishing/intents | itemRevision/account/scheduledAt | `publishing.schedule`; create snapshot/outbox atomik; Idempotency-Key |
| POST /publishing/intents/:id/reconcile | expectedRevision | Tidak membuat job provider kedua saat outcome belum diketahui |
| POST /publishing/intents/:id/reschedule | expectedRevision, newTime | Validasi dukungan provider dan waktu; status pending sampai konfirmasi |
| POST /publishing/intents/:id/cancel | expectedRevision | `publishing.cancel`; bukan langsung canceled tanpa bukti provider |
| GET /history | brand/run/type/cursor | Timeline event redacted, pagination stabil |
| GET/PATCH /notification-preferences | categories, quietHours | Pengguna sendiri; tujuan terverifikasi; scope brand dipertahankan |
| POST /telegram/connection/start, /verify | one-time proof | Verifikasi kepemilikan; tidak menerima raw chat tujuan tanpa verifikasi |

Fondasi API sebelumnya memakai catch-all catalog/routines dan endpoint activate minimal. Ini harus diselaraskan ke kontrak final setelah review; kompatibilitas/migrasi klien ditentukan pada implementasi, bukan diam-diam menganggap keduanya identik.

## 4. Idempotensi, transaksi dan concurrency

- `Idempotency-Key` wajib untuk create run/publishing/provider operation; scope actor/tenant+operation. Key sama dan payload hash sama mengembalikan hasil yang sama; payload berbeda 409 IDEMPOTENCY_CONFLICT.
- Scheduled run unique tenant+routine+scheduledSlot; perubahan revision tidak menciptakan slot kedua.
- Stage key tenant+item+revision+stage+scene, claim lease dengan heartbeat/fencing. Completion mensyaratkan owner/token/revision masih valid; stale worker tidak dapat mengubah hasil revisi baru.
- Perubahan state penting dan outbox/audit ditulis satu transaksi. DB state authoritative; queue sebagai transport dapat menerima pesan ulang.
- Simpan provider job ID dan endpoint connection reference sebelum polling. Outcome submission ambigu masuk reconciliation_required; jangan langsung resubmit.
- Bulk action memberi hasil per item. Sebagian berhasil tidak disajikan sebagai seluruhnya gagal atau berhasil. Cross-brand bulk diperiksa per objek; UI scheduling awal membatasi satu brand agar pemilihan akun jelas.

## 5. State transition

| Domain | Transition utama | Larangan |
|---|---|---|
| Rutinitas | draft saved → activate revision → active → paused/resumed → archived | Edit draft tidak menonaktifkan active revision secara diam-diam |
| Produksi | queued → planning → creative → awaiting_creative_approval (manual) → rendering → ready | Final approval sebelum artifact siap |
| Stage | queued → leased → submitted/provider_processing → completed; retry_wait/failed/unknown | Lease lama menulis hasil revision baru; resubmit tanpa reconcile |
| Final review | pending → approved / changes_requested; edit → pending versi baru | Approval lama berlaku untuk konten baru |
| Publishing lokal | draft → preflight → queued → submitting → accepted/scheduled → published | Request diterima dianggap terbit |
| Outcome ambigu | submitting → reconciliation_required → known provider state | Membuat intent/post baru sebelum rekonsiliasi |
| Cancel/reschedule | requested → awaiting_provider → confirmed/rejected/unknown | Mengklaim canceled hanya karena state lokal berubah |
| Insiden | detected → retrying → escalated/failed → recovered/resolved | Pesan retry yang sama setiap polling |

Video dan recipe statis memakai capability tahap; stage skip dicatat eksplisit. Creative auto mencatat policy+versi preset dan aktor sistem; bukan approval manusia palsu. Manual/auto hanya untuk creative; final approval selalu manusia berizin.

## 6. Error taxonomy dan pelaporan

| Kode | Kelas | Tindakan |
|---|---|---|
| VALIDATION_FAILED / PRODUCT_REQUIRED / SOURCE_NOT_READY / CEP_IS_PLANNER_OUTPUT | Validasi | Perbaiki input/dependency; tidak retry buta |
| MEDIA_UNAVAILABLE / PRODUCT_REFERENCE_MISSING | Dependency | Tandai operasi yang terhalang, jangan menganggap seluruh metadata hilang |
| AUTH_REQUIRED / CAPABILITY_REQUIRED / OBJECT_NOT_FOUND | Akses | Login atau izin; tidak bocorkan tenant/brand lain |
| STALE_REVISION / IDEMPOTENCY_CONFLICT | Konflik 409 | Muat ulang/periksa permintaan, jangan override otomatis |
| TENANT_SUSPENDED / QUOTA_EXCEEDED | Policy | Hentikan side effect baru sesuai policy dan beri tindakan |
| PROVIDER_AUTH_FAILED | Integrasi permanen sampai diperbaiki | Perbaiki koneksi, eskalasi satu insiden |
| PROVIDER_RATE_LIMIT / PROVIDER_UNAVAILABLE | Transien | Backoff terbatas + provider reconciliation bila relevan |
| PROVIDER_OUTCOME_UNKNOWN | Ambigu | Rekonsiliasi; tidak blind resubmit |
| STAGE_TIMEOUT / HEARTBEAT_LOST | Operasional | Monitor terpisah, recover lease terfencing, reconcile |
| MUX_INPUT_INCOMPLETE / RECIPE_CONSISTENCY_FAILED | Produksi | Tahan tahap berikutnya; validasi manifest/resep |
| TELEGRAM_DELIVERY_FAILED | Notifikasi | Retry/dead-letter; produksi lain tidak gagal dan tidak ada loop Telegram |

Envelope error: code, userMessage, correlationId, retryable, nextAction, currentRevision bila relevan. Detail provider mentah/secret/stack trace tidak dikirim ke UI/Telegram.

Telegram event: error pertama segera masuk durable outbox (target ≤1 menit setelah terdeteksi), eskalasi retry habis/perlu tindakan, pemulihan dan ringkasan batch. Incident key tenant+run/item+revision+stage+causeGroup; agregasi sesuai scope penerima. Cooldown usulan 15 menit untuk error identik; eskalasi/perubahan dampak/pemulihan tidak ditahan. Quiet hours dihormati kecuali opt-in override pengguna. Delivery eksternal ambigu tidak dijanjikan exactly-once.

## 7. Capability matrix

| Tindakan | Admin | Operator | Reviewer | Publisher | Viewer |
|---|---|---|---|---|---|
| Read scoped catalogs/runs/history | Ya | Ya | Ya | Ya | Ya |
| Manage routine/catalog assignment | Ya | Ya | Tidak | Tidak | Tidak |
| Run/retry production | Ya | Ya | Tidak | Tidak | Tidak |
| Edit content | Ya | Ya | Tidak | Tidak | Tidak |
| Approve creative/final | Ya | Tidak | Ya | Tidak | Tidak |
| Schedule/cancel/reconcile publishing | Ya | Tidak | Tidak | Ya | Tidak |
| Manage tenant members/integrations | Ya | Tidak | Tidak | Tidak | Tidak |

Ini preset role usulan; seorang user dapat menerima capability gabungan. Self-approval dan default creative mode masih perlu keputusan produk. Role simulasi mockup hanya menunjukkan batas aksi, tidak membuktikan RBAC server.

## 8. Kriteria review Fase 1

- Simpan/aktifkan r1, ubah/simpan r2 tanpa aktivasi: run aktif tetap r1; aktivasi r2 baru mengubah run berikutnya.
- Kelima target dapat ditambah/edit/hapus/dipilih; produk wajib hanya pada Product Campaign; tidak ada input CEP.
- Creative manual menahan render; approve creative menghasilkan hasil demo ready, bukan final approved.
- Edit caption/regenerate menginvalidasi approval; Publisher tidak dapat menjadwalkan versi yang belum disetujui.
- Scheduling lintas brand meminta pemisahan; respons ambigu menunjukkan rekonsiliasi dan tidak membuat provider ID baru.
- Error klip menunjukkan jalur/stage/dampak/retry; recovery dicatat tanpa mengulang seluruh batch.
- Klik nama brand membuka Preset default dan Visual Identity; existing preset dipilih sebagai assignment tanpa duplikasi.
- History memuat revision/run/action/actor dan event provider demo; data contoh tidak diberi label migrasi selesai.
- Light/dark, mobile, label, keyboard dan disabled capability dapat diperiksa manual.
