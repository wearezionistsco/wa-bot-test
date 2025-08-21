const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");

// nomor admin & nomor yang dikecualikan
const ADMIN_NUMBER = "6281256513331@c.us";
const EXCLUDE_NUMBERS = [ADMIN_NUMBER]; 

// session tracking
let sessions = {};
const SESSIONS_FILE = "./sessions.json";

// load session dari file
if (fs.existsSync(SESSIONS_FILE)) {
  sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

// save session ke file
function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

// menu utama
function getMainMenu() {
  return {
    body: "Mohon pilih menu berikut:",
    buttons: [
      { body: "TOP UP" },
      { body: "PESAN PRIBADI" },
      { body: "IZIN PANGGILAN" }
    ]
  };
}

// sub menu top up
function getTopUpMenu() {
  return {
    body: "Pilih nominal TOP UP:",
    buttons: [
      { body: "150K" },
      { body: "200K" },
      { body: "300K" },
      { body: "500K" },
      { body: "1/2" },
      { body: "1" },
      { body: "Kembali" }
    ]
  };
}

// sub menu pembayaran
function getPaymentMenu(nominal) {
  return {
    body: `Anda memilih TOP UP ${nominal}. Konfirmasi pembayaran:`,
    buttons: [
      { body: "Bayar" },
      { body: "Bon" },
      { body: "Kembali" }
    ]
  };
}

// buat client WA
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// qr
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan QR untuk login WhatsApp!");
});

// ready
client.on("ready", () => {
  console.log("✅ Bot WhatsApp sudah siap!");
});

// handle pesan
client.on("message", async (msg) => {
  const from = msg.from;

  // pengecualian
  if (EXCLUDE_NUMBERS.includes(from)) return;

  // init session
  if (!sessions[from]) {
    sessions[from] = { step: "MAIN_MENU", data: {} };
    saveSessions();
    await msg.reply(getMainMenu());
    return;
  }

  const session = sessions[from];

  // handle menu
  if (session.step === "MAIN_MENU") {
    if (msg.body === "TOP UP") {
      session.step = "TOPUP_MENU";
      saveSessions();
      await msg.reply(getTopUpMenu());
    } else if (msg.body === "PESAN PRIBADI") {
      session.step = "WAITING_PRIVATE";
      saveSessions();
      await msg.reply("Silakan pilih jenis pesan pribadi:\n- BON\n- GADAI\n- GADAI HP\n- TEBUS GADAI\n- LAIN-LAIN");
    } else if (msg.body === "IZIN PANGGILAN") {
      session.step = "WAITING_CALL";
      saveSessions();
      await msg.reply("❌ Maaf, panggilan tidak diizinkan. Silakan gunakan chat.");
      session.step = "MAIN_MENU";
    } else {
      await msg.reply("❌ Pilihan tidak valid.\nSilakan pilih menu:");
      await msg.reply(getMainMenu());
    }
  }

  else if (session.step === "TOPUP_MENU") {
    if (["150K","200K","300K","500K","1/2","1"].includes(msg.body)) {
      session.data.nominal = msg.body;
      session.step = "PAYMENT_CONFIRM";
      saveSessions();
      await msg.reply(getPaymentMenu(msg.body));
    } else if (msg.body === "Kembali") {
      session.step = "MAIN_MENU";
      saveSessions();
      await msg.reply(getMainMenu());
    } else {
      await msg.reply("❌ Pilihan tidak valid.\nSilakan pilih nominal TOP UP:");
      await msg.reply(getTopUpMenu());
    }
  }

  else if (session.step === "PAYMENT_CONFIRM") {
    if (msg.body === "Bayar") {
      await msg.reply("✅ Pesanan TOP UP akan segera diproses. Mohon tunggu konfirmasi admin.");
      session.step = "WAITING_ADMIN";
      saveSessions();
    } else if (msg.body === "Bon") {
      await msg.reply("⏳ Permintaan BON menunggu persetujuan admin.");
      session.step = "WAITING_ADMIN";
      saveSessions();
    } else if (msg.body === "Kembali") {
      session.step = "TOPUP_MENU";
      saveSessions();
      await msg.reply(getTopUpMenu());
    } else {
      await msg.reply("❌ Pilihan tidak valid.\nSilakan pilih konfirmasi pembayaran:");
      await msg.reply(getPaymentMenu(session.data.nominal));
    }
  }
});

client.initialize();
