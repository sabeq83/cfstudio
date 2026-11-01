"use client";
import { useEffect, useState } from "react";
const tabs = [
  "Gemini API Pool Manager",
  "MiniMax AI Configuration",
  "G-Labs Webhook Configuration",
  "Repliz Publishing Integration",
];
const defaults = {
  minimax: {
    baseUrl: "https://api.minimax.io/",
    model: "speech-2.8-turbo",
    voice: "Indonesian_casual_reporter_vv2",
    fallback: true,
    apiKey: "",
  },
  glabs: {
    baseUrl: "",
    imageModel: "nano_banana_2",
    videoModel: "veo_31_lite",
    delayEnabled: true,
    delayMin: 10,
    delayMax: 20,
    t2iPattern: "threading",
    maxConcurrent: 2,
    apiKey: "",
  },
  repliz: { baseUrl: "https://api.repliz.com/", accessKey: "", secretKey: "" },
};
export default function Settings({ actor, api, action }) {
  const [tab, setTab] = useState(
      typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).has("google")
        ? tabs[3]
        : tabs[0],
    ),
    [pool, setPool] = useState({ projects: [], keys: [], settings: {} }),
    [poolConfig, setPoolConfig] = useState({
      model: "",
      ttsModel: "gemini-2.5-flash-preview-tts",
      budgetTimezone: "Asia/Jakarta",
    }),
    [forms, setForms] = useState(defaults),
    [connections, setConnections] = useState([]),
    [google, setGoogle] = useState({ connections: [] }),
    [googleForm, setGoogleForm] = useState({
      clientId: "",
      clientSecret: "",
      folderId: "",
      retentionDays: 14,
      graceDays: 2,
    }),
    [importKeys, setImportKeys] = useState({
      projectId: "",
      projectName: "",
      projectLimit: 20,
      text: "",
    }),
    [audio, setAudio] = useState(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const admin =
    actor?.allBrands && actor?.capabilities?.includes("integration.manage");
  async function load(initial = false) {
    if (!admin) return;
    const [p, c, g, s] = await Promise.all([
      api("settings/pool"),
      api("connections"),
      api("google/status"),
      api("settings/providers"),
    ]);
    setPool(p);
    setConnections(c);
    setGoogle(g);
    if (initial) {
      setPoolConfig({ ...poolConfig, ...p.settings });
      setForms(
        Object.fromEntries(
          Object.entries(defaults).map(([k, v]) => [k, { ...v, ...s[k] }]),
        ),
      );
      const current = g.connections[0];
      if (current)
        setGoogleForm({ ...googleForm, ...current.config, clientSecret: "" });
    }
  }
  useEffect(() => {
    load(true).catch((e) => setMessage(e.message));
  }, [actor?.tenantId, admin]);
  async function perform(fn, text) {
    setBusy(true);
    setMessage("");
    try {
      const result = await action(fn, text);
      if (result) {
        setMessage(text || "Pemeriksaan selesai.");
        await load();
      }
      return result;
    } finally {
      setBusy(false);
    }
  }
  async function saveProvider(kind) {
    const f = forms[kind],
      secret =
        kind === "repliz"
          ? { accessKey: f.accessKey, secretKey: f.secretKey }
          : { apiKey: f.apiKey };
    const { apiKey, accessKey, secretKey, ...config } = f;
    const r = await perform(
      () => api("settings/provider", { kind, config, secret }),
      "Konfigurasi tersimpan. Preset dan snapshot aktif tetap berlaku.",
    );
    if (r)
      setForms({
        ...forms,
        [kind]: { ...f, apiKey: "", accessKey: "", secretKey: "" },
      });
  }
  function field(kind, key, value) {
    setForms({ ...forms, [kind]: { ...forms[kind], [key]: value } });
  }
  const active = google.connections.find((c) => c.status === "configured"),
    disconnecting = google.connections.find(
      (c) => c.status === "disconnecting",
    ),
    current = google.connections[0],
    configured = (kind) =>
      connections.some((c) => c.kind === kind && c.status === "configured");
  if (!admin)
    return (
      <div className="panel">
        <p>
          Konfigurasi layanan tenant dikelola oleh pengguna berizin pengelolaan
          integrasi seluruh brand.
        </p>
      </div>
    );
  return (
    <section className="panel">
      <h2>Pengaturan layanan produksi</h2>
      <p>
        Credential terenkripsi. Gunakan koneksi CF Studio; pengaturan V2 tidak
        diaktifkan otomatis.
      </p>
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              setTab(t);
              setMessage("");
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {message && (
        <p className="banner" role="status">
          {message}
        </p>
      )}
      {tab === tabs[0] && (
        <>
          <h3>Gemini API Pool Manager</h3>
          <p>
            {pool.keys.length} key • {pool.projects.length} project • pemakaian
            lokal {pool.projects.reduce((a, p) => a + p.used_today, 0)} /{" "}
            {pool.projects.reduce((a, p) => a + p.daily_limit, 0)} request •{" "}
            {pool.budgetDay}
          </p>
          <small>
            Kuota Google berlaku per project. Angka di sini adalah batas dan
            catatan lokal CF Studio, bukan sisa kuota langsung dari Google.
          </small>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              perform(
                () => api("settings/pool-config", poolConfig),
                "Model dan zona waktu pool tersimpan.",
              );
            }}
          >
            <div className="grid">
              <label>
                Model planner / creative / analisis
                <input
                  required
                  value={poolConfig.model || ""}
                  onChange={(e) =>
                    setPoolConfig({ ...poolConfig, model: e.target.value })
                  }
                />
              </label>
              <label>
                Model Gemini TTS
                <input
                  required
                  value={poolConfig.ttsModel || ""}
                  onChange={(e) =>
                    setPoolConfig({ ...poolConfig, ttsModel: e.target.value })
                  }
                />
              </label>
              <label>
                Zona waktu batas lokal
                <select
                  value={poolConfig.budgetTimezone}
                  onChange={(e) =>
                    setPoolConfig({
                      ...poolConfig,
                      budgetTimezone: e.target.value,
                    })
                  }
                >
                  {[
                    "Asia/Jakarta",
                    "Asia/Makassar",
                    "Asia/Jayapura",
                    "America/Los_Angeles",
                    "UTC",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <button disabled={busy}>Simpan default Gemini</button>
          </form>
          <details>
            <summary>Tambah key satuan / bulk</summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const keys = importKeys.text
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((line, index) => {
                    const sep = line.includes(":")
                      ? ":"
                      : line.includes(",")
                        ? ","
                        : null;
                    const i = sep ? line.indexOf(sep) : -1;
                    return {
                      name:
                        i >= 0 ? line.slice(0, i).trim() : "Key " + (index + 1),
                      apiKey: i >= 0 ? line.slice(i + 1).trim() : line,
                      dailyLimit: Number(importKeys.projectLimit),
                    };
                  });
                const r = await perform(
                  () =>
                    api("settings/pool", {
                      projectId: importKeys.projectId || undefined,
                      projectName: importKeys.projectName,
                      projectLimit: Number(importKeys.projectLimit),
                      keys,
                    }),
                  "Impor selesai; key duplikat tidak ditambahkan.",
                );
                if (r) {
                  setImportKeys({ ...importKeys, text: "" });
                  setMessage(
                    `${r.added} ditambahkan • ${r.duplicates} duplikat dilewati`,
                  );
                }
              }}
            >
              <div className="grid">
                <label>
                  Project group
                  <select
                    value={importKeys.projectId}
                    onChange={(e) => {
                      const p = pool.projects.find(
                        (p) => p.id === e.target.value,
                      );
                      setImportKeys({
                        ...importKeys,
                        projectId: e.target.value,
                        projectName: p?.label || "",
                        projectLimit: p?.daily_limit || 20,
                      });
                    }}
                  >
                    <option value="">Project baru</option>
                    {pool.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nama project
                  <input
                    required
                    value={importKeys.projectName}
                    readOnly={!!importKeys.projectId}
                    onChange={(e) =>
                      setImportKeys({
                        ...importKeys,
                        projectName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Batas request lokal per hari
                  <input
                    type="number"
                    required
                    min="1"
                    max="100000"
                    readOnly={!!importKeys.projectId}
                    value={importKeys.projectLimit}
                    onChange={(e) =>
                      setImportKeys({
                        ...importKeys,
                        projectLimit: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Key • satu baris per key
                <textarea
                  required
                  type="password"
                  autoComplete="off"
                  rows="4"
                  placeholder="Nama key: YOUR_API_KEY_HERE"
                  value={importKeys.text}
                  onChange={(e) =>
                    setImportKeys({ ...importKeys, text: e.target.value })
                  }
                />
              </label>
              <button disabled={busy}>Tambahkan ke pool</button>
            </form>
          </details>
          <div className="actions">
            <button
              disabled={busy || !pool.keys.length}
              onClick={() =>
                perform(
                  () => api("settings/pool-test", {}),
                  "Pemeriksaan key selesai. Gangguan sementara tidak menonaktifkan key.",
                )
              }
            >
              Audit & tes semua key
            </button>
          </div>
          {pool.projects.map((p) => (
            <div className="target" key={p.id}>
              <h3>{p.label}</h3>
              <small>
                {p.used_today}/{p.daily_limit} request lokal •{" "}
                {p.cooldown_until && new Date(p.cooldown_until) > new Date()
                  ? "cooldown"
                  : "siap"}
                {p.exhausted_day === pool.budgetDay
                  ? " • batas project tercapai"
                  : ""}
              </small>
            </div>
          ))}
          {pool.keys.map((k) => (
            <div className="target row" key={k.id}>
              <div>
                <h3>{k.name}</h3>
                <small>
                  {k.masked} • {k.status} • {k.used_today}/{k.daily_limit} •{" "}
                  {k.last_error_code || "belum ada error"}
                </small>
              </div>
              <div className="actions">
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
                  disabled={busy}
                  onClick={() =>
                    perform(
                      () =>
                        api("settings/pool-state", {
                          id: k.id,
                          status: k.status === "active" ? "disabled" : "active",
                        }),
                      "Status key diperbarui.",
                    )
                  }
                >
                  {k.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(
                      () =>
                        api("settings/pool-state", {
                          id: k.id,
                          status: "archived",
                        }),
                      "Key diarsipkan; catatan pemakaian dipertahankan.",
                    )
                  }
                >
                  Arsipkan
                </button>
              </div>
            </div>
          ))}
        </>
      )}
      {tab === tabs[1] && (
        <>
          <h3>MiniMax AI Configuration</h3>
          <p>
            Status:{" "}
            {configured("minimax")
              ? "credential tersimpan"
              : "belum dikonfigurasi"}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveProvider("minimax");
            }}
          >
            <div className="grid">
              <label>
                Endpoint
                <input
                  type="url"
                  required
                  value={forms.minimax.baseUrl}
                  onChange={(e) => field("minimax", "baseUrl", e.target.value)}
                />
              </label>
              <label>
                API key baru
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    configured("minimax")
                      ? "Kosongkan untuk mempertahankan key"
                      : "YOUR_API_KEY_HERE"
                  }
                  value={forms.minimax.apiKey}
                  onChange={(e) => field("minimax", "apiKey", e.target.value)}
                />
              </label>
              <label>
                Model TTS
                <input
                  required
                  value={forms.minimax.model}
                  onChange={(e) => field("minimax", "model", e.target.value)}
                />
              </label>
              <label>
                Voice ID default
                <input
                  required
                  value={forms.minimax.voice}
                  onChange={(e) => field("minimax", "voice", e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={forms.minimax.fallback}
                  onChange={(e) =>
                    field("minimax", "fallback", e.target.checked)
                  }
                />{" "}
                Fallback ke Gemini TTS jika kegagalan aman untuk dicoba
              </label>
            </div>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Simpan MiniMax
              </button>
              <button
                type="button"
                disabled={busy || !configured("minimax")}
                onClick={async () => {
                  const r = await perform(
                    () => api("settings/provider-test", { kind: "minimax" }),
                    "Tes suara selesai.",
                  );
                  if (r) setAudio(r.audioUrl);
                }}
              >
                Tes suara pendek • menggunakan API
              </button>
            </div>
          </form>
          {audio && <audio controls src={audio} />}
          <small>
            Preset dapat menentukan suara, kecepatan dan volume. Timeout dengan
            hasil belum pasti tidak otomatis dikirim ke provider lain.
          </small>
        </>
      )}
      {tab === tabs[2] && (
        <>
          <h3>G-Labs Webhook Configuration</h3>
          <p>Satu gateway bersama untuk seluruh jalur produksi.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveProvider("glabs");
            }}
          >
            <div className="grid">
              <label>
                Endpoint worker
                <input
                  required
                  type="url"
                  placeholder="http://alamat-worker:port"
                  value={forms.glabs.baseUrl}
                  onChange={(e) => field("glabs", "baseUrl", e.target.value)}
                />
              </label>
              <label>
                API key baru
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    configured("glabs")
                      ? "Kosongkan untuk mempertahankan key"
                      : "YOUR_API_KEY_HERE"
                  }
                  value={forms.glabs.apiKey}
                  onChange={(e) => field("glabs", "apiKey", e.target.value)}
                />
              </label>
              <label>
                Model gambar default
                <input
                  required
                  value={forms.glabs.imageModel}
                  onChange={(e) => field("glabs", "imageModel", e.target.value)}
                />
              </label>
              <label>
                Model video default
                <input
                  required
                  value={forms.glabs.videoModel}
                  onChange={(e) => field("glabs", "videoModel", e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={forms.glabs.delayEnabled}
                  onChange={(e) =>
                    field("glabs", "delayEnabled", e.target.checked)
                  }
                />{" "}
                Aktifkan safety delay
              </label>
              <label>
                Maksimal job berjalan
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={forms.glabs.maxConcurrent}
                  onChange={(e) =>
                    field("glabs", "maxConcurrent", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Jeda minimum (detik)
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={forms.glabs.delayMin}
                  onChange={(e) =>
                    field("glabs", "delayMin", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Jeda maksimum (detik)
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={forms.glabs.delayMax}
                  onChange={(e) =>
                    field("glabs", "delayMax", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Pola start frame
                <select
                  value={forms.glabs.t2iPattern}
                  onChange={(e) => field("glabs", "t2iPattern", e.target.value)}
                >
                  <option value="threading">
                    Threading • kirim bergiliran, pantau bersama
                  </option>
                  <option value="sequential">
                    Sequential • tunggu hasil per scene
                  </option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button className="primary" disabled={busy}>
                Simpan G-Labs
              </button>
              <button
                type="button"
                disabled={busy || !configured("glabs")}
                onClick={() =>
                  perform(
                    () => api("settings/provider-test", { kind: "glabs" }),
                    "Pemeriksaan koneksi G-Labs berhasil.",
                  )
                }
              >
                Tes koneksi
              </button>
            </div>
          </form>
        </>
      )}
      {tab === tabs[3] && (
        <>
          <h3>Repliz Publishing Integration</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveProvider("repliz");
            }}
          >
            <label>
              Endpoint Repliz
              <input
                required
                type="url"
                value={forms.repliz.baseUrl}
                onChange={(e) => field("repliz", "baseUrl", e.target.value)}
              />
            </label>
            <div className="grid">
              {["accessKey", "secretKey"].map((k) => (
                <label key={k}>
                  {k === "accessKey" ? "Access key" : "Secret key"}
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      configured("repliz")
                        ? "Kosongkan untuk mempertahankan nilai"
                        : "YOUR_API_KEY_HERE"
                    }
                    value={forms.repliz[k]}
                    onChange={(e) => field("repliz", k, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="actions">
              <button disabled={busy}>Simpan Repliz</button>
              <button
                type="button"
                disabled={busy || !configured("repliz")}
                onClick={() =>
                  perform(
                    () => api("settings/provider-test", { kind: "repliz" }),
                    "Koneksi Repliz diperiksa. Tautkan akun ke brand di bagian bawah.",
                  )
                }
              >
                Tes Repliz
              </button>
            </div>
          </form>
          <div className="target">
            <h3>Google Drive Publishing</h3>
            <p>
              {active?.config.email || "Akun Google belum terhubung"} •{" "}
              {active?.config.folderName || "Folder belum disiapkan"}
            </p>
            <small>
              OAuth CF Studio: {google.redirectUri}. Gunakan browser biasa untuk
              proses izin Google.
            </small>
            <details open={!current}>
              <summary>Konfigurasi OAuth aplikasi dan retensi</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await perform(
                    () => api("google/config", googleForm),
                    "Konfigurasi Google tersimpan. Hubungkan akun Google untuk memberi izin.",
                  );
                  if (r) setGoogleForm({ ...googleForm, clientSecret: "" });
                }}
              >
                <label>
                  Google OAuth Client ID
                  <input
                    required
                    value={googleForm.clientId || ""}
                    onChange={(e) =>
                      setGoogleForm({ ...googleForm, clientId: e.target.value })
                    }
                  />
                </label>
                <label>
                  Client secret baru
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={googleForm.clientSecret}
                    placeholder={
                      current
                        ? "Kosongkan untuk mempertahankan secret"
                        : "YOUR_CLIENT_SECRET_HERE"
                    }
                    onChange={(e) =>
                      setGoogleForm({
                        ...googleForm,
                        clientSecret: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Folder ID / URL • opsional
                  <input
                    value={googleForm.folderId || ""}
                    onChange={(e) =>
                      setGoogleForm({ ...googleForm, folderId: e.target.value })
                    }
                  />
                </label>
                <div className="grid">
                  <label>
                    Retensi minimum salinan (hari)
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={googleForm.retentionDays}
                      onChange={(e) =>
                        setGoogleForm({
                          ...googleForm,
                          retentionDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Masa tenggang setelah jadwal terakhir (hari)
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={googleForm.graceDays}
                      onChange={(e) =>
                        setGoogleForm({
                          ...googleForm,
                          graceDays: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <button disabled={busy}>Simpan konfigurasi Google</button>
              </form>
            </details>
            <div className="actions">
              <button
                disabled={busy || !current || !!disconnecting}
                onClick={async () => {
                  const r = await perform(
                    () => api("google/start", { id: current.id }),
                    "Membuka izin Google.",
                  );
                  if (r) window.location.assign(r.authUrl);
                }}
              >
                {active ? "Hubungkan ulang Google" : "Hubungkan Google"}
              </button>
              <button
                disabled={busy || !active}
                onClick={() =>
                  perform(
                    () => api("google/folder", { id: active.id }),
                    "Folder publishing terverifikasi.",
                  )
                }
              >
                Buat / perbaiki folder
              </button>
              <button
                disabled={busy || !active}
                onClick={() =>
                  perform(
                    () => api("google/verify", { id: active.id }),
                    "Folder tersedia dan dapat ditulis.",
                  )
                }
              >
                Tes kesiapan Drive
              </button>
              <button
                disabled={busy || (!active && !disconnecting)}
                onClick={() =>
                  perform(
                    () =>
                      api("google/disconnect", {
                        id: (disconnecting || active).id,
                      }),
                    "Google dilepas. File asli tidak dihapus.",
                  )
                }
              >
                {disconnecting
                  ? "Lanjutkan pelepasan koneksi"
                  : "Lepas koneksi"}
              </button>
            </div>
            <p className="muted">
              Media final yang disetujui disalin ke Drive setelah dijadwalkan.
              Salinan publik diperiksa sebelum dikirim ke Repliz. Pembersihan
              menunggu seluruh jadwal terkait selesai; file asli tetap privat.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
