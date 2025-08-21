const fs = require("fs");
const express = require("express");
const qrcode = require("qrcode");
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CONFIG ====================
const ADMIN_NUMBER = "6281256513331@c.us"; // ganti nomor admin
const WHITELIST_NUMBERS = [ADMIN_NUMBER]; // nomor yang dikecualikan dari auto-reply
const SESSION_FILE = "sessions.json";
const LOG_FILE = "logs.txt";

// Timeout (ms)
const MENU_TIMEOUT = 5 * 60 * 1000; // 5 menit untuk izin call
const ORDER_TIMEOUT = 60 * 60 * 1000; // 1 jam untuk order

// ==================== SESSION HANDLER ====================
let sessions = {};
if (fs.existsSync(SESSION_FILE)) {
  try {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE));
  } catch (e) {
    sessions = {};
  }
}

function saveSessions() {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

function logMessage(msg) {
  const log = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, log);
}

// Reset session
function resetSession(userId) {
  delete sessions[userId];
  saveSessions();
}

// ==================== WA CLIENT ====================
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "bot-session" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
  },
});

client.on("qr", async (qr) => {
  console.log("QR diterima, disimpan sebagai qr.png");
  await qrcode.toFile("qr.png", qr);
});

client.on("ready", () => {
  console.log("✅ WhatsApp Bot siap!");
});

client.on("message", async (msg) => {
  const from = msg.from;
  const body = msg.body;

  // Abaikan pesan dari whitelist
  if (WHITELIST_NUMBERS.includes(from)) {
    return;
  }

  logMessage(`${from}: ${body}`);

  // Cek session user
  if (!sessions[from]) {
    // Buat session baru
    sessions[from] = {
      state: "MENU",
      lastActive: Date.now(),
    };
    saveSessions();
    return showMainMenu(from);
  }

  const session = sessions[from];
  session.lastActive = Date.now();

  // Jika user sedang di menu
  if (session.state === "MENU") {
    if (body === "TOP UP") {
      session.state = "TOPUP";
      saveSessions();
      return showTopupMenu(from);
    } else if (body === "PESAN PRIBADI") {
      session.state = "PERSONAL";
      saveSessions();
      return showPersonalMenu(from);
    } else if (body === "IZIN CALLING") {
      session.state = "CALL";
      saveSessions();
      return requestCallPermission(from);
    } else {
      return invalidChoice(from);
    }
  }

  // Jika user pilih TOP UP
  if (session.state === "TOPUP") {
    if (["150K","200K","300K","500K","1/2","1"].includes(body)) {
      session.topupAmount = body;
      session.state = "TOPUP_CONFIRM";
      saveSessions();
      return confirmTopup(from, body);
    } else if (body === "KEMBALI") {
      session.state = "MENU";
      saveSessions();
      return showMainMenu(from);
    } else {
      return invalidChoice(from);
    }
  }

  if (session.state === "TOPUP_CONFIRM") {
    if (body === "BAYAR") {
      session.state = "WAIT_ADMIN";
      saveSessions();
      return client.sendMessage(from, "✅ Pesanan BAYAR sedang diproses admin...");
    } else if (body === "BON") {
      session.state = "WAIT_ADMIN";
      saveSessions();
      return client.sendMessage(from, "⌛ BON sedang menunggu persetujuan admin...");
    } else if (body === "KEMBALI") {
      session.state = "TOPUP";
      saveSessions();
      return showTopupMenu(from);
    } else {
      return invalidChoice(from);
    }
  }

  if (session.state === "PERSONAL") {
    if (["BON","GADAI","GADAI HP","TEBUS GADAI","LAIN-LAIN"].includes(body)) {
      session.state = "WAIT_ADMIN";
      saveSessions();
      return client.sendMessage(from, `⌛ Permintaan *${body}* sedang menunggu admin...`);
    } else if (body === "KEMBALI") {
      session.state = "MENU";
      saveSessions();
      return showMainMenu(from);
    } else {
      return invalidChoice(from);
    }
  }

  if (session.state === "CALL") {
    session.state = "MENU";
    saveSessions();
    return client.sendMessage(from, "❌ Panggilan hanya melalui izin admin. Kembali ke menu utama.");
  }

  if (session.state === "WAIT_ADMIN") {
    return client.sendMessage(from, "⌛ Mohon tunggu, admin akan segera membalas pesan Anda.");
  }
});

client.on("call", async (call) => {
  const from = call.from;
  if (!WHITELIST_NUMBERS.includes(from)) {
    call.reject();
    await client.sendMessage(from, "❌ Maaf, panggilan ditolak. Silakan gunakan chat.");
  }
});

// ==================== MENU HANDLER ====================
function showMainMenu(to) {
  const buttons = new Buttons(
    "📋 Mohon pilih menu berikut:",
    [{ body: "TOP UP" }, { body: "PESAN PRIBADI" }, { body: "IZIN CALLING" }],
    "Menu Utama",
    "Silakan pilih salah satu opsi"
  );
  client.sendMessage(to, buttons);
}

function showTopupMenu(to) {
  const buttons = new Buttons(
    "💰 Pilih nominal top-up:",
    [
      { body: "150K" },
      { body: "200K" },
      { body: "300K" },
      { body: "500K" },
      { body: "1/2" },
      { body: "1" },
      { body: "KEMBALI" },
    ],
    "Top Up",
    "Pilih nominal yang Anda inginkan"
  );
  client.sendMessage(to, buttons);
}

function confirmTopup(to, amount) {
  const buttons = new Buttons(
    `Anda memilih top-up ${amount}. Apakah ingin lanjut dengan BAYAR atau BON?`,
    [{ body: "BAYAR" }, { body: "BON" }, { body: "KEMBALI" }],
    "Konfirmasi Top Up",
    "Silakan pilih opsi pembayaran"
  );
  client.sendMessage(to, buttons);
}

function showPersonalMenu(to) {
  const buttons = new Buttons(
    "📌 Pilih layanan pesan pribadi:",
    [
      { body: "BON" },
      { body: "GADAI" },
      { body: "GADAI HP" },
      { body: "TEBUS GADAI" },
      { body: "LAIN-LAIN" },
      { body: "KEMBALI" },
    ],
    "Pesan Pribadi",
    "Pilih salah satu layanan"
  );
  client.sendMessage(to, buttons);
}

function requestCallPermission(to) {
  client.sendMessage(to, "📞 Permintaan izin panggilan dikirim ke admin. Mohon tunggu...");
  setTimeout(() => {
    resetSession(to);
    client.sendMessage(to, "⌛ Waktu permintaan panggilan habis. Kembali ke menu utama.");
    showMainMenu(to);
  }, MENU_TIMEOUT);
}

function invalidChoice(to) {
  client.sendMessage(to, "❌ Pilihan tidak valid. Silakan gunakan tombol yang tersedia.");
}

// ==================== EXPRESS SERVER ====================
app.get("/qr", (req, res) => {
  if (fs.existsSync("qr.png")) {
    res.sendFile(__dirname + "/qr.png");
  } else {
    res.send("QR belum tersedia. Tunggu beberapa saat...");
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Server berjalan di port ${PORT}`);
});

// ==================== START BOT ====================
client.initialize();
