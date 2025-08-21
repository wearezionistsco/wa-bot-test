// index.js — FINAL FULL
// Fitur: QR link (api.qrserver), tombol menu, session JSON, logging, timeout,
// auto-reject call (kecuali admin/whitelist), admin command `close`, pengecualian admin.

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");

const app = express();
const PORT = process.env.PORT || 8080;

// ================== CONFIG ==================
const ADMIN_NUMBER = "6281256513331@c.us"; // ganti ke nomor admin (format: 62...@c.us)
const WHITELIST_NUMBERS = [ADMIN_NUMBER]; // nomor yang TIDAK dibalas otomatis

const SESSION_FILE = path.join(__dirname, "sessions.json");
const LOG_FILE = path.join(__dirname, "logs.txt");

// Timeout (ms)
const CALL_TIMEOUT_MS = 5 * 60 * 1000;     // 5 menit untuk izin panggilan
const ORDER_TIMEOUT_MS = 60 * 60 * 1000;   // 1 jam untuk pesanan/pending admin

// ================== STATE & UTIL ==================
let sessions = {};
if (fs.existsSync(SESSION_FILE)) {
  try { sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); }
  catch { sessions = {}; }
}

function saveSessions() {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2)); }
  catch (e) { console.error("Gagal simpan sessions.json:", e.message); }
}

