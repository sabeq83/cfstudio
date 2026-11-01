"use client";
import { useState } from "react";
import {
  MODEL_CATALOG,
  MODULE_MODELS,
  modelChain,
  modelConfig,
} from "../lib/gemini-models.js";
const labels = {
  active: ["Aktif", "success"],
  paused: ["Dijeda", ""],
  cooldown: ["Cooldown", "warning"],
  invalid: ["Invalid", "danger"],
  temporary: ["Gangguan sementara", "info"],
  limit: ["Batas tercapai", "warning"],
};
export default function GeminiSettings({
  pool,
  config,
  setConfig,
  api,
  perform,
  busy,
}) {
  const [mode, setMode] = useState("bulk"),
    [filter, setFilter] = useState("all"),
    [prefix, setPrefix] = useState("CFKey"),
    [cap, setCap] = useState(20),
    [text, setText] = useState(""),
    [alias, setAlias] = useState(""),
    [single, setSingle] = useState(""),
    [validate, setValidate] = useState(true),
    [result, setResult] = useState(null),
    [confirm, setConfirm] = useState(null),
    [custom, setCustom] = useState(
      !MODEL_CATALOG[config.tier || "free"].includes(config.model),
    );
  const c = modelConfig(config),
    summary = pool.summary || {},
    archived = pool.archived || [],
    all = pool.keys || [],
    shown = all.filter(
      (k) =>
        filter === "all" ||
        (filter === "attention" &&
          ["invalid", "temporary", "cooldown", "limit"].includes(
            k.display_status,
          )) ||
        filter === k.display_status,
    ),
    lines = text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
    used = summary.used || 0,
    capacity = summary.capacity || 0;
  const change = (patch) => setConfig({ ...config, ...patch });
  async function importKeys(e) {
    e.preventDefault();
    const keys =
      mode === "single"
        ? [{ name: alias, apiKey: single, dailyLimit: Number(cap) }]
        : lines.map((line, i) => {
            const at = line.search(/[:,]/);
            return {
              name:
                at < 0
                  ? (prefix || "Key") + "_" + String(i + 1).padStart(2, "0")
                  : line.slice(0, at).trim(),
              apiKey: at < 0 ? line : line.slice(at + 1).trim(),
              dailyLimit: Number(cap),
            };
          });
    const r = await perform(
      () => api("settings/pool", { keys, validateLive: validate }),
      "Impor key selesai.",
    );
    if (r) {
      setResult(r);
      setText("");
      setSingle("");
    }
  }
  async function state(id, status) {
    await perform(
      () => api("settings/pool-state", { id, status }),
      status === "archived"
        ? "Key diarsipkan; riwayat dipertahankan."
        : "Status key diperbarui.",
    );
  }
  function keyRow(k, isArchive = false) {
    const [label, css] = labels[k.display_status] || labels.paused;
    return (
      <div className="gp-key" key={k.id}>
        <div>
          <b>{k.name}</b>{" "}
          <span className={"badge " + css}>
            {isArchive ? "Diarsipkan" : label}
          </span>
          <small>
            {k.masked}
            {k.last_tested_at
              ? " · Diperiksa " +
                new Date(k.last_tested_at).toLocaleString("id-ID")
              : ""}
            {k.last_error_code ? " · " + k.last_error_code : ""}
          </small>
        </div>
        <div className="gp-usage">
          {k.used_today} / {k.daily_limit}
          <div className="gp-bar">
            <i
              style={{
                width:
                  Math.min(100, (k.used_today / k.daily_limit) * 100) + "%",
              }}
            />
          </div>
          <small>request lokal</small>
        </div>
        <div className="actions">
          {isArchive ? (
            <button disabled={busy} onClick={() => state(k.id, "disabled")}>
              Pulihkan
            </button>
          ) : (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  perform(
                    () => api("settings/pool-test", { id: k.id }),
                    "Status key diperiksa.",
                  )
                }
              >
                Tes
              </button>
              <button
                disabled={busy || k.status === "invalid"}
                onClick={() =>
                  state(k.id, k.status === "disabled" ? "active" : "disabled")
                }
              >
                {k.status === "disabled" ? "Enable" : "Pause"}
              </button>
              <button
                disabled={busy}
                className="gp-danger"
                onClick={() => setConfirm({ id: k.id, name: k.name })}
              >
                Hapus
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="row">
        <div>
          <h3>Gemini API Pool Manager</h3>
          <small>
            Pool bersama untuk planner, creative, analisis, dan Gemini TTS.
          </small>
        </div>
        <div className="actions">
          <button
            disabled={busy || !all.length}
            onClick={() =>
              perform(
                () => api("settings/pool-test", {}),
                "Audit key selesai. Gangguan sementara tidak dihapus.",
              )
            }
          >
            Audit & Test All Keys
          </button>
          <button
            className="gp-danger"
            disabled={busy || !all.some((k) => k.status === "invalid")}
            onClick={() => setConfirm({ clean: true })}
          >
            Bersihkan key invalid
          </button>
        </div>
      </div>
      <div className="gp-metrics">
        {[
          [
            "KEY SIAP DIGUNAKAN",
            summary.activeKeys || 0,
            `dari ${all.length} key dalam pool`,
          ],
          ["PEMAKAIAN HARI INI", used, "Request lokal CF Studio"],
          [
            "SISA BATAS LOKAL",
            summary.remaining || 0,
            "Berdasarkan batas per key",
          ],
        ].map(([label, value, note]) => (
          <div className="gp-metric" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="gp-box">
        <div className="row">
          <b>Pemakaian batas harian lokal</b>
          <small>
            {used} / {capacity} request ·{" "}
            {capacity ? Math.round((used / capacity) * 100) : 0}%
          </small>
        </div>
        <div className="gp-bar">
          <i
            style={{
              width:
                (capacity ? Math.min(100, (used / capacity) * 100) : 0) + "%",
            }}
          />
        </div>
        <small>
          Bukan pembacaan sisa kuota langsung dari Google. Reset harian:{" "}
          {pool.budgetDay}.
        </small>
      </div>
      <div className="row gp-space">
        <h3>API keys dalam pool</h3>
        <label>
          Tampilkan{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Semua status</option>
            <option value="active">Aktif</option>
            <option value="attention">Perlu perhatian</option>
            <option value="paused">Dijeda</option>
          </select>
        </label>
      </div>
      <div className="gp-key-list">
        {shown.length ? (
          shown.map((k) => keyRow(k))
        ) : (
          <p className="muted">Tidak ada key untuk status ini.</p>
        )}
      </div>
      <details>
        <summary>Arsip key ({archived.length})</summary>
        <div className="gp-key-list">
          {archived.map((k) => keyRow(k, true))}
          {!archived.length && <small>Belum ada key diarsipkan.</small>}
        </div>
      </details>
      <div className="gp-box gp-space">
        <div className="row">
          <div>
            <h3>＋ Tambah Gemini API key ke pool</h3>
            <small>Gunakan Single Input atau paste banyak key sekaligus.</small>
          </div>
          <div className="gp-segment">
            <button
              className={mode === "bulk" ? "active" : ""}
              onClick={() => {
                setMode("bulk");
                setResult(null);
              }}
            >
              Bulk Add
            </button>
            <button
              className={mode === "single" ? "active" : ""}
              onClick={() => {
                setMode("single");
                setResult(null);
              }}
            >
              Single Input
            </button>
          </div>
        </div>
        <form onSubmit={importKeys}>
          <div className="grid gp-space">
            {mode === "bulk" ? (
              <label>
                Prefix alias
                <input
                  value={prefix}
                  maxLength={80}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </label>
            ) : (
              <label>
                Alias key
                <input
                  required
                  value={alias}
                  maxLength={120}
                  onChange={(e) => setAlias(e.target.value)}
                />
              </label>
            )}
            <label>
              Batas harian per key
              <input
                required
                type="number"
                min="1"
                max="100000"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </label>
          </div>
          <label className="gp-check">
            <input
              type="checkbox"
              checked={validate}
              onChange={(e) => setValidate(e.target.checked)}
            />{" "}
            Tes sebelum simpan • filter key mati/invalid
          </label>
          {mode === "bulk" ? (
            <>
              <label className="gp-space">
                API keys • satu baris per key
                <textarea
                  rows={5}
                  required
                  spellCheck={false}
                  autoComplete="off"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    "YOUR_API_KEY_HERE\nAtau: Nama key : YOUR_API_KEY_HERE"
                  }
                />
              </label>
              <small>
                {lines.length} key terdeteksi
                {lines.length
                  ? ` · ${prefix || "Key"}_01 s/d ${prefix || "Key"}_${String(lines.length).padStart(2, "0")}`
                  : ""}
              </small>
            </>
          ) : (
            <label className="gp-space">
              Gemini API key
              <input
                type="password"
                required
                autoComplete="new-password"
                value={single}
                onChange={(e) => setSingle(e.target.value)}
                placeholder="YOUR_API_KEY_HERE"
              />
            </label>
          )}
          <div className="row gp-space">
            <small>
              Duplikat dilewati. Tanpa tes, key baru disimpan dalam keadaan
              dijeda.
            </small>
            <button className="primary" disabled={busy}>
              {busy
                ? "Memproses…"
                : mode === "bulk"
                  ? "Bulk Import API Keys"
                  : "Add Key"}
            </button>
          </div>
        </form>
        {result && (
          <div className="banner gp-space" role="status">
            {result.added} ditambahkan · {result.duplicates} duplikat ·{" "}
            {result.rejected} ditolak/invalid · {result.failed} gagal diperiksa
            {result.results
              ?.filter((r) => r.errorCode)
              .map((r, i) => (
                <small key={i}>
                  {r.name}: {r.errorCode} — tidak disimpan
                </small>
              ))}
          </div>
        )}
      </div>
      <div className="gp-model gp-space">
        <h2>Konfigurasi model Gemini</h2>
        <small>Konfigurasi Model AI & Mode Operasional (Dual-Tier)</small>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            perform(
              () => api("settings/pool-config", c),
              "Konfigurasi Gemini AI tersimpan. Aktifkan ulang rutinitas untuk menerapkan default baru.",
            );
          }}
        >
          <label className="gp-space">Mode operasional API</label>
          <div className="gp-tiers">
            {[
              [
                "paid",
                "Paid Tier (Dedicated)",
                "Model utama, routing per modul, dan pilihan Context Caching.",
              ],
              [
                "free",
                "Free Tier (Rotasi Pool)",
                "Rotasi key dan rantai fallback. Context Caching nonaktif.",
              ],
            ].map(([tier, title, help]) => (
              <label
                key={tier}
                className={"gp-tier " + (c.tier === tier ? "chosen" : "")}
              >
                <span>
                  <input
                    type="radio"
                    name="gemini-tier"
                    checked={c.tier === tier}
                    onChange={() => {
                      change({
                        tier,
                        contextCaching: tier === "paid",
                        ...(!custom && !MODEL_CATALOG[tier].includes(c.model)
                          ? { model: MODEL_CATALOG[tier][0] }
                          : {}),
                      });
                    }}
                  />{" "}
                  {title}
                </span>
                <small>{help}</small>
              </label>
            ))}
          </div>
          <label className="gp-space">
            Pilihan model AI utama (Starting Primary)
            <select
              value={
                custom || !MODEL_CATALOG[c.tier].includes(c.model)
                  ? "custom"
                  : c.model
              }
              onChange={(e) => {
                setCustom(e.target.value === "custom");
                if (e.target.value !== "custom")
                  change({ model: e.target.value });
              }}
            >
              {MODEL_CATALOG[c.tier].map((m) => (
                <option key={m}>{m}</option>
              ))}
              <option value="custom">Custom Model ID…</option>
            </select>
          </label>
          <small>
            Daftar mengikuti V2. Ketersediaan dan izin model bergantung pada
            akun Google.
          </small>
          {(custom || !MODEL_CATALOG[c.tier].includes(c.model)) && (
            <label className="gp-space">
              Custom Gemini Model ID
              <input
                required
                value={config.model ?? ""}
                maxLength={160}
                onChange={(e) => change({ model: e.target.value })}
              />
            </label>
          )}
          <label className="gp-space">
            Model fallback pilihan • opsional
            <input
              value={c.fallbackModel}
              maxLength={160}
              placeholder="Kosongkan untuk memakai urutan bawaan V2"
              onChange={(e) => change({ fallbackModel: e.target.value })}
            />
          </label>
          {c.tier === "paid" && (
            <div className="gp-box gp-space">
              <div className="row">
                <h3>Matriks alokasi model per modul</h3>
                <label className="gp-check">
                  <input
                    type="checkbox"
                    checked={c.smartRouting}
                    onChange={(e) => change({ smartRouting: e.target.checked })}
                  />{" "}
                  Aktifkan Routing Cerdas
                </label>
              </div>
              {[
                ["extraction", "Ekstraksi / analisis produk"],
                ["deconstruct", "Deconstruct Lab"],
                ["campaign", "Content Planner & mesin kampanye"],
              ].map(([kind, title]) => (
                <div className="gp-route" key={kind}>
                  <span>{title}</span>
                  <code>{c.smartRouting ? MODULE_MODELS[kind] : c.model}</code>
                </div>
              ))}
            </div>
          )}
          <div className="gp-box gp-space">
            <h3>Rantai eksekusi berjenjang (Waterfall Fallback)</h3>
            <small>
              {c.smartRouting && c.tier === "paid"
                ? "Preview jalur kampanye; model awal modul lain mengikuti matriks di atas."
                : "Model utama diikuti fallback pilihan dan urutan bawaan V2."}
            </small>
            {modelChain(c, "campaign").map((m, i) => (
              <div className="gp-route" key={m}>
                <code>
                  {i + 1}. {m}
                </code>
                <span className={"badge " + (i === 0 ? "success" : "")}>
                  {i === 0 ? "Model utama" : "Fallback " + i}
                </span>
              </div>
            ))}
            <small>
              Fallback hanya untuk penolakan yang aman dicoba ulang. Hasil POST
              yang belum pasti memerlukan rekonsiliasi.
            </small>
          </div>
          <div className="gp-box gp-space">
            <h3>Status Google Context Caching</h3>
            <div className="actions gp-space">
              <label className="gp-check">
                <input
                  type="radio"
                  name="gemini-cache"
                  disabled={c.tier !== "paid"}
                  checked={c.contextCaching}
                  onChange={() => change({ contextCaching: true })}
                />{" "}
                Aktif
              </label>
              <label className="gp-check">
                <input
                  type="radio"
                  name="gemini-cache"
                  checked={!c.contextCaching}
                  onChange={() => change({ contextCaching: false })}
                />{" "}
                Nonaktif
              </label>
            </div>
            <small>
              {c.tier === "free"
                ? "Nonaktif otomatis pada Free Tier."
                : "Cache teks panjang yang identik selama 15 menit bila model mendukung. Jika cache tidak tersedia, input dikirim secara biasa."}
            </small>
          </div>
          <button className="primary gp-space" disabled={busy}>
            Simpan konfigurasi Gemini AI
          </button>
        </form>
      </div>
      {confirm && (
        <div className="gp-modal-backdrop">
          <section
            className="gp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pool-confirm-title"
          >
            <h2 id="pool-confirm-title">
              {confirm.clean
                ? "Arsipkan seluruh key invalid?"
                : "Arsipkan " + confirm.name + "?"}
            </h2>
            <p>
              Key dikeluarkan dari pool. Riwayat tetap tersimpan dan dapat
              dipulihkan. Key cooldown atau gangguan sementara tidak ikut
              dibersihkan.
            </p>
            <div className="actions">
              <button disabled={busy} onClick={() => setConfirm(null)}>
                Batal
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (confirm.clean)
                    await perform(
                      () => api("settings/pool-clean", {}),
                      "Key invalid diarsipkan.",
                    );
                  else await state(confirm.id, "archived");
                  setConfirm(null);
                }}
              >
                Arsipkan
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
