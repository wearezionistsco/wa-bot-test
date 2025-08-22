// index.js — FINAL SUPER LENGKAP
// Fitur: QR link (api.qrserver), tombol menu, session JSON, timeout,
// auto-reject call, admin command `close`, whitelist admin/keluarga, anti-spam,
// logging, health endpoint, hanya-TERIMA-tombol (input manual ditolak sopan).

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");

const app = express();
const PORT = process.env.PORT || 8080;

// ============== KONFIG GLOBAL ==============
const ADMIN_NUMBERS = [
  "6281256513331@c.us" // <<< GANTI nomor admin (format 62...@c.us)
];
const WHITELIST_NUMBERS = [
  // nomor yang TIDAK diproses bot (keluarga/admin khusus)
  ...ADMIN_NUMBERS,
  // "62yyyyyyyyyy@c.us",
];

const CALL_TIMEOUT_MS = 5 * 60 * 1000;    // 5 menit untuk Izin Calling
const ORDER_TIMEOUT_MS = 60 * 60 * 1000;  // 1 jam untuk pesanan/pending

// ============== FILE STATE & LOG ============
const SESSION_FILE = path.join(__dirname, "sessions.json");
const LOG_FILE = path.join(__dirname, "logs.txt");

// muat sesi awal
let sessions = {};
if (fs.existsSync(SESSION_FILE)) {
  try {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
  } catch (e) {
    console.error("❌ Gagal load sessions.json:", e.message);
    sessions = {};
  }
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
  } catch (e) {
    console.error("❌ Gagal simpan sessions.json:", e.message);
  }
}

function logLine(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(text);
}

function now() { return Date.now(); }

function resetUserSession(jid) {
  delete sessions[jid];
  saveSessions();
}

// ============== EXPRESS (health & QR) ==============
let latestQR = null;

app.get("/", (_req, res) => {
  res.type("text").send("✅ WhatsApp Bot aktif. Health OK. Lihat QR di /qr");
});

app.get("/qr", (_req, res) => {
  if (!latestQR) return res.status(404).send("❌ QR belum tersedia. Tunggu sebentar.");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
  res.setHeader("Cache-Control", "no-store");
  res.send(`
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <h2>Scan QR WhatsApp</h2>
    <p>Refresh halaman jika QR kadaluwarsa.</p>
    <img alt="QR" src="${qrUrl}" />
    <p><a href="${qrUrl}" target="_blank" rel="noopener">Buka langsung gambar</a></p>
  `);
});

app.listen(PORT, () => logLine(`🌐 Server berjalan di port ${PORT}`));

// ============== WHATSAPP CLIENT ==============
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: "bot-session" }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu"
    ]
  }
});

// QR via api.qrserver link (tidak simpan PNG)
client.on("qr", (qr) => {
  latestQR = qr;
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  logLine(`🔑 QR siap: ${qrLink}`);
});

client.on("ready", () => {
  logLine("✅ Bot WhatsApp aktif!");
  latestQR = null; // setelah ready, QR tidak diperlukan
});

// ============== UI BUTTONS (Builders) ==============
function btnMainMenu() {
  return new Buttons(
    "Mohon pilih layanan di bawah ini:",
    [{ body: "TOP UP" }, { body: "PESAN PRIBADI" }, { body: "IZIN CALLING" }],
    "📌 MENU UTAMA",
    "Gunakan tombol, tidak menerima ketikan."
  );
}

function btnTopupNominal() {
  return new Buttons(
    "Pilih nominal Top Up:",
    [{ body: "150K" }, { body: "200K" }, { body: "300K" }, { body: "500K" }, { body: "1/2" }, { body: "1" }],
    "💰 TOP UP",
    "Tekan salah satu nominal."
  );
}

function btnTopupKonfirmasi(nominal) {
  return new Buttons(
    `Anda memilih *${nominal}*.\nApakah Anda yakin atau ingin mengubah?`,
    [{ body: "BAYAR" }, { body: "BON" }, { body: "KEMBALI" }],
    "Konfirmasi Top Up",
    "Tekan salah satu tombol."
  );
}

function btnPesanPribadi() {
  return new Buttons(
    "Pilih jenis layanan:",
    [{ body: "BON" }, { body: "GADAI" }, { body: "GADAI HP" }, { body: "TEBUS GADAI" }, { body: "LAIN-LAIN" }],
    "✉ PESAN PRIBADI",
    "Tekan salah satu tombol."
  );
}

