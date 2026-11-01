"use client";
import Settings from "./Settings";
import { useEffect, useRef, useState } from "react";
const menus = [
  "Automation",
  "Product Database",
  "Deconstruct Lab",
  "Brand Profile Manager",
  "Setting",
];
const tabs = ["Setting Automation", "Daily Review", "Schedule", "History"];
const labels = {
  multiplier: "Video Multiplier",
  recipe_video: "Video Recipe Campaign",
  recipe_static: "Resep foto & teks",
  brand_editorial: "Video Brand Editorial",
  product_campaign: "Video Product Campaign",
};
const hints = {
  multiplier: "Hasil Deconstruct → storyboard baru → pipeline video bersama.",
  recipe_video: "Recipe Planner → storyboard resep → pipeline video bersama.",
  recipe_static: "Recipe Labs → gambar resep → foto dan teks.",
  brand_editorial:
    "Content Planner Brand Editorial → storyboard → pipeline video bersama.",
  product_campaign:
    "Produk → Content Planner menghasilkan CEP dan plan → pipeline video bersama.",
};
const states = {
  queued: "Antrean",
  ready: "Siap direview",
  failed: "Perlu pemeriksaan",
  processing: "Diproses",
  awaiting_creative_approval: "Review kreatif",
  awaiting_review: "Menunggu review",
  accepted: "Diterima Repliz",
  published: "Terpublikasi",
  unknown: "Belum pasti • rekonsiliasi",
  submitting: "Sedang dikirim",
  active: "Aktif",
  draft: "Draf",
  paused: "Dijeda",
  cancel_requested: "Menunggu pembatalan",
  canceling: "Membatalkan",
  retry_wait: "Menunggu percobaan ulang",
  canceled: "Dibatalkan",
  completed: "Selesai",
};
const emptyRoutine = {
  name: "",
  brandId: "",
  timezone: "Asia/Jakarta",
  time: "05:00",
  frequency: "daily",
  creativeApproval: "auto",
  missedSlotPolicy: "run_latest",
};
const blankTarget = {
  name: "",
  kind: "brand_editorial",
  count: 2,
  selected: true,
  productId: "",
  sourceId: "",
  presetId: "",
  identityId: "",
  direction: "",
};
const caps = [
  "catalog.read",
  "catalog.manage",
  "automation.read",
  "automation.manage",
  "production.run",
  "content.edit",
  "content.approve",
  "publishing.schedule",
  "publishing.cancel",
  "integration.manage",
  "tenant.users.manage",
];
const media = (a) =>
  a?.id
    ? "/api/v3/media/" +
      encodeURIComponent(a.tenant_id) +
      "/" +
      encodeURIComponent(a.id)
    : a?.assetId
      ? "/api/v3/media/" +
        encodeURIComponent(a.tenantId) +
        "/" +
        encodeURIComponent(a.assetId)
      : null;
