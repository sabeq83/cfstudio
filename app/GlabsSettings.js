"use client";
import { useState, useRef } from "react";
import { imageModels, videoModels } from "../lib/glabs-settings.js";
export default function GlabsSettings({
  value,
  onChange,
  configured,
  busy,
  onSave,
  api,
}) {
  const [editing, setEditing] = useState(false),
    [diagnostic, setDiagnostic] = useState(null),
    [testing, setTesting] = useState(false),
    [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState("");
  const draftRevision = useRef(0);
  let u;
  try {
    u = new URL(value.baseUrl);
  } catch {}
  const host = value.host ?? u?.hostname ?? "",
    port =
      value.port ?? (u?.port || (u?.protocol === "https:" ? "443" : "8765")),
    protocol = value.protocol ?? u?.protocol?.slice(0, -1) ?? "http";
  const config = { ...value, host, port, protocol };
  function field(k, v) {
    draftRevision.current++;
    onChange({ ...config, [k]: v });
    setDirty(true);
    setDiagnostic(null);
    setSaved("");
  }
  async function test() {
    const revision = draftRevision.current;
    setTesting(true);
    setDiagnostic(null);
    try {
      const { apiKey, ...draft } = config;
      const result = await api("settings/glabs-test", {
        config: draft,
        secret: { apiKey },
      });
      if (revision === draftRevision.current) setDiagnostic(result);
    } catch {
      if (revision === draftRevision.current)
        setDiagnostic({
          ok: false,
          message: "Pemeriksaan gagal. Periksa host, port, dan izin akses.",
        });
    } finally {
      setTesting(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    const result = await onSave(config);
    if (result) {
      setDirty(false);
      setEditing(false);
      setSaved("Konfigurasi tersimpan.");
      setDiagnostic(null);
    }
  }
  function model(k, title, options) {
    return (
      <label>
        {title}
        <select value={value[k]} onChange={(e) => field(k, e.target.value)}>
          {!options.includes(value[k]) && (
            <option value={value[k]}>Tersimpan: {value[k]}</option>
          )}
          {options.map((m) => (
            <option key={m} value={m}>
              {m.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <>
      <h3>G-Labs Webhook Configuration</h3>
      <p>Satu worker bersama untuk seluruh jalur produksi.</p>
      <div className="panel" role="status">
        <strong>
          {testing
            ? "Memeriksa…"
            : diagnostic
              ? diagnostic.ok
                ? "Online"
                : "Gagal"
              : "Belum dites untuk konfigurasi ini"}
        </strong>
        <p>
          {diagnostic?.message ||
            "Tes koneksi memeriksa health worker tanpa membuat media."}
        </p>
        {diagnostic && (
          <small>
            {diagnostic.testedUrl} • {diagnostic.checkedAt}
          </small>
        )}
      </div>
      <form onSubmit={save}>
        <div className="grid">
          <label>
            Host / IP
            <input
              required
              value={host}
              placeholder="alamat-worker"
              onChange={(e) => field("host", e.target.value)}
            />
          </label>
          <label>
            Port
            <input
              required
              type="number"
              min="1"
              max="65535"
              value={port}
              onChange={(e) => field("port", e.target.value)}
            />
          </label>
        </div>
        <p>
          {host
            ? `${protocol}://${host}:${port}/`
            : "Isi alamat worker CF Studio."}
        </p>
        <button
          type="button"
          disabled={busy || testing || !host}
          onClick={test}
        >
          Tes koneksi
        </button>
        <label>
          API key
          {configured && !editing ? (
            <>
              <input
                type="password"
                value=""
                placeholder="Key tersimpan terenkripsi"
                readOnly
              />
              <button type="button" onClick={() => setEditing(true)}>
                Ganti
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                autoComplete="new-password"
                required={!configured}
                value={value.apiKey || ""}
                placeholder={
                  configured
                    ? "Kosongkan untuk mempertahankan key"
                    : "YOUR_API_KEY_HERE"
                }
                onChange={(e) => field("apiKey", e.target.value)}
              />
              {configured && (
                <button
                  type="button"
                  onClick={() => {
                    field("apiKey", "");
                    setEditing(false);
                  }}
                >
                  Batal
                </button>
              )}
            </>
          )}
        </label>
        <div className="grid">
          {model("imageModel", "Model gambar", imageModels)}
          {model("videoModel", "Model video", videoModels)}
        </div>
        <label>
          <input
            type="checkbox"
            checked={value.delayEnabled}
            onChange={(e) => field("delayEnabled", e.target.checked)}
          />{" "}
          Safety delay
        </label>
        {value.delayEnabled && (
          <div className="grid">
            {["delayMin", "delayMax"].map((k, i) => (
              <label key={k}>
                {i ? "Maksimum" : "Minimum"} (detik)
                <input
                  required
                  type="number"
                  min="0"
                  max="300"
                  step="1"
                  value={value[k]}
                  onChange={(e) => field(k, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <label>
          Pola T2I (Start Frame)
          <select
            value={value.t2iPattern}
            onChange={(e) => field("t2iPattern", e.target.value)}
          >
            <option value="threading">Threading</option>
            <option value="sequential">Sequential</option>
          </select>
        </label>
        <p>
          {value.t2iPattern === "sequential"
            ? "Tunggu scene selesai, lalu"
            : "Kirim bergiliran selama slot tersedia, dengan"}{" "}
          {value.delayEnabled
            ? `jeda ${value.delayMin}–${value.delayMax} detik`
            : "tanpa jeda tambahan"}
          .{" "}
          {value.t2iPattern === "threading"
            ? "Pantau hasil bersama."
            : "Lanjutkan scene berikutnya."}
        </p>
        <details>
          <summary>Pengaturan lanjutan</summary>
          <div className="grid">
            <label>
              Protokol
              <select
                value={protocol}
                onChange={(e) => field("protocol", e.target.value)}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </label>
            <label>
              Maksimal pekerjaan berjalan
              <input
                type="number"
                required
                min="1"
                max="10"
                value={value.maxConcurrent}
                onChange={(e) => field("maxConcurrent", e.target.value)}
              />
            </label>
          </div>
          <small>
            Sequential memakai satu slot. Preset dan snapshot produksi tetap
            berlaku.
          </small>
        </details>
        <p>
          <button className="primary" disabled={busy || testing}>
            Simpan konfigurasi G-Labs
          </button>
        </p>
        <p role="status">
          {saved || (dirty ? "Perubahan belum disimpan." : "")}
        </p>
      </form>
    </>
  );
}
