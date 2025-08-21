const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const express = require("express");

// ===== Konfigurasi Nomor Admin & Keluarga =====
const ADMIN_NUMBERS = ["6281256513331@c.us"]; // nomor admin utama
const EXEMPT_NUMBERS = ["62xxxxxxxxxx@c.us", "62yyyyyyyyyy@c.us"]; // nomor keluarga/khusus, tidak dibalas bot

// ===== Load Session =====
let sessions = {};
if (fs.existsSync("sessions.json")) {
  try {
    sessions = JSON.parse(fs.readFileSync("sessions.json"));
  } catch (err) {
    console.error("❌ Gagal load sessions.json:", err);
  }
}

// Simpan session ke file
function saveSessions() {
  fs.writeFileSync("sessions.json", JSON.stringify(sessions, null, 2));
}

// Log pesan masuk
function logMessage(msg) {
  const logLine = `[${new Date().toISOString()}] ${msg.from}: ${msg.body}\n`;
  fs.appendFileSync("logs.txt", logLine);
}

// ===== Buat Client =====
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// ===== Express untuk QR Link =====
const app = express();
let latestQR = null;

app.get("/", (req, res) => {
  if (!latestQR) return res.send("QR belum tersedia");
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(
    latestQR
  )}`;
  res.send(`<h2>Scan QR WhatsApp</h2><img src="${qrUrl}" />`);
});

app.listen(8080, () => console.log("🌐 Server berjalan di port 8080"));

// ===== Event Handling =====
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("✅ QR diterima, scan di: http://localhost:8080/");
});

client.on("ready", () => {
  console.log("🤖 Bot siap digunakan!");
});

// ===== Handle Chat =====
client.on("message", async (msg) => {
  logMessage(msg);

  // Abaikan pesan dari grup
  if (msg.from.includes("-")) return;

  // Abaikan nomor admin/keluarga
  if (EXEMPT_NUMBERS.includes(msg.from)) return;

  // Ambil session user
  const user = msg.from;
  if (!sessions[user]) {
    sessions[user] = { state: "MENU", lastActive: Date.now() };
    saveSessions();
    return showMainMenu(user);
  }

  // Update waktu aktif
  sessions[user].lastActive = Date.now();
  saveSessions();

  // Proses berdasarkan state
  const state = sessions[user].state;

  if (state === "MENU") {
    if (msg.body === "TOP UP") {
      sessions[user].state = "TOPUP_SELECT";
      saveSessions();
      return showTopupMenu(user);
    } else if (msg.body === "PESAN PRIBADI") {
      sessions[user].state = "PRIVATE_ORDER";
      saveSessions();
      return showPrivateMenu(user);
    } else if (msg.body === "IZIN CALLING") {
      sessions[user].state = "CALLING_PENDING";
      sessions[user].expiresAt = Date.now() + 5 * 60 * 1000; // 5 menit
      saveSessions();
      return client.sendMessage(
        user,
        "⏳ Permintaan izin panggilan diterima. Silakan tunggu konfirmasi admin (maks 5 menit)."
      );
    } else {
      return showMainMenu(user, "❌ Pilihan tidak valid. Silakan pilih lagi.");
    }
  }

  // TOPUP
  if (state === "TOPUP_SELECT") {
    if (
      ["150K", "200K", "300K", "500K", "1/2", "1"].includes(msg.body.toUpperCase())
    ) {
      sessions[user].nominal = msg.body.toUpperCase();
      sessions[user].state = "TOPUP_CONFIRM";
      saveSessions();
      return client.sendMessage(
        user,
        `Anda memilih nominal *${msg.body}*.\nApakah Anda yakin?`,
        {
          buttons: [
            { body: "✅ Yakin" },
            { body: "🔄 Ubah" },
            { body: "⬅️ Kembali" },
          ],
        }
      );
    } else {
      return showTopupMenu(user, "❌ Pilihan tidak valid.");
    }
  }

  if (state === "TOPUP_CONFIRM") {
    if (msg.body === "✅ Yakin") {
      sessions[user].state = "TOPUP_METHOD";
      saveSessions();
      return client.sendMessage(user, "Pilih metode:", {
        buttons: [{ body: "Bayar" }, { body: "Bon" }],
      });
    } else if (msg.body === "🔄 Ubah" || msg.body === "⬅️ Kembali") {
      sessions[user].state = "TOPUP_SELECT";
      saveSessions();
      return showTopupMenu(user);
    }
  }

  if (state === "TOPUP_METHOD") {
    if (msg.body === "Bayar") {
      sessions[user].state = "WAITING_ADMIN";
      sessions[user].expiresAt = Date.now() + 60 * 60 * 1000; // 1 jam
      saveSessions();
      return client.sendMessage(
        user,
        "✅ Transaksi *Bayar* sedang diproses. Mohon tunggu admin."
      );
    } else if (msg.body === "Bon") {
      sessions[user].state = "WAITING_APPROVAL";
      sessions[user].expiresAt = Date.now() + 60 * 60 * 1000; // 1 jam
      saveSessions();
      return client.sendMessage(
        user,
        "⏳ Permintaan *Bon* dikirim. Tunggu persetujuan admin."
      );
    }
  }

  // PESAN PRIBADI
  if (state === "PRIVATE_ORDER") {
    if (
      ["BON", "GADAI", "GADAI HP", "TEBUS GADAI", "LAIN-LAIN"].includes(
        msg.body.toUpperCase()
      )
    ) {
      sessions[user].state = "WAITING_ADMIN";
      sessions[user].expiresAt = Date.now() + 60 * 60 * 1000; // 1 jam
      saveSessions();
      return client.sendMessage(
        user,
        `⏳ Pesanan *${msg.body}* diterima. Tunggu respon admin.`
      );
    } else {
      return showPrivateMenu(user, "❌ Pilihan tidak valid.");
    }
  }
});

// ===== Reject Call =====
client.on("incoming_call", async (call) => {
  await call.reject();
  client.sendMessage(
    call.from,
    "❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat untuk akses menu."
  );
});

// ===== Session Timeout Checker =====
setInterval(() => {
  const now = Date.now();
  for (const user in sessions) {
    if (sessions[user].expiresAt && now > sessions[user].expiresAt) {
      client.sendMessage(
        user,
        "⌛ Session Anda telah berakhir. Kembali ke menu utama."
      );
      sessions[user] = { state: "MENU", lastActive: now };
      saveSessions();
      showMainMenu(user);
    }
  }
}, 60 * 1000);

// ===== Menu Functions =====
function showMainMenu(user, prefix = "") {
  client.sendMessage(
    user,
    `${prefix}\n📋 *Menu Utama*:\nPilih layanan berikut:`,
    {
      buttons: [
        { body: "TOP UP" },
        { body: "PESAN PRIBADI" },
        { body: "IZIN CALLING" },
      ],
    }
  );
}

function showTopupMenu(user, prefix = "") {
  client.sendMessage(
    user,
    `${prefix}\n💰 *Pilih Nominal TOP UP*`,
    {
      buttons: [
        { body: "150K" },
        { body: "200K" },
        { body: "300K" },
        { body: "500K" },
        { body: "1/2" },
        { body: "1" },
      ],
    }
  );
}

function showPrivateMenu(user, prefix = "") {
  client.sendMessage(
    user,
    `${prefix}\n📦 *PESAN PRIBADI*:\nPilih layanan:`,
    {
      buttons: [
        { body: "BON" },
        { body: "GADAI" },
        { body: "GADAI HP" },
        { body: "TEBUS GADAI" },
        { body: "LAIN-LAIN" },
      ],
    }
  );
}

// ===== Start =====
client.initialize();