const displayDate = (v) => (v ? new Date(v).toLocaleString("id-ID") : "—");
export default function Studio() {
  const [menu, setMenu] = useState("Automation"),
    [tab, setTab] = useState(tabs[0]),
    [actor, setActor] = useState(null),
    [health, setHealth] = useState(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [login, setLogin] = useState({
      tenantId: "default_tenant",
      username: "admin",
      password: "",
    }),
    [catalogs, setCatalogs] = useState({
      brand: [],
      product: [],
      deconstruct: [],
      preset: [],
      visual_identity: [],
    }),
    [routines, setRoutines] = useState([]),
    [items, setItems] = useState([]),
    [publishing, setPublishing] = useState([]),
    [history, setHistory] = useState([]),
    [connections, setConnections] = useState([]),
    [accounts, setAccounts] = useState([]),
    [users, setUsers] = useState([]),
    [catalogJobs, setCatalogJobs] = useState([]),
    [notifications, setNotifications] = useState({}),
    [telegramBots, setTelegramBots] = useState([]);
  const [routine, setRoutine] = useState(emptyRoutine),
    [targets, setTargets] = useState([]),
    [target, setTarget] = useState(blankTarget),
    [targetIndex, setTargetIndex] = useState(null),
    [assignments, setAssignments] = useState([]),
    [brand, setBrand] = useState(null),
    [brandTab, setBrandTab] = useState("Preset"),
    [assignId, setAssignId] = useState(""),
    [search, setSearch] = useState(""),
    [reviewFilter, setReviewFilter] = useState("all");
  const [editor, setEditor] = useState(null),
    [selectedItem, setSelectedItem] = useState(null),
    [caption, setCaption] = useState(""),
    [schedule, setSchedule] = useState({ accountId: "", scheduledAt: "" }),
    [connection, setConnection] = useState({ label: "", botToken: "" }),
    [mapping, setMapping] = useState({
      connectionId: "",
      brandId: "",
      available: [],
      selected: [],
    }),
    [verification, setVerification] = useState(null),
    [quiet, setQuiet] = useState({ quietStart: "22:00", quietEnd: "07:00" }),
    [newUser, setNewUser] = useState({
      username: "",
      password: "",
      role: "viewer",
      capabilities: ["catalog.read", "automation.read"],
      brandIds: [],
      allBrands: false,
    });
  const targetDialog = useRef(null),
    editorDialog = useRef(null),
    reviewDialog = useRef(null);
  const can = (cap) => actor?.capabilities?.includes(cap);
  async function api(path, body) {
    const res = await fetch(
      "/api/v3/" + path,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": crypto.randomUUID(),
            },
            body: JSON.stringify(body),
          },
    );
    const j = await res.json();
    if (!res.ok) throw new Error(j.message || "Permintaan belum berhasil.");
    return j.data ?? j;
  }
  async function load() {
    const me = await api("me");
    setActor(me);
    const domains = Object.keys(catalogs);
    const loaded = await Promise.all(domains.map((d) => api("catalog/" + d)));
    setCatalogs(Object.fromEntries(domains.map((d, i) => [d, loaded[i]])));
    const operation = await Promise.all(
      ["routines", "items", "publishing", "history"].map((x) => api(x)),
    );
    setRoutines(operation[0]);
    setItems(operation[1]);
    setPublishing(operation[2]);
    setHistory(operation[3]);
    if (me.capabilities.includes("integration.manage"))
      setConnections(await api("connections"));
    if (me.capabilities.includes("publishing.schedule"))
      setAccounts(await api("accounts"));
    if (me.capabilities.includes("tenant.users.manage"))
      setUsers(await api("users"));
    setNotifications(await api("notifications"));
    setTelegramBots(await api("telegram/bots"));
    setCatalogJobs(await api("catalog-jobs"));
  }
  async function action(fn, message) {
    setBusy(true);
    setNotice("");
    try {
      const value = await fn();
      if (message) setNotice(message);
      await load();
      return value;
    } catch (e) {
      setNotice(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("google"))
      setMenu("Setting");
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth);
    load().catch((e) => {
      if (e.message !== "Silakan login.") setNotice(e.message);
    });
  }, []);
  async function chooseBrand(b) {
    setBrand(b);
    setBrandTab("Preset");
    setAssignments(await api("assignments/" + b.id));
  }
  async function refreshAssignments(brandId) {
    setAssignments(await api("assignments/" + brandId));
  }
  async function chooseRoutineBrand(id) {
    setRoutine({ ...routine, brandId: id });
    setTargets([]);
    if (id) await refreshAssignments(id);
    else setAssignments([]);
  }
  async function openTarget(index = null) {
    try {
      await refreshAssignments(routine.brandId);
    } catch (e) {
      setNotice(e.message);
      return;
    }
    setTargetIndex(index);
    setTarget(index === null ? { ...blankTarget } : targets[index]);
    targetDialog.current.showModal();
  }
  function saveTarget(e) {
    e.preventDefault();
    setTargets(
      targetIndex === null
        ? [...targets, { ...target }]
        : targets.map((t, i) => (i === targetIndex ? { ...target } : t)),
    );
    targetDialog.current.close();
  }
  async function saveRoutine() {
    const value = await action(
      () =>
        api("routines", {
          ...routine,
          targets,
          expectedRevision: routine.revision,
        }),
      "Draf tersimpan. Revisi aktif tetap berlaku sampai Anda mengaktifkan draf ini.",
    );
    if (value)
      setRoutine({ ...value.draft, id: value.id, revision: value.revision });
  }
  function openEditor(object = null, domain = null) {
    setEditor({
      id: object?.id,
      expectedRevision: object?.revision,
      domain: object?.domain || domain,
      name: object?.name || "",
      brandId: object?.brand_id || "",
      payload: JSON.stringify(object?.payload || {}, null, 2),
    });
    if (!editorDialog.current.open) editorDialog.current.showModal();
  }
  async function saveEditor(e) {
    e.preventDefault();
    const v = await action(
      () => api("catalog", { ...editor, payload: JSON.parse(editor.payload) }),
      "Data tersimpan.",
    );
    if (v) editorDialog.current.close();
  }
  function openReview(item) {
    setSelectedItem(item);
    setCaption(item.caption || "");
    setSchedule({
      accountId: accounts.find((a) => a.brand_id === item.brand_id)?.id || "",
      scheduledAt: "",
    });
    reviewDialog.current.showModal();
  }
  async function reviewAction(type, body, message) {
    const value = await action(
      () => api("items/" + selectedItem.id + "/" + type, body),
      message,
    );
    if (value) reviewDialog.current.close();
  }

  function editorData() {
    try {
      return JSON.parse(editor?.payload || "{}");
    } catch {
      return {};
    }
  }
  function setEditorField(key, value) {
    setEditor({
      ...editor,
      payload: JSON.stringify({ ...editorData(), [key]: value }, null, 2),
    });
  }
  function editorPreset() {
    let config = editorData().config_json || {};
    if (typeof config === "string")
      try {
        config = JSON.parse(config);
      } catch {
        config = {};
      }
    return config.config || config;
  }
  function setPresetField(section, key, value) {
    const payload = editorData();
    let raw = payload.config_json || {};
    if (typeof raw === "string") raw = JSON.parse(raw);
    let config = raw.config || raw;
    config = { ...config, [section]: { ...config[section], [key]: value } };
    setEditor({
      ...editor,
      payload: JSON.stringify(
        { ...payload, config_json: raw.config ? { ...raw, config } : config },
        null,
        2,
      ),
    });
  }
  async function uploadSource(file) {
    if (!file) return;
    await action(async () => {
      const form = new FormData();
      form.set("objectId", editor.id);
      form.set("expectedRevision", String(editor.expectedRevision));
      form.set("file", file);
      const response = await fetch("/api/v3/upload", {
        method: "POST",
        body: form,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message || "Unggah belum berhasil.");
      openEditor(body.data);
    }, "Sumber tersimpan. Foto produk memerlukan persetujuan sebelum digunakan.");
  }
  async function catalogAction(type) {
    const value = await action(
      () =>
        api("catalog/" + editor.id + "/" + type, {
          revision: editor.expectedRevision,
        }),
      type === "analyze"
        ? "Analisis masuk antrean worker."
        : "Foto produk disetujui.",
    );
    if (value && type === "approve-photo") openEditor(value);
  }
  const originalEditor = editor?.id
    ? catalogs[editor.domain]?.find((c) => c.id === editor.id)
    : null;
  const editorDirty =
    !originalEditor ||
    editor.name !== originalEditor.name ||
    editor.payload !== JSON.stringify(originalEditor.payload, null, 2) ||
    editor.brandId !== (originalEditor.brand_id || "");
  const editorReference =
    editorData().photoArtifactId ||
    editorData().imageArtifactId ||
    editorData().videoArtifactId;
  const names = (id) =>
    catalogs.brand.find((b) => b.id === id)?.name || "Brand";
  const selected = targets.filter((t) => t.selected !== false);
  const settingsEnabled = can("integration.manage");
  const card = (item) => (
    <div className="target row" key={item.id}>
      <div>
        <h3>{item.name}</h3>
        <small>
          Revisi {item.revision}{" "}
          {item.payload?.status ? "• " + item.payload.status : ""}
        </small>
        {item.domain === "product" && (
          <small>
            Brand:{" "}
            {(item.linked_brand_ids || []).map(names).join(", ") ||
              names(item.brand_id)}
          </small>
        )}
        {item.payload?.migration && (
          <small>
            Asal MAKNA Flow • media{" "}
            {item.payload.migration.mediaStatus === "partial_verified"
              ? "sebagian terverifikasi"
              : "belum terverifikasi"}
          </small>
        )}
      </div>
      <div className="actions">
        <button onClick={() => openEditor(item)}>
          {can("catalog.manage") ? "Buka / edit" : "Lihat detail"}
        </button>
        {can("catalog.manage") && !item.payload?.is_system && (
          <button
            disabled={busy}
            onClick={() =>
              action(
                () =>
                  api("catalog/" + item.id + "/archive", {
                    expectedRevision: item.revision,
                  }),
                "Data diarsipkan.",
              )
            }
          >
            Arsipkan
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          CF<span> Studio</span>
        </div>
        <small>V3 • CONTENT OPERATING SYSTEM</small>
        <nav>
          {menus.map((m) => (
            <button
              key={m}
              className={menu === m ? "active" : ""}
              onClick={() => {
                setMenu(m);
                setSearch("");
                setBrand(null);
                setNotice("");
              }}
            >
              {m}
            </button>
          ))}
        </nav>
        <div className="footer">
          {actor ? "Tenant: " + actor.tenantId : "Workspace CF Studio"}
          <br />
          {actor && (
            <button
              onClick={async () => {
                await api("logout", {});
                setActor(null);
              }}
            >
              Keluar
            </button>
          )}
        </div>
      </aside>
      <main>
        <div className="row">
          <div>
            <div className="eyebrow">CF Studio V3</div>
            <h1>
              {menu === "Automation" ? "Konten konsisten. Setiap hari." : menu}
            </h1>
            <p className="muted">
              Atur produksi, review hasil, dan kendalikan publikasi.
            </p>
          </div>
          <div className="actions">
            <button onClick={() => action(() => load(), "Data diperbarui.")}>
              Perbarui
            </button>
            <button
              onClick={() => {
                const next =
                  document.documentElement.dataset.theme === "light"
                    ? "dark"
                    : "light";
                document.documentElement.dataset.theme = next;
              }}
            >
              ☾ Tema
            </button>
          </div>
        </div>
        <div className="banner">
          Lingkungan pengembangan lokal. Produksi:{" "}
          {health?.productionDispatch ? "aktif" : "nonaktif"} • Publikasi:{" "}
          {health?.publishingDispatch ? "aktif" : "nonaktif"} • Telegram:{" "}
          {health?.telegramDispatch ? "aktif" : "nonaktif"}
        </div>
        {notice && (
          <div role="status" className="banner">
            {notice}
          </div>
        )}
        {!actor ? (
          <section className="panel login">
            <h2>Masuk ke workspace</h2>
            <p>
              Akun pengembangan disiapkan melalui konfigurasi lokal CF Studio.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await action(async () => {
                  await api("login", login);
                  setLogin({ ...login, password: "" });
                }, "Login berhasil.");
              }}
            >
              <label>
                Tenant ID
                <input
                  required
                  value={login.tenantId}
                  onChange={(e) =>
                    setLogin({ ...login, tenantId: e.target.value })
                  }
                />
              </label>
              <label>
                Username
                <input
                  required
                  autoComplete="username"
                  value={login.username}
                  onChange={(e) =>
                    setLogin({ ...login, username: e.target.value })
                  }
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={login.password}
                  onChange={(e) =>
                    setLogin({ ...login, password: e.target.value })
                  }
                />
              </label>
              <button className="primary" disabled={busy}>
                Masuk
              </button>
            </form>
          </section>
        ) : (
          <>
            {menu === "Automation" && (
              <>
                <div className="tabs">
                  {tabs.map((t) => (
                    <button
                      key={t}
                      className={tab === t ? "active" : ""}
                      onClick={() => setTab(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {tab === "Setting Automation" && (
                  <>
                    <div className="stats">
                      <div className="panel">
                        <small>Jalur dipilih</small>
                        <strong>{selected.length}</strong>
                      </div>
                      <div className="panel">
                        <small>Konten per batch</small>
                        <strong>
                          {selected.reduce((n, t) => n + t.count, 0)}
                        </strong>
                      </div>
                      <div className="panel">
                        <small>Rutinitas aktif</small>
                        <strong>
                          {routines.filter((r) => r.state === "active").length}
                        </strong>
                      </div>
                    </div>
                    <section className="panel">
                      <div className="row">
                        <h2>Pengaturan rutinitas</h2>
                        <button
                          onClick={() => {
                            setRoutine({ ...emptyRoutine });
                            setTargets([]);
                            setAssignments([]);
                          }}
                        >
                          Rutinitas baru
                        </button>
                      </div>
                      <div className="grid">
                        <label>
                          Nama rutinitas
                          <input
                            value={routine.name}
                            onChange={(e) =>
                              setRoutine({ ...routine, name: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Brand profile
                          <select
                            disabled={!!routine.id}
                            value={routine.brandId}
                            onChange={(e) =>
                              action(() => chooseRoutineBrand(e.target.value))
                            }
                          >
                            <option value="">Pilih brand</option>
                            {catalogs.brand.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Mulai produksi
                          <input
                            type="time"
                            value={routine.time}
                            onChange={(e) =>
                              setRoutine({ ...routine, time: e.target.value })
                            }
                          />
                        </label>
                        <label>
                          Zona waktu
                          <select
                            value={routine.timezone}
                            onChange={(e) =>
                              setRoutine({
                                ...routine,
                                timezone: e.target.value,
                              })
                            }
                          >
                            {[
                              "Asia/Jakarta",
                              "Asia/Makassar",
                              "Asia/Jayapura",
                            ].map((t) => (
                              <option key={t}>{t}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Frekuensi
                          <select
                            value={routine.frequency}
                            onChange={(e) =>
                              setRoutine({
                                ...routine,
                                frequency: e.target.value,
                              })
                            }
                          >
                            <option value="daily">Setiap hari</option>
                            <option value="weekday">Senin–Jumat</option>
                            <option value="weekly">Setiap Senin</option>
                          </select>
                        </label>
                        <label>
                          Review kreatif sebelum render
                          <select
                            value={routine.creativeApproval}
                            onChange={(e) =>
                              setRoutine({
                                ...routine,
                                creativeApproval: e.target.value,
                              })
                            }
                          >
                            <option value="auto">
                              Otomatis memakai preset
                            </option>
                            <option value="manual">Review manual</option>
                          </select>
                        </label>
                        <label>
                          Jika jadwal terlewat
                          <select
                            value={routine.missedSlotPolicy}
                            onChange={(e) =>
                              setRoutine({
                                ...routine,
                                missedSlotPolicy: e.target.value,
                              })
                            }
                          >
                            <option value="run_latest">
                              Kerjakan satu batch terbaru
                            </option>
                            <option value="skip">Lewati slot terlewat</option>
                          </select>
                        </label>
                      </div>
                      <p className="muted">
                        Persetujuan final sebelum publikasi selalu dilakukan
                        oleh pengguna.
                      </p>
                    </section>
                    <section className="panel">
                      <div className="row">
                        <div>
                          <h2>Target produksi</h2>
                          <p>
                            Pilih, simpan, edit, atau hapus setiap target
                            sebelum diaktifkan.
                          </p>
                        </div>
                        <button
                          disabled={
                            !routine.brandId || !can("automation.manage")
                          }
                          onClick={() => openTarget()}
                        >
                          ＋ Tambah target
                        </button>
                      </div>
                      {targets.length ? (
                        targets.map((t, i) => (
                          <div className="target row" key={i}>
                            <div>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={t.selected !== false}
                                  onChange={(e) =>
                                    setTargets(
                                      targets.map((v, j) =>
                                        j === i
                                          ? { ...v, selected: e.target.checked }
                                          : v,
                                      ),
                                    )
                                  }
                                />{" "}
                                {t.name}
                              </label>
                              <small>
                                {labels[t.kind]} • {t.count} konten
                              </small>
                              <small>
                                Preset:{" "}
                                {catalogs.preset.find(
                                  (p) => p.id === t.presetId,
                                )?.name || "belum dipilih"}
                              </small>
                            </div>
                            <div className="actions">
                              <button onClick={() => openTarget(i)}>
                                Edit
                              </button>
                              <button
                                onClick={() =>
                                  setTargets(targets.filter((_, j) => i !== j))
                                }
                              >
                                Hapus
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty">Belum ada target produksi.</div>
                      )}
                    </section>
                    <div className="actions">
                      <button
                        disabled={busy || !can("automation.manage")}
                        onClick={saveRoutine}
                      >
                        Simpan draf
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !routine.id || !can("production.run")}
                        onClick={() =>
                          action(
                            () =>
                              api("routines/" + routine.id + "/activate", {
                                revision: routine.revision,
                              }),
                            "Revisi tersimpan diaktifkan.",
                          )
                        }
                      >
                        Aktifkan revisi tersimpan
                      </button>
                    </div>
                    <section className="panel">
                      <h2>Rutinitas tersimpan</h2>
                      {routines
                        .filter((r) => r.state !== "archived")
                        .map((r) => (
                          <div className="target row" key={r.id}>
                            <div>
                              <h3>{r.draft.name}</h3>
                              <small>
                                {names(r.brand_id)} •{" "}
                                {states[r.state] || r.state} • draf r
                                {r.revision} / aktif r{r.active_revision || "—"}
                              </small>
                              <small>
                                Berikutnya: {displayDate(r.next_run_at)}
                              </small>
                            </div>
                            <div className="actions">
                              <button
                                onClick={() =>
                                  action(async () => {
                                    setRoutine({
                                      ...r.draft,
                                      id: r.id,
                                      revision: r.revision,
                                    });
                                    setTargets(r.draft.targets);
                                    await refreshAssignments(r.brand_id);
                                  })
                                }
                              >
                                Buka draf
                              </button>
                              {can("production.run") && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    action(
                                      () =>
                                        api("routines/" + r.id + "/run-once", {
                                          source: "draft",
                                          expectedRevision: r.revision,
                                        }),
                                      "Satu batch masuk antrean. Jadwal rutin tetap berlaku.",
                                    )
                                  }
                                >
                                  Jalankan sekali
                                </button>
                              )}
                              {can("automation.manage") && (
                                <>
                                  <button
                                    disabled={busy || !r.active_revision}
                                    onClick={() =>
                                      action(
                                        () =>
                                          api(
                                            "routines/" +
                                              r.id +
                                              "/" +
                                              (r.state === "active"
                                                ? "pause"
                                                : "resume"),
                                            { revision: r.revision },
                                          ),
                                        "Status rutinitas diperbarui.",
                                      )
                                    }
                                  >
                                    {r.state === "active"
                                      ? "Jeda"
                                      : "Lanjutkan"}
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      action(
                                        () =>
                                          api("routines/" + r.id + "/archive", {
                                            revision: r.revision,
                                          }),
                                        "Rutinitas diarsipkan.",
                                      )
                                    }
                                  >
                                    Arsipkan
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                    </section>
                  </>
                )}
                {tab === "Daily Review" && (
                  <>
                    <div className="row">
                      <p>
                        Review hasil, perbaiki caption, lalu setujui versi final
                        untuk dijadwalkan.
                      </p>
                      <select
                        className="compact"
                        value={reviewFilter}
                        onChange={(e) => setReviewFilter(e.target.value)}
                      >
                        <option value="all">Semua status</option>
                        <option value="ready">Siap direview</option>
                        <option value="awaiting_creative_approval">
                          Review kreatif
                        </option>
                        <option value="failed">Perlu pemeriksaan</option>
                        <option value="queued">Antrean</option>
                      </select>
                    </div>
                    <div className="content-grid">
                      {items
                        .filter(
                          (i) =>
                            i.status !== "archived" &&
                            (reviewFilter === "all" ||
                              i.status === reviewFilter),
                        )
                        .map((item) => (
                          <section className="panel" key={item.id}>
                            {item.artifacts?.final?.id &&
                              (item.artifacts.final.mime_type?.startsWith(
                                "video/",
                              ) ? (
                                <video
                                  controls
                                  preload="metadata"
                                  src={media(item.artifacts.final)}
                                />
                              ) : (
                                <img
                                  alt="Hasil resep"
                                  src={media(item.artifacts.final)}
                                />
                              ))}
                            <div className="row">
                              <span className="badge">
                                {states[item.status] || item.status}
                              </span>
                              {item.approved && (
                                <span className="badge">Final disetujui</span>
                              )}
                            </div>
                            <h3>{names(item.brand_id)}</h3>
                            <p>
                              {labels[item.source_kind]} • r{item.revision}
                            </p>
                            <p>
                              {item.caption?.slice(0, 150) ||
                                "Materi sedang disiapkan."}
                            </p>
                            {item.error_code && (
                              <p className="error">{item.error_code}</p>
                            )}
                            <button onClick={() => openReview(item)}>
                              Buka review
                            </button>
                          </section>
                        ))}
                    </div>
                    {!items.length && (
                      <div className="panel empty">
                        Belum ada batch. Simpan rutinitas dan jalankan sekali
                        atau aktifkan jadwalnya.
                      </div>
                    )}
                  </>
                )}
                {tab === "Schedule" && (
                  <section className="panel">
                    <h2>Jadwal publikasi</h2>
                    <p className="muted">
                      Diterima Repliz belum berarti terpublikasi. Periksa status
                      provider melalui Rekonsiliasi.
                    </p>
                    {publishing.map((intent) => (
                      <div className="target row" key={intent.id}>
                        <div>
                          <h3>
                            {intent.snapshot?.caption?.slice(0, 80) || "Konten"}
                          </h3>
                          <small>
                            {displayDate(intent.scheduled_at)} •{" "}
                            {states[intent.status] || intent.status} • r
                            {intent.revision}
                          </small>
                          {intent.error_code && (
                            <small className="error">{intent.error_code}</small>
                          )}
                        </div>
                        <div className="actions">
                          {can("publishing.schedule") && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (intent.provider_id)
                                  action(
                                    () =>
                                      api(
                                        "publishing/" +
                                          intent.id +
                                          "/reconcile",
                                        {},
                                      ),
                                    "Status provider diperbarui.",
                                  );
                                else {
                                  setSelectedItem({ intent });
                                  reviewDialog.current.showModal();
                                }
                              }}
                            >
                              Rekonsiliasi
                            </button>
                          )}
                          {can("publishing.cancel") && (
                            <button
                              disabled={
                                busy ||
                                intent.status === "published" ||
                                intent.status === "canceled"
                              }
                              onClick={() =>
                                action(
                                  () =>
                                    api(
                                      "publishing/" + intent.id + "/cancel",
                                      {},
                                    ),
                                  "Permintaan pembatalan diproses. Periksa status jadwal.",
                                )
                              }
                            >
                              Batalkan
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!publishing.length && (
                      <div className="empty">
                        Belum ada jadwal. Buka hasil yang sudah disetujui di
                        Daily Review.
                      </div>
                    )}
                  </section>
                )}
                {tab === "History" && (
                  <section className="panel">
                    <h2>Riwayat aktivitas</h2>
                    {history.map((h) => (
                      <div className="target" key={h.id}>
                        <h3>{h.event_type}</h3>
                        <small>
                          {displayDate(h.created_at)} •{" "}
                          {h.brand_id ? names(h.brand_id) : "Workspace"}
                        </small>
                        <details>
                          <summary>Detail</summary>
                          <pre>{JSON.stringify(h.event, null, 2)}</pre>
                        </details>
                      </div>
                    ))}
                    {!history.length && <p>Belum ada aktivitas.</p>}
                  </section>
                )}
              </>
            )}
            {["Product Database", "Deconstruct Lab"].includes(menu) && (
              <section className="panel">
                <div className="row">
                  <h2>{menu}</h2>
                  {can("catalog.manage") && (
                    <button
                      onClick={() =>
                        openEditor(
                          null,
                          menu === "Product Database"
                            ? "product"
                            : "deconstruct",
                        )
                      }
                    >
                      ＋ Tambah data
                    </button>
                  )}
                </div>
                <input
                  aria-label="Cari data"
                  placeholder="Cari nama"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {catalogs[
                  menu === "Product Database" ? "product" : "deconstruct"
                ]
                  .filter((i) =>
                    i.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map(card)}
              </section>
            )}
            {menu === "Brand Profile Manager" && (
              <>
                {brand ? (
                  <>
                    <button onClick={() => setBrand(null)}>
                      ← Daftar brand
                    </button>
                    <section className="panel">
                      <div className="row">
                        <div>
                          <h2>{brand.name}</h2>
                          <p>
                            Gunakan preset dan visual identity yang sudah
                            diimpor.
                          </p>
                        </div>
                        <button onClick={() => openEditor(brand)}>
                          Profil brand
                        </button>
                      </div>
                      <div className="tabs">
                        {["Preset", "Visual Identity"].map((t) => (
                          <button
                            key={t}
                            className={brandTab === t ? "active" : ""}
                            onClick={() => setBrandTab(t)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <h3>{brandTab} yang terkait brand</h3>
                      {assignments
                        .filter(
                          (a) =>
                            a.kind ===
                              (brandTab === "Preset"
                                ? "preset"
                                : "visual_identity") && a.active,
                        )
                        .map((a) => (
                          <div className="target" key={a.object_id}>
                            <h3>{a.name}</h3>
                            <small>
                              Versi terkait r{a.object_revision} • menggunakan
                              objek asli hasil impor
                            </small>
                          </div>
                        ))}
                      <div className="actions">
                        <select
                          className="compact"
                          value={assignId}
                          onChange={(e) => setAssignId(e.target.value)}
                        >
                          <option value="">
                            Pilih dari koleksi yang sudah ada
                          </option>
                          {catalogs[
                            brandTab === "Preset" ? "preset" : "visual_identity"
                          ]
                            .filter(
                              (i) => !i.brand_id || i.brand_id === brand.id,
                            )
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                        </select>
                        <button
                          disabled={!assignId || !can("catalog.manage") || busy}
                          onClick={() =>
                            action(async () => {
                              await api("assignments/" + brand.id, {
                                objectId: assignId,
                              });
                              await refreshAssignments(brand.id);
                            }, "Objek yang sudah ada ditautkan ke brand, tanpa membuat salinan.")
                          }
                        >
                          Tautkan ke brand
                        </button>
                      </div>
                      <details>
                        <summary>
                          Lihat koleksi {brandTab.toLowerCase()}
                        </summary>
                        {catalogs[
                          brandTab === "Preset" ? "preset" : "visual_identity"
                        ].map(card)}
                      </details>
                    </section>
                  </>
                ) : (
                  <section className="panel">
                    <div className="row">
                      <h2>Brand profile</h2>
                      {can("catalog.manage") && (
                        <button onClick={() => openEditor(null, "brand")}>
                          ＋ Brand baru
                        </button>
                      )}
                    </div>
                    {catalogs.brand.map((b) => (
                      <div className="target row" key={b.id}>
                        <div>
                          <h3>{b.name}</h3>
                          <small>
                            Klik untuk membuka Preset dan Visual Identity
                          </small>
                        </div>
                        <button onClick={() => action(() => chooseBrand(b))}>
                          Buka {b.name}
                        </button>
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
            {menu === "Setting" && (
              <>
                <Settings actor={actor} api={api} action={action} />
                {settingsEnabled && (
                  <section className="panel">
                    <h2>Akun publikasi per brand</h2>
                    <div className="grid">
                      <label>
                        Koneksi Repliz
                        <select
                          value={mapping.connectionId}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              connectionId: e.target.value,
                              available: [],
                              selected: [],
                            })
                          }
                        >
                          <option value="">Pilih koneksi</option>
                          {connections
                            .filter((c) => c.kind === "repliz")
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Brand
                        <select
                          value={mapping.brandId}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              brandId: e.target.value,
                              available: [],
                              selected: [],
                            })
                          }
                        >
                          <option value="">Pilih brand</option>
                          {catalogs.brand.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      disabled={
                        busy || !mapping.brandId || !mapping.connectionId
                      }
                      onClick={() =>
                        action(async () => {
                          const r = await api("accounts", {
                            brandId: mapping.brandId,
                            connectionId: mapping.connectionId,
                          });
                          setMapping({ ...mapping, available: r.available });
                        })
                      }
                    >
                      Ambil daftar akun Repliz
                    </button>
                    {mapping.available.map((a) => (
                      <label key={a.id}>
                        <input
                          type="checkbox"
                          checked={mapping.selected.includes(a.id)}
                          onChange={(e) =>
                            setMapping({
                              ...mapping,
                              selected: e.target.checked
                                ? [...mapping.selected, a.id]
                                : mapping.selected.filter((x) => x !== a.id),
                            })
                          }
                        />{" "}
                        {a.label} • {a.platform}
                      </label>
                    ))}
                    {mapping.available.length > 0 && (
                      <button
                        disabled={busy || !mapping.selected.length}
                        onClick={() =>
                          action(
                            () =>
                              api("accounts", {
                                connectionId: mapping.connectionId,
                                brandId: mapping.brandId,
                                accountIds: mapping.selected,
                              }),
                            "Akun pilihan ditautkan ke brand.",
                          )
                        }
                      >
                        Simpan akun pilihan
                      </button>
                    )}
                    {accounts.map((a) => (
                      <div className="target" key={a.id}>
                        {a.label} • {a.platform} • {names(a.brand_id)}
                      </div>
                    ))}
                  </section>
                )}
                <section className="panel">
                  <h2>Notifikasi Telegram saya</h2>
                  {settingsEnabled && actor.allBrands && (
                    <details>
                      <summary>Koneksi bot Telegram tenant</summary>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const r = await action(
                            () =>
                              api("connections", {
                                kind: "telegram",
                                label: connection.label,
                                config: {
                                  baseUrl: "https://api.telegram.org/",
                                },
                                secret: { botToken: connection.botToken },
                              }),
                            "Bot tersimpan. Penerima perlu verifikasi.",
                          );
                          if (r) setConnection({ label: "", botToken: "" });
                        }}
                      >
                        <label>
                          Nama bot
                          <input
                            required
                            value={connection.label}
                            onChange={(e) =>
                              setConnection({
                                ...connection,
                                label: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Bot token baru
                          <input
                            required
                            type="password"
                            autoComplete="new-password"
                            placeholder="YOUR_BOT_TOKEN_HERE"
                            value={connection.botToken}
                            onChange={(e) =>
                              setConnection({
                                ...connection,
                                botToken: e.target.value,
                              })
                            }
                          />
                        </label>
                        <button disabled={busy}>Simpan bot Telegram</button>
                      </form>
                    </details>
                  )}

                  <p>
                    Status:{" "}
                    {notifications.verified
                      ? "Terverifikasi"
                      : "Belum terverifikasi"}
                    . Error, pemulihan, dan batch siap direview dikirim ke
                    penerima yang terverifikasi dan berizin.
                  </p>
                  <div className="grid">
                    <label>
                      Bot tenant
                      <select
                        value={verification?.connectionId || ""}
                        onChange={(e) =>
                          setVerification({ connectionId: e.target.value })
                        }
                      >
                        <option value="">Pilih koneksi Telegram</option>
                        {telegramBots.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="actions">
                      <button
                        disabled={busy || !verification?.connectionId}
                        onClick={() =>
                          action(async () => {
                            const r = await api("telegram/start", {
                              connectionId: verification.connectionId,
                            });
                            setVerification({ ...verification, ...r });
                          })
                        }
                      >
                        Mulai verifikasi
                      </button>
                    </div>
                    <label>
                      Jam tenang mulai
                      <input
                        type="time"
                        value={quiet.quietStart}
                        onChange={(e) =>
                          setQuiet({ ...quiet, quietStart: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Jam tenang selesai
                      <input
                        type="time"
                        value={quiet.quietEnd}
                        onChange={(e) =>
                          setQuiet({ ...quiet, quietEnd: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  {verification?.message && (
                    <>
                      <p>{verification.instruction}</p>
                      <code>{verification.message}</code>
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            action(
                              () => api("telegram/finish", quiet),
                              "Telegram terverifikasi.",
                            )
                          }
                        >
                          Verifikasi pesan sudah dikirim
                        </button>
                      </div>
                    </>
                  )}
                </section>
                {can("tenant.users.manage") && (
                  <section className="panel">
                    <h2>Pengguna & izin</h2>
                    {users.map((u) => (
                      <div className="target" key={u.id}>
                        {u.username} • {u.role} • {u.status}
                        <small>
                          {u.all_brands
                            ? "Seluruh brand"
                            : u.brand_ids.map(names).join(", ")}
                        </small>
                      </div>
                    ))}
                    <details>
                      <summary>Tambah pengguna</summary>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const r = await action(
                            () => api("users", newUser),
                            "Pengguna dibuat.",
                          );
                          if (r)
                            setNewUser({
                              ...newUser,
                              username: "",
                              password: "",
                            });
                        }}
                      >
                        <div className="grid">
                          <label>
                            Username
                            <input
                              required
                              value={newUser.username}
                              onChange={(e) =>
                                setNewUser({
                                  ...newUser,
                                  username: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Password
                            <input
                              required
                              minLength="12"
                              type="password"
                              autoComplete="new-password"
                              value={newUser.password}
                              onChange={(e) =>
                                setNewUser({
                                  ...newUser,
                                  password: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Role
                            <select
                              value={newUser.role}
                              onChange={(e) =>
                                setNewUser({ ...newUser, role: e.target.value })
                              }
                            >
                              {[
                                "admin",
                                "operator",
                                "reviewer",
                                "publisher",
                                "viewer",
                              ].map((r) => (
                                <option key={r}>{r}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p>Izin tindakan</p>
                        <div className="grid">
                          {caps.map((c) => (
                            <label key={c}>
                              <input
                                type="checkbox"
                                checked={newUser.capabilities.includes(c)}
                                onChange={(e) =>
                                  setNewUser({
                                    ...newUser,
                                    capabilities: e.target.checked
                                      ? [...newUser.capabilities, c]
                                      : newUser.capabilities.filter(
                                          (v) => v !== c,
                                        ),
                                  })
                                }
                              />{" "}
                              {c}
                            </label>
                          ))}
                        </div>
                        <label>
                          <input
                            type="checkbox"
                            checked={newUser.allBrands}
                            onChange={(e) =>
                              setNewUser({
                                ...newUser,
                                allBrands: e.target.checked,
                              })
                            }
                          />{" "}
                          Seluruh brand
                        </label>
                        {!newUser.allBrands &&
                          catalogs.brand.map((b) => (
                            <label key={b.id}>
                              <input
                                type="checkbox"
                                checked={newUser.brandIds.includes(b.id)}
                                onChange={(e) =>
                                  setNewUser({
                                    ...newUser,
                                    brandIds: e.target.checked
                                      ? [...newUser.brandIds, b.id]
                                      : newUser.brandIds.filter(
                                          (v) => v !== b.id,
                                        ),
                                  })
                                }
                              />{" "}
                              {b.name}
                            </label>
                          ))}
                        <button disabled={busy}>Buat pengguna</button>
                      </form>
                    </details>
                  </section>
                )}
              </>
            )}
          </>
        )}
        <div className="footer">
          CF Studio V3 • Final approval selalu manual • Media yang belum
          ditemukan tidak dianggap siap.
        </div>
      </main>
      <dialog ref={targetDialog}>
        <form onSubmit={saveTarget}>
          <div className="row">
            <h2>{targetIndex === null ? "Tambah" : "Edit"} target</h2>
            <button type="button" onClick={() => targetDialog.current.close()}>
              Tutup
            </button>
          </div>
          <div className="grid">
            <label className="full">
              Nama target
              <input
                required
                value={target.name}
                onChange={(e) => setTarget({ ...target, name: e.target.value })}
              />
            </label>
            <label>
              Jalur produksi
              <select
                value={target.kind}
                onChange={(e) =>
                  setTarget({
                    ...target,
                    kind: e.target.value,
                    productId: "",
                    sourceId: "",
                  })
                }
              >
                {Object.entries(labels).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Jumlah
              <input
                required
                type="number"
                min="1"
                max="10"
                value={target.count}
                onChange={(e) =>
                  setTarget({ ...target, count: Number(e.target.value) })
                }
              />
            </label>
            <p className="full muted">{hints[target.kind]}</p>
            {target.kind === "product_campaign" && (
              <label className="full">
                Produk *
                <select
                  required
                  value={target.productId}
                  onChange={(e) =>
                    setTarget({ ...target, productId: e.target.value })
                  }
                >
                  <option value="">Pilih produk brand ini</option>
                  {catalogs.product
                    .filter(
                      (p) =>
                        p.brand_id === routine.brandId ||
                        p.linked_brand_ids?.includes(routine.brandId),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <small>
                  CEP / situasi kebutuhan diproduksi otomatis oleh Content
                  Planner.
                </small>
              </label>
            )}
            {target.kind === "multiplier" && (
              <label className="full">
                Sumber Deconstruct *
                <select
                  required
                  value={target.sourceId}
                  onChange={(e) =>
                    setTarget({ ...target, sourceId: e.target.value })
                  }
                >
                  <option value="">Pilih hasil deconstruct</option>
                  {catalogs.deconstruct
                    .filter((d) => d.payload.status === "deconstructed")
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label>
              Preset brand
              <select
                value={target.presetId}
                onChange={(e) =>
                  setTarget({ ...target, presetId: e.target.value })
                }
              >
                <option value="">Pilih preset yang sudah ditautkan</option>
                {assignments
                  .filter((a) => a.active && a.kind === "preset")
                  .map((a) => (
                    <option key={a.object_id} value={a.object_id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Visual identity
              <select
                value={target.identityId}
                onChange={(e) =>
                  setTarget({ ...target, identityId: e.target.value })
                }
              >
                <option value="">Tanpa tambahan</option>
                {assignments
                  .filter((a) => a.active && a.kind === "visual_identity")
                  .map((a) => (
                    <option key={a.object_id} value={a.object_id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="full">
              Arahan tambahan
              <textarea
                value={target.direction}
                onChange={(e) =>
                  setTarget({ ...target, direction: e.target.value })
                }
              />
            </label>
          </div>
          <button className="primary">Simpan target</button>
        </form>
      </dialog>
      <dialog ref={editorDialog}>
        <form onSubmit={saveEditor}>
          <div className="row">
            <h2>Detail {editor?.domain}</h2>
            <button type="button" onClick={() => editorDialog.current.close()}>
              Tutup
            </button>
          </div>
          <label>
            Nama
            <input
              required
              value={editor?.name || ""}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </label>
          {["product", "deconstruct"].includes(editor?.domain) && (
            <label>
              Brand
              <select
                value={editor?.brandId || ""}
                onChange={(e) =>
                  setEditor({ ...editor, brandId: e.target.value })
                }
              >
                <option value="">Koleksi tenant</option>
                {catalogs.brand.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted">
            Data hasil impor dipertahankan. Mengubah preset membuat versi baru;
            rutinitas aktif tetap memakai snapshot sebelumnya.
          </p>
          {editor?.domain === "product" && (
            <>
              <label>
                Deskripsi produk / sumber fakta
                <textarea
                  rows="4"
                  value={
                    editorData().raw_description ||
                    editorData().product_description ||
                    ""
                  }
                  onChange={(e) =>
                    setEditorField("raw_description", e.target.value)
                  }
                />
              </label>
              <div className="grid">
                <label>
                  Kategori
                  <input
                    value={editorData().category || ""}
                    onChange={(e) => setEditorField("category", e.target.value)}
                  />
                </label>
                <label>
                  Keunggulan produk
                  <input
                    value={
                      typeof editorData().unique_selling_point === "string"
                        ? editorData().unique_selling_point
                        : ""
                    }
                    onChange={(e) =>
                      setEditorField("unique_selling_point", e.target.value)
                    }
                  />
                </label>
              </div>
              <p>
                Foto: {editorData().photo_status || "belum tersedia"} •
                Ekstraksi: {editorData().extraction_status || "belum diproses"}
              </p>
            </>
          )}
          {editor?.domain === "brand" && (
            <>
              <label>
                Deskripsi brand
                <textarea
                  rows="4"
                  value={
                    editorData().description ||
                    editorData().brand_description ||
                    ""
                  }
                  onChange={(e) =>
                    setEditorField("description", e.target.value)
                  }
                />
              </label>
              <label>
                Karakter komunikasi
                <input
                  value={editorData().tone_of_voice || ""}
                  onChange={(e) =>
                    setEditorField("tone_of_voice", e.target.value)
                  }
                />
              </label>
            </>
          )}
          {editor?.domain === "visual_identity" && (
            <label>
              Arahan visual
              <textarea
                rows="4"
                value={editorData().description || ""}
                onChange={(e) => setEditorField("description", e.target.value)}
              />
            </label>
          )}
          {editor?.domain === "preset" && (
            <div className="grid">
              <label>
                Jumlah klip
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={editorPreset().visual_engine?.target_clips_count ?? 4}
                  onChange={(e) =>
                    setPresetField(
                      "visual_engine",
                      "target_clips_count",
                      Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                Rasio
                <select
                  value={editorPreset().visual_engine?.aspect_ratio || "9:16"}
                  onChange={(e) =>
                    setPresetField(
                      "visual_engine",
                      "aspect_ratio",
                      e.target.value,
                    )
                  }
                >
                  {["9:16", "16:9", "1:1"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Mode visual
                <select
                  value={
                    editorPreset().visual_engine?.visual_mode || "hybrid_lock"
                  }
                  onChange={(e) =>
                    setPresetField(
                      "visual_engine",
                      "visual_mode",
                      e.target.value,
                    )
                  }
                >
                  <option value="hybrid_lock">
                    Hybrid • start frame + video
                  </option>
                  <option value="pure_t2v">Pure T2V</option>
                </select>
              </label>
              <label>
                Provider VO
                <select
                  value={editorPreset().workflow?.voice_provider || "minimax"}
                  onChange={(e) =>
                    setPresetField("workflow", "voice_provider", e.target.value)
                  }
                >
                  <option value="minimax">MiniMax</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label>
                Persona / voice
                <input
                  value={editorPreset().workflow?.voice_persona || ""}
                  onChange={(e) =>
                    setPresetField("workflow", "voice_persona", e.target.value)
                  }
                />
              </label>
              <label>
                Kecepatan VO
                <input
                  type="number"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={editorPreset().workflow?.voice_speed ?? 1}
                  onChange={(e) =>
                    setPresetField(
                      "workflow",
                      "voice_speed",
                      Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                Volume VO
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  value={editorPreset().workflow?.voice_volume ?? 1}
                  onChange={(e) =>
                    setPresetField(
                      "workflow",
                      "voice_volume",
                      Number(e.target.value),
                    )
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={editorPreset().workflow?.enable_tts !== false}
                  onChange={(e) =>
                    setPresetField("workflow", "enable_tts", e.target.checked)
                  }
                />{" "}
                Gunakan TTS
              </label>
            </div>
          )}
          {editorReference &&
            (editorReference.mimeType?.startsWith("video/") ? (
              <video
                controls
                src={media({ ...editorReference, tenantId: actor?.tenantId })}
              />
            ) : (
              <img
                alt="Reference tersimpan"
                src={media({ ...editorReference, tenantId: actor?.tenantId })}
              />
            ))}
          {["product", "deconstruct", "visual_identity"].includes(
            editor?.domain,
          ) &&
            can("catalog.manage") && (
              <>
                <label>
                  {editor?.domain === "deconstruct"
                    ? "Video sumber MP4"
                    : "Foto / reference gambar"}
                  <input
                    type="file"
                    disabled={busy || editorDirty}
                    accept={
                      editor?.domain === "deconstruct"
                        ? "video/mp4"
                        : "image/png,image/jpeg,image/webp"
                    }
                    onChange={(e) => uploadSource(e.target.files?.[0])}
                  />
                </label>
                <small>
                  Simpan perubahan form terlebih dahulu. File maksimal 20 MB.
                </small>
                <div className="actions">
                  {editor?.domain === "product" && (
                    <button
                      type="button"
                      disabled={
                        busy ||
                        editorDirty ||
                        !editorData().photoArtifactId ||
                        editorData().photo_status === "approved"
                      }
                      onClick={() => catalogAction("approve-photo")}
                    >
                      Setujui foto produk
                    </button>
                  )}
                  {["product", "deconstruct"].includes(editor?.domain) &&
                    can("production.run") && (
                      <button
                        type="button"
                        disabled={busy || editorDirty}
                        onClick={() => catalogAction("analyze")}
                      >
                        {editor.domain === "deconstruct"
                          ? "Analisis video sumber"
                          : "Analisis deskripsi produk"}
                      </button>
                    )}
                </div>
              </>
            )}
          {editor?.domain === "deconstruct" &&
            editorData().original_storyboard_json && (
              <details>
                <summary>Storyboard hasil analisis</summary>
                <pre>
                  {JSON.stringify(
                    editorData().original_storyboard_json,
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
          {catalogJobs
            .filter((j) => j.object_id === editor?.id)
            .map((j) => (
              <p key={j.id}>
                <span className="badge">{states[j.status] || j.status}</span>{" "}
                Analisis r{j.revision} {j.error_code && "• " + j.error_code}
              </p>
            ))}
          <details>
            <summary>Pengaturan lanjutan / data lengkap</summary>
            <label>
              Konfigurasi
              <textarea
                rows="12"
                spellCheck="false"
                value={editor?.payload || ""}
                onChange={(e) =>
                  setEditor({ ...editor, payload: e.target.value })
                }
                readOnly={!can("catalog.manage")}
              />
            </label>
          </details>
          {can("catalog.manage") && (
            <button disabled={busy} className="primary">
              Simpan perubahan
            </button>
          )}
        </form>
      </dialog>
      <dialog ref={reviewDialog}>
        <div className="row">
          <h2>
            {selectedItem?.intent
              ? "Rekonsiliasi Repliz"
              : "Review konten • r" + (selectedItem?.revision || "")}
          </h2>
          <button onClick={() => reviewDialog.current.close()}>Tutup</button>
        </div>
        {selectedItem?.intent ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const id = new FormData(e.currentTarget).get("providerId");
              const r = await action(
                () =>
                  api("publishing/" + selectedItem.intent.id + "/reconcile", {
                    providerId: id,
                  }),
                "Hasil provider cocok dan status diperbarui.",
              );
              if (r) reviewDialog.current.close();
            }}
          >
            <p>
              Masukkan ID jadwal yang ditemukan pada dashboard Repliz. Aplikasi
              akan mencocokkan akun, waktu, media, dan caption.
            </p>
            <label>
              ID jadwal provider
              <input required name="providerId" />
            </label>
            <button disabled={busy}>Periksa provider</button>
          </form>
        ) : (
          selectedItem && (
            <>
              <p>
                {names(selectedItem.brand_id)} •{" "}
                {labels[selectedItem.source_kind]} •{" "}
                {states[selectedItem.status] || selectedItem.status}
              </p>
              {selectedItem.error_code && (
                <p className="error">{selectedItem.error_code}</p>
              )}
              {selectedItem.artifacts?.final?.id &&
                (selectedItem.artifacts.final.mime_type.startsWith("video/") ? (
                  <video controls src={media(selectedItem.artifacts.final)} />
                ) : (
                  <img
                    alt="Media final"
                    src={media(selectedItem.artifacts.final)}
                  />
                ))}
              <details
                open={selectedItem.status === "awaiting_creative_approval"}
              >
                <summary>Storyboard & narasi</summary>
                {selectedItem.production_package?.scenes.map((s) => (
                  <div className="target" key={s.id}>
                    <h3>
                      {s.id} • {s.mode}
                    </h3>
                    {selectedItem.creative_frames?.[s.id] && (
                      <img
                        alt="Start frame"
                        src={media(selectedItem.creative_frames[s.id])}
                      />
                    )}
                    <p>{s.narration || s.imagePrompt}</p>
                    <small>{s.videoPrompt}</small>
                  </div>
                ))}
              </details>
              <label>
                Caption
                <textarea
                  rows="6"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </label>
              <div className="actions">
                {can("content.edit") &&
                  ["ready", "failed", "awaiting_creative_approval"].includes(
                    selectedItem.status,
                  ) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        reviewAction(
                          "archive",
                          { revision: selectedItem.revision },
                          "Konten diarsipkan dan tidak dapat dijadwalkan.",
                        )
                      }
                    >
                      Arsipkan konten
                    </button>
                  )}
                {can("content.edit") && (
                  <button
                    disabled={
                      busy ||
                      caption === selectedItem.caption ||
                      selectedItem.status !== "ready"
                    }
                    onClick={() =>
                      reviewAction(
                        "edit",
                        { expectedRevision: selectedItem.revision, caption },
                        "Caption diperbarui. Setujui kembali revisi baru.",
                      )
                    }
                  >
                    Simpan revisi caption
                  </button>
                )}
                {can("content.approve") && selectedItem.status === "ready" && (
                  <button
                    disabled={
                      busy ||
                      caption !== selectedItem.caption ||
                      selectedItem.approved
                    }
                    onClick={() =>
                      reviewAction(
                        "approve",
                        { revision: selectedItem.revision },
                        "Versi final disetujui.",
                      )
                    }
                  >
                    Setujui final r{selectedItem.revision}
                  </button>
                )}
                {can("content.approve") &&
                  selectedItem.status === "awaiting_creative_approval" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        reviewAction(
                          "approve-creative",
                          { revision: selectedItem.revision },
                          "Materi kreatif disetujui; render dilanjutkan.",
                        )
                      }
                    >
                      Setujui kreatif & lanjut render
                    </button>
                  )}
                {can("production.run") &&
                  ["ready", "failed", "awaiting_creative_approval"].includes(
                    selectedItem.status,
                  ) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        reviewAction(
                          "regenerate",
                          { expectedRevision: selectedItem.revision },
                          "Revisi baru masuk antrean produksi. Persetujuan final sebelumnya tidak berlaku.",
                        )
                      }
                    >
                      Buat ulang sebagai revisi baru
                    </button>
                  )}
                {can("production.run") && selectedItem.status === "failed" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      reviewAction(
                        "retry",
                        { expectedRevision: selectedItem.revision },
                        "Permintaan retry masuk antrean. Job dengan hasil belum pasti tetap memerlukan pemeriksaan.",
                      )
                    }
                  >
                    Coba lanjutkan tahap
                  </button>
                )}
              </div>
              {selectedItem.approved && can("publishing.schedule") && (
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    reviewAction(
                      "schedule",
                      {
                        revision: selectedItem.revision,
                        accountId: schedule.accountId,
                        scheduledAt: new Date(
                          schedule.scheduledAt,
                        ).toISOString(),
                      },
                      "Jadwal masuk antrean publikasi.",
                    );
                  }}
                >
                  <h3>Jadwalkan ke Repliz</h3>
                  <label>
                    Akun
                    <select
                      required
                      value={schedule.accountId}
                      onChange={(e) =>
                        setSchedule({ ...schedule, accountId: e.target.value })
                      }
                    >
                      <option value="">Pilih akun brand ini</option>
                      {accounts
                        .filter(
                          (a) =>
                            a.brand_id === selectedItem.brand_id && a.connected,
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label} • {a.platform}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Waktu publikasi
                    <input
                      required
                      type="datetime-local"
                      value={schedule.scheduledAt}
                      onChange={(e) =>
                        setSchedule({
                          ...schedule,
                          scheduledAt: e.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={busy || caption !== selectedItem.caption}
                  >
                    Jadwalkan versi disetujui
                  </button>
                </form>
              )}
            </>
          )
        )}
      </dialog>
    </div>
  );
}