// ============== HELPERS (pengiriman menu & validasi) ==============
async function showMainMenu(to, prefix) {
  return client.sendMessage(to, (prefix ? `${prefix}\n` : "") , { linkPreview: false })
    .then(() => client.sendMessage(to, btnMainMenu()));
}

async function showTopupMenu(to, prefix) {
  return client.sendMessage(to, (prefix ? `${prefix}\n` : ""), { linkPreview: false })
    .then(() => client.sendMessage(to, btnTopupNominal()));
}

async function confirmTopup(to, nominal) {
  return client.sendMessage(to, btnTopupKonfirmasi(nominal));
}

async function showPesanPribadiMenu(to, prefix) {
  return client.sendMessage(to, (prefix ? `${prefix}\n` : ""), { linkPreview: false })
    .then(() => client.sendMessage(to, btnPesanPribadi()));
}

async function invalidChoice(to) {
  return client.sendMessage(to, "❌ Pilihan tidak valid. Silakan gunakan *tombol* yang tersedia.");
}

// ============== ADMIN COMMANDS ==============
// - close                    → tutup SEMUA sesi
// - close 62xxx@c.us         → tutup sesi user tertentu
async function handleAdminCommand(from, text) {
  if (!ADMIN_NUMBERS.includes(from)) return false;
  const parts = text.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "close") return false;

  if (parts.length === 1) {
    sessions = {};
    saveSessions();
    await client.sendMessage(from, "✅ Semua sesi ditutup.");
  } else {
    const jid = parts[1];
    if (sessions[jid]) {
      delete sessions[jid];
      saveSessions();
      await client.sendMessage(from, `✅ Sesi ${jid} ditutup.`);
    } else {
      await client.sendMessage(from, `ℹ️ Sesi ${jid} tidak ditemukan.`);
    }
  }
  return true;
}

// ============== CALL HANDLER (auto-reject) ==============
client.on("call", async (call) => {
  const from = call.from;
  if (!WHITELIST_NUMBERS.includes(from)) {
    await call.reject();
    await client.sendMessage(from, "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat dengan tombol menu.");
    logLine(`📵 Panggilan ditolak dari: ${from}`);
  } else {
    logLine(`📞 Panggilan diizinkan dari whitelist: ${from}`);
  }
});

