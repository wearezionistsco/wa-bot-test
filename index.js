// index.js — RINGKAS, FITUR LENGKAP
const fs = require("fs");
const express = require("express");
const { Client, LocalAuth, Buttons } = require("whatsapp-web.js");

const PORT = process.env.PORT || 8080;

// ====== KONFIG ======
const ADMIN_NUMBERS = ["62xxxxxxxxxx@c.us"];            // ganti nomor admin
const WHITELIST_NUMBERS = [...ADMIN_NUMBERS];           // nomor yang tidak diproses bot
const CALL_TIMEOUT = 5 * 60 * 1000;                     // 5 menit
const ORDER_TIMEOUT = 60 * 60 * 1000;                   // 1 jam
const SESSION_FILE = "sessions.json";
let sessions = fs.existsSync(SESSION_FILE) ? JSON.parse(fs.readFileSync(SESSION_FILE)) : {};
const save = () => fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
const now = () => Date.now();
const allowed = new Set([
  "TOP UP","PESAN PRIBADI","IZIN CALLING",
  "150K","200K","300K","500K","1/2","1",
  "BAYAR","BON","KEMBALI",
  "BON","GADAI","GADAI HP","TEBUS GADAI","LAIN-LAIN"
]);

// ====== EXPRESS (health + QR) ======
let latestQR = null;
const app = express();
app.get("/", (_,res)=>res.send("✅ Bot aktif. QR di /qr"));
app.get("/qr", (_,res)=>{
  if(!latestQR) return res.status(404).send("❌ QR belum siap");
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQR)}`;
  res.send(`<h3>Scan QR</h3><img src="${url}" /><p><a href="${url}" target="_blank">Buka gambar</a></p>`);
});
app.listen(PORT, ()=>console.log("🌐 HTTP:",PORT));

// ====== WHATSAPP CLIENT ======
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: "bot-session" }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--no-zygote","--disable-gpu"]
  }
});

client.on("qr", (qr) => {
  latestQR = qr;
  const link = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log("🔑 QR:", link);
});
client.on("ready", ()=>console.log("🤖 Bot siap"));

// ====== UI ======
const btnMain = () => new Buttons("Pilih layanan:",[{body:"TOP UP"},{body:"PESAN PRIBADI"},{body:"IZIN CALLING"}],"📌 MENU UTAMA","Gunakan tombol.");
const btnTopup = () => new Buttons("Nominal:",[{body:"150K"},{body:"200K"},{body:"300K"},{body:"500K"},{body:"1/2"},{body:"1"}],"💰 TOP UP","Tekan salah satu.");
const btnConfirm = (n) => new Buttons(`Nominal *${n}*`,[{body:"BAYAR"},{body:"BON"},{body:"KEMBALI"}],"Konfirmasi","Lanjutkan?");
const btnPriv = () => new Buttons("Kategori:",[{body:"BON"},{body:"GADAI"},{body:"GADAI HP"},{body:"TEBUS GADAI"},{body:"LAIN-LAIN"}],"✉ PESAN PRIBADI","Tekan tombol.");
const invalid = (to)=>client.sendMessage(to,"❌ Pilihan tidak valid. Gunakan *tombol* yang tersedia.");
const menu = (to,txt="")=>client.sendMessage(to, txt?txt+"\n":"").then(()=>client.sendMessage(to,btnMain()));
const menuTop = (to,txt="")=>client.sendMessage(to, txt?txt+"\n":"").then(()=>client.sendMessage(to,btnTopup()));
const menuPriv = (to,txt="")=>client.sendMessage(to, txt?txt+"\n":"").then(()=>client.sendMessage(to,btnPriv()));

// ====== ADMIN COMMAND ======
async function adminCmd(from, text){
  if(!ADMIN_NUMBERS.includes(from)) return false;
  const [cmd, arg] = text.trim().split(/\s+/);
  if((cmd||"").toLowerCase()!=="close") return false;
  if(!arg){ sessions={}; save(); await client.sendMessage(from,"✅ Semua sesi ditutup."); }
  else { delete sessions[arg]; save(); await client.sendMessage(from,`✅ Sesi ${arg} ditutup.`); }
  return true;
}

// ====== CALL: auto reject kecuali whitelist ======
client.on("call", async (call)=>{
  if(!WHITELIST_NUMBERS.includes(call.from)){
    await call.reject();
    await client.sendMessage(call.from,"❌ Panggilan tidak diizinkan. Silakan gunakan chat dan tombol menu.");
  }
});

// ====== MESSAGE FSM ======
client.on("message", async (msg)=>{
  const from = msg.from;
  const text = (msg.body||"").trim();

  if(from.includes("-")) return;                 // skip grup
  if(await adminCmd(from,text)) return;          // admin command
  if(WHITELIST_NUMBERS.includes(from)) return;   // whitelist: bot diam

  // sesi awal → kirim menu utama
  if(!sessions[from]){
    sessions[from] = { step:"menu", ts: now() };
    save(); return menu(from);
  }

  const S = sessions[from];
  S.ts = now(); save();

  // timeout hard-check
  if(S.step==="izin_call" && S.exp && now()>S.exp){
    delete sessions[from]; save();
    await client.sendMessage(from,"⌛ Waktu izin panggilan habis. Kembali ke menu.");
    return menu(from);
  }
  if(S.step==="pending_admin" && S.exp && now()>S.exp){
    delete sessions[from]; save();
    await client.sendMessage(from,"⌛ Sesi ditutup otomatis (1 jam). Kembali ke menu.");
    return menu(from);
  }

  // hanya terima tombol
  if(!allowed.has(text)) return invalid(from);

  // FSM
  if(S.step==="menu"){
    if(text==="TOP UP"){ S.step="topup_nom"; save(); return menuTop(from); }
    if(text==="PESAN PRIBADI"){ S.step="priv"; save(); return menuPriv(from); }
    if(text==="IZIN CALLING"){
      S.step="izin_call"; S.exp = now()+CALL_TIMEOUT; save();
      return client.sendMessage(from,"📞 Permintaan izin panggilan dicatat. Tunggu admin (maks 5 menit).");
    }
    return invalid(from);
  }

  if(S.step==="topup_nom"){
    if(text==="KEMBALI"){ S.step="menu"; delete S.nom; save(); return menu(from); }
    S.nom = text; S.step="topup_ok"; save();
    return client.sendMessage(from, btnConfirm(S.nom));
  }

  if(S.step==="topup_ok"){
    if(text==="KEMBALI"){ S.step="topup_nom"; save(); return menuTop(from); }
    if(text==="BAYAR"){ S.step="pending_admin"; S.method="BAYAR"; S.exp=now()+ORDER_TIMEOUT; save();
      return client.sendMessage(from,`✅ Top Up *${S.nom}* (BAYAR) dicatat. Mohon tunggu admin.`);
    }
    if(text==="BON"){ S.step="pending_admin"; S.method="BON"; S.exp=now()+ORDER_TIMEOUT; save();
      return client.sendMessage(from,`⌛ Top Up *${S.nom}* (BON) menunggu persetujuan admin.`);
    }
    return invalid(from);
  }

  if(S.step==="priv"){
    if(text==="KEMBALI"){ S.step="menu"; delete S.req; save(); return menu(from); }
    S.req = text; S.step="pending_admin"; S.exp=now()+ORDER_TIMEOUT; save();
    return client.sendMessage(from,`✅ Permintaan *${text}* dicatat. Mohon tunggu admin.`);
  }

  if(S.step==="izin_call"){
    // tekan tombol apapun → kembali menu (permintaan tetap dianggap terkirim)
    S.step="menu"; delete S.exp; save(); return menu(from);
  }

  if(S.step==="pending_admin"){
    return client.sendMessage(from,"🕒 Mohon tunggu. Admin akan membalas. (Auto close 1 jam tanpa respon)");
  }

  // fallback
  S.step="menu"; save(); return menu(from);
});

// ====== SWEEPER (jaga timeout) ======
setInterval(()=>{
  const t = now();
  for(const [jid,S] of Object.entries(sessions)){
    if(S.step==="izin_call" && S.exp && t>S.exp){
      delete sessions[jid]; save();
      client.sendMessage(jid,"⌛ Waktu izin panggilan habis. Kembali ke menu."); menu(jid);
    }
    if(S.step==="pending_admin" && S.exp && t>S.exp){
      delete sessions[jid]; save();
      client.sendMessage(jid,"⌛ Sesi ditutup otomatis (1 jam). Kembali ke menu."); menu(jid);
    }
  }
}, 60*1000);

// ====== START ======
client.initialize();