function logLine(text) {
  const line = `[${new Date().toISOString()}] ${text}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(text);
}

function resetUserSession(jid) {
  delete sessions[jid];
  saveSessions();
}

function now() { return Date.now(); }

// ================== EXPRESS (info sederhana) ==================
app.get("/", (_req, res) => {
  res.send('✅ WhatsApp Bot aktif. Gunakan tombol di WhatsApp. (Health OK)');
});

app.listen(PORT, () => {
  console.log(`🌐 Server berjalan di port ${PORT}`);
});

// ================== WHATSAPP CLIENT ==================
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: "bot-session" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  }
});

// === QR (pakai link api.qrserver.com, tidak simpan PNG) ===
let qrShownOnce = false;
client.on("qr", (qr) => {
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  if (!qrShownOnce) {
    console.log(`🔑 QR Code dibuat, link: ${qrLink}`);
    qrShownOnce = true;
  } else {
    console.log(`🔑 QR diperbarui (scan ulang jika perlu): ${qrLink}`);
  }
});

// === Ready ===
client.on("ready", () => {
  console.log("✅ Bot WhatsApp aktif!");
  qrShownOnce = false; // jika nanti logout, event qr akan tampil lagi
});

// === Call handling (auto-reject kecuali whitelist) ===
client.on("call", async (call) => {
  const from = call.from; // format 62...@c.us
  if (!WHITELIST_NUMBERS.includes(from)) {
    await call.reject();
    client.sendMessage(from, "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat dengan tombol menu.");
    logLine(`Call rejected from ${from}`);
  } else {
    logLine(`Call allowed from whitelist: ${from}`);
  }
});

// ================== MENU BUILDERS (WA Buttons) ==================
function btnMainMenu() {
  return new Buttons(
    "Mohon pilih menu berikut 👇",
    [{ body: "TOP UP" }, { body: "PESAN PRIBADI" }, { body: "IZIN CALLING" }],
    "📌 MENU UTAMA"
  );
}

function btnTopupNominal() {
  return new Buttons(
    "Silakan pilih nominal Top Up 👇",
    [{ body: "150K" }, { body: "200K" }, { body: "300K" }, { body: "500K" }, { body: "1/2" }, { body: "1" }, { body: "KEMBALI" }],
    "💰 TOP UP"
  );
}

function btnTopupKonfirmasi(nominal) {
  return new Buttons(
    `Anda memilih *${nominal}*.\nPilih metode:`,
    [{ body: "BAYAR" }, { body: "BON" }, { body: "KEMBALI" }],
    "Konfirmasi Top Up"
  );
}

function btnPesanPribadi() {
  return new Buttons(
    "Silakan pilih jenis pesan pribadi 👇",
    [{ body: "BON" }, { body: "GADAI" }, { body: "GADAI HP" }, { body: "TEBUS GADAI" }, { body: "LAIN-LAIN" }, { body: "KEMBALI" }],
    "✉ PESAN PRIBADI"
  );
}

// ================== HELPERS ==================
async function showMainMenu(to) {
  return client.sendMessage(to, btnMainMenu());
}
async function showTopupMenu(to) {
  return client.sendMessage(to, btnTopupNominal());
}
async function confirmTopup(to, nominal) {
  return client.sendMessage(to, btnTopupKonfirmasi(nominal));
}
async function showPesanPribadiMenu(to) {
  return client.sendMessage(to, btnPesanPribadi());
}
async function invalidChoice(to) {
  return client.sendMessage(to, "❌ Pilihan tidak valid. Silakan gunakan *tombol* yang tersedia.");
}

// ================== ADMIN COMMANDS ==================
// Di chat admin, ketik:
// - close             → tutup semua session
// - close <62xxx@c.us>→ tutup session user tertentu
async function handleAdminCommand(from, text) {
  if (from !== ADMIN_NUMBER) return false;
  const parts = text.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== "close") return false;

  if (parts.length === 1) {
    sessions = {};
    saveSessions();
    await client.sendMessage(ADMIN_NUMBER, "✅ Semua sesi ditutup.");
  } else {
    const jid = parts[1];
    if (sessions[jid]) {
      delete sessions[jid];
      saveSessions();
      await client.sendMessage(ADMIN_NUMBER, `✅ Sesi ${jid} ditutup.`);
    } else {
      await client.sendMessage(ADMIN_NUMBER, `ℹ️ Sesi ${jid} tidak ditemukan.`);
    }
  }
  return true;
}

// ================== MESSAGE HANDLER ==================
client.on("message", async (msg) => {
  const from = msg.from;                 // 62...@c.us
  const text = (msg.body || "").trim();  // hanya tombol yang diterima
  logLine(`${from}: ${text}`);

  // 1) Admin commands
  if (await handleAdminCommand(from, text)) return;

  // 2) Skip auto-reply untuk whitelist (admin)
  if (WHITELIST_NUMBERS.includes(from)) return;

  // 3) Init session jika baru
  if (!sessions[from]) {
    sessions[from] = { step: "menu", ts: now() };
    saveSessions();
    return showMainMenu(from);
  }

  const S = sessions[from];
  S.ts = now(); // update last activity

  // 4) Timeout rules (check di sini untuk hard reset)
  //    - Izin call: 5 menit
  if (S.step === "izin_call" && (now() - S.ts) > CALL_TIMEOUT_MS) {
    resetUserSession(from);
    await client.sendMessage(from, "⌛ Waktu permintaan panggilan habis. Kembali ke menu utama.");
    return showMainMenu(from);
  }
  //    - Pending admin (pesanan/topup): 1 jam
  if (S.step === "pending_admin" && (now() - S.ts) > ORDER_TIMEOUT_MS) {
    resetUserSession(from);
    await client.sendMessage(from, "⌛ Sesi ditutup otomatis karena tidak ada respon. Kembali ke menu utama.");
    return showMainMenu(from);
  }

  // 5) HANYA tombol diterima — validasi ketat
  const allowedButtons = [
    "TOP UP","PESAN PRIBADI","IZIN CALLING",
    "150K","200K","300K","500K","1/2","1",
    "BAYAR","BON","KEMBALI",
    "GADAI","GADAI HP","TEBUS GADAI","LAIN-LAIN"
  ];
  if (!allowedButtons.includes(text)) {
    return invalidChoice(from);
  }

  // 6) FSM (finite-state machine) untuk menu
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
        S.callStart = now();
        saveSessions();
        return client.sendMessage(from, "📞 Permintaan izin panggilan dicatat. Mohon tunggu admin.");
      }
      return invalidChoice(from);
    }

    case "topup_nominal": {
      if (text === "KEMBALI") {
        S.step = "menu";
        saveSessions();
        return showMainMenu(from);
      }
      // pilih nominal
      S.nominal = text; // simpan 150K/200K/...
      S.step = "topup_konfirmasi";
      saveSessions();
      return confirmTopup(from, text);
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
        saveSessions();
        return client.sendMessage(
          from,
          `✅ Permintaan Top Up *${S.nominal}* (metode *BAYAR*) dicatat.\nMohon tunggu admin memproses.`
        );
      }
      if (text === "BON") {
        S.step = "pending_admin";
        S.method = "BON";
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
        saveSessions();
        return showMainMenu(from);
      }
      // jenis pesan pribadi dipilih
      S.step = "pending_admin";
      S.personal = text; // BON / GADAI / GADAI HP / TEBUS GADAI / LAIN-LAIN
      saveSessions();
      return client.sendMessage(from, `✅ Permintaan *${text}* sudah dicatat.\nMohon tunggu admin membalas.`);
    }

    case "izin_call": {
      // tombol apapun di state ini -> kembali ke menu (tetap pending izin di sisi admin)
      S.step = "menu";
      saveSessions();
      return showMainMenu(from);
    }

    case "pending_admin": {
      // User kirim tombol apapun saat pending → tetap tahan, jangan close
      return client.sendMessage(from, "🕒 Mohon tunggu, admin akan segera membalas pesan Anda.");
    }

    default:
      // fallback: reset ke menu
      S.step = "menu";
      saveSessions();
      return showMainMenu(from);
  }
});

// ================== BACKGROUND TIMEOUT SWEEPER ==================
// Menjaga sesi tidak menggantung terlalu lama.
setInterval(() => {
  const t = now();
  let dirty = false;
  for (const jid of Object.keys(sessions)) {
    const s = sessions[jid];
    if (!s || !s.step || !s.ts) continue;
    const age = t - s.ts;
    if (s.step === "izin_call" && age > CALL_TIMEOUT_MS) {
      delete sessions[jid];
      dirty = true;
      client.sendMessage(jid, "⌛ Waktu permintaan panggilan habis. Kembali ke menu utama.");
      showMainMenu(jid);
    } else if (s.step === "pending_admin" && age > ORDER_TIMEOUT_MS) {
      delete sessions[jid];
      dirty = true;
      client.sendMessage(jid, "⌛ Sesi ditutup otomatis karena tidak ada respon. Kembali ke menu utama.");
      showMainMenu(jid);
    }
  }
  if (dirty) saveSessions();
}, 60 * 1000); // cek tiap menit

// ================== START ==================
client.initialize();