// ============== MESSAGE HANDLER (FSM) ==============
client.on("message", async (msg) => {
  const from = msg.from;
  const text = (msg.body || "").trim();

  // Log masuk
  logLine(`${from}: ${text}`);

  // Abaikan pesan dari grup (ID grup mengandung '-' di JID)
  if (from.includes("-")) return;

  // Admin command
  if (await handleAdminCommand(from, text)) return;

  // Skip auto-reply untuk whitelist
  if (WHITELIST_NUMBERS.includes(from)) return;

  // Hanya terima pesan dari tombol (anti ketikan bebas)
  const allowedButtons = new Set([
    "TOP UP","PESAN PRIBADI","IZIN CALLING",
    "150K","200K","300K","500K","1/2","1",
    "BAYAR","BON","KEMBALI",
    "GADAI","GADAI HP","TEBUS GADAI","LAIN-LAIN"
  ]);
  const isButtonLike = allowedButtons.has(text);

  // Buat sesi baru → langsung tampilkan menu utama (butuh trigger satu pesan)
  if (!sessions[from]) {
    sessions[from] = { step: "menu", ts: now() };
    saveSessions();
    return showMainMenu(from);
  }

  // Update timestamp activity
  const S = sessions[from];
  S.ts = now();
  saveSessions();

  // TIMEOUT logic (hard check per event)
  // izin_call → 5 menit
  if (S.step === "izin_call" && S.expiresAt && now() > S.expiresAt) {
    resetUserSession(from);
    await client.sendMessage(from, "⌛ Waktu permintaan panggilan habis. Kembali ke menu utama.");
    return showMainMenu(from);
  }
  // pending admin → 1 jam
  if (S.step === "pending_admin" && S.expiresAt && now() > S.expiresAt) {
    resetUserSession(from);
    await client.sendMessage(from, "⌛ Sesi ditutup otomatis karena belum ada respon. Kembali ke menu utama.");
    return showMainMenu(from);
  }

  // Jika user mengetik manual (bukan tombol) → tolak sopan
  if (!isButtonLike) return invalidChoice(from);

  // FSM
  switch (S.step) {
    case "menu": {
      if (text === "TOP UP") {
        S.step = "topup_nominal";
        saveSessions();
        return showTopupMenu(from);
      }
      if (text === "PESAN PRIBADI") {
        S.step = "pesan_menu";
        saveSessions();
        return showPesanPribadiMenu(from);
      }
      if (text === "IZIN CALLING") {
        S.step = "izin_call";
        S.expiresAt = now() + CALL_TIMEOUT_MS;
        saveSessions();
        return client.sendMessage(from, "📞 Permintaan izin panggilan dicatat. Mohon tunggu admin (maks 5 menit).");
      }
      return invalidChoice(from);
    }

    case "topup_nominal": {
      if (text === "KEMBALI") {
        S.step = "menu";
        delete S.nominal;
        saveSessions();
        return showMainMenu(from);
      }
      // pilih nominal
      S.nominal = text; // 150K / 200K / ...
      S.step = "topup_konfirmasi";
      saveSessions();
      return confirmTopup(from, S.nominal);
    }

    case "topup_konfirmasi": {
      if (text === "KEMBALI") {
        S.step = "topup_nominal";
        saveSessions();
        return showTopupMenu(from);
      }
      if (text === "BAYAR") {
        S.step = "pending_admin";
        S.method = "BAYAR";
        S.expiresAt = now() + ORDER_TIMEOUT_MS;
        saveSessions();
        return client.sendMessage(
          from,
          `✅ Permintaan Top Up *${S.nominal}* (metode *BAYAR*) dicatat. Mohon tunggu admin memproses.`
        );
      }
      if (text === "BON") {
        S.step = "pending_admin";
        S.method = "BON";
        S.expiresAt = now() + ORDER_TIMEOUT_MS;
        saveSessions();
        return client.sendMessage(
          from,
          `⌛ Permintaan Top Up *${S.nominal}* (metode *BON*) menunggu persetujuan admin.`
        );
      }
      return invalidChoice(from);
    }

    case "pesan_menu": {
      if (text === "KEMBALI") {
        S.step = "menu";
        delete S.personal;
        saveSessions();
        return showMainMenu(from);
      }
      // set jenis pesan
      if (["BON","GADAI","GADAI HP","TEBUS GADAI","LAIN-LAIN"].includes(text)) {
        S.personal = text;
        S.step = "pending_admin";
        S.expiresAt = now() + ORDER_TIMEOUT_MS;
        saveSessions();
        return client.sendMessage(from, `✅ Permintaan *${text}* dicatat. Mohon tunggu admin membalas.`);
      }
      return invalidChoice(from);
    }

    case "izin_call": {
      // Tekanan tombol apapun setelah minta izin → kembali ke menu (permintaan tetap dicatat di sisi admin manual)
      S.step = "menu";
      delete S.expiresAt;
      saveSessions();
      return showMainMenu(from);
    }

    case "pending_admin": {
      // Saat pending, user menekan tombol apapun → tetap tahan, jangan close
      return client.sendMessage(from, "🕒 Mohon tunggu, admin akan segera membalas. (Sesi otomatis berakhir jika tanpa respon 1 jam)");
    }

    default:
      S.step = "menu";
      saveSessions();
      return showMainMenu(from);
  }
});

// ============== BACKGROUND TIMEOUT SWEEPER ==============
// memastikan sesi tidak menggantung terlalu lama
setInterval(() => {
  const t = now();
  const keys = Object.keys(sessions);
  let changed = false;
  for (const jid of keys) {
    const s = sessions[jid];
    if (!s) continue;
    if (s.step === "izin_call" && s.expiresAt && t > s.expiresAt) {
      delete sessions[jid];
      changed = true;
      client.sendMessage(jid, "⌛ Waktu permintaan panggilan habis. Kembali ke menu utama.");
      showMainMenu(jid);
    } else if (s.step === "pending_admin" && s.expiresAt && t > s.expiresAt) {
      delete sessions[jid];
      changed = true;
      client.sendMessage(jid, "⌛ Sesi ditutup otomatis karena belum ada respon. Kembali ke menu utama.");
      showMainMenu(jid);
    }
  }
  if (changed) saveSessions();
}, 60 * 1000);

// ============== START ==============
client.initialize();
