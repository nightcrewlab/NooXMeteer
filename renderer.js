const $ = s => document.querySelector(s);
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let sel = new Set(LS('sel', [])), vol = LS('vol', {}), micId = LS('mic', 'default');
let running = false, stream = null, outs = [], mics = [], defId = null;
const nodes = new Map();
let micStream = null, micCtx = null, raf = 0;
const skip = ['default', 'communications'];

// Yeni takılan cihaza bu süre dolmadan ses gönderme (ms). Windows varsayılanı
// değiştirene kadar beklenir; aksi halde yakalanan ses kendi çıkışımızdan
// tekrar yakalanıp geri besleme (didididi) yapar.
const SETTLE = 2500;
const seen = new Map();            // deviceId -> ilk görülme zamanı
let sig = '', firstRun = true;
let lastDef = null, rsT = 0, restarting = false;

async function refresh() {
  const d = await navigator.mediaDevices.enumerateDevices();
  const def = d.find(x => x.kind === 'audiooutput' && x.deviceId === 'default');
  outs = d.filter(x => x.kind === 'audiooutput' && !skip.includes(x.deviceId));
  mics = d.filter(x => x.kind === 'audioinput' && !skip.includes(x.deviceId));

  // Varsayılan cihazı önce groupId, sonra etiketle eşle. Bulunamazsa tahmin
  // yürütme (null): yanlış cihazı varsayılan sanıp gerçek varsayılana ses basmayalım.
  let hit = def && outs.find(x => x.groupId && x.groupId === def.groupId);
  if (def && !hit) {
    const nm = (def.label || '').replace(/^[^-]*\s-\s/, '');
    hit = outs.find(x => x.label === nm);
  }
  defId = hit ? hit.deviceId : (def ? null : ((outs[0] || {}).deviceId ?? null));

  // Varsayılan cihaz çalışırken değişirse Windows'un ses yakalaması bozuluyor
  // (diğer cihazlara cik cik / civciv diye gidiyor). Yakalamayı baştan başlat.
  if (defId) {
    if (running && lastDef && defId !== lastDef) onDefaultChanged();
    lastDef = defId;
  }

  const now = Date.now(), ids = new Set(outs.map(o => o.deviceId));
  for (const o of outs) if (!seen.has(o.deviceId)) seen.set(o.deviceId, firstRun ? 0 : now);
  for (const id of [...seen.keys()]) if (!ids.has(id)) seen.delete(id);
  firstRun = false;

  // Sadece liste ya da varsayılan değiştiyse yeniden çiz (kaydırıcı/seçim bozulmasın)
  const s = JSON.stringify([defId, outs.map(o => [o.deviceId, o.label]), mics.map(m => [m.deviceId, m.label])]);
  if (s !== sig) { sig = s; render(); }
  if (running) sync();
}

function render() {
  $('#devs').innerHTML = outs.map(o => {
    const isDef = o.deviceId === defId, on = isDef || sel.has(o.deviceId);
    return `<div class="card ${on ? 'on' : ''}"><div class="row"><span class="ic">🔊</span>
      <div class="nm">${esc(o.label || 'Cihaz')}${isDef ? '<small>Sistem varsayılanı · her zaman çalar</small>' : ''}</div>
      <button class="tst" data-test="${o.deviceId}">Test</button><label class="sw"><input type="checkbox" data-id="${o.deviceId}" ${on ? 'checked' : ''} ${isDef ? 'disabled' : ''}><i></i></label></div>
      ${isDef ? '' : `<input class="vol" type="range" min="0" max="100" value="${vol[o.deviceId] ?? 100}" data-vol="${o.deviceId}">`}</div>`;
  }).join('');
  $('#mic').innerHTML = `<option value="default">Sistem varsayılanı</option>` +
    mics.map(m => `<option value="${m.deviceId}">${esc(m.label)}</option>`).join('');
  $('#mic').value = mics.some(m => m.deviceId === micId) ? micId : 'default';
}

let actx = null, srcNode = null, bus = null, keep = null, capRaf = 0;

async function addNode(id) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  const g = ctx.createGain(); g.gain.value = (vol[id] ?? 100) / 100;
  nodes.set(id, { ctx, g });
  try {
    await ctx.setSinkId(id);
    ctx.createMediaStreamSource(bus.stream).connect(g); g.connect(ctx.destination);
    await ctx.resume();
  } catch (e) {
    if (nodes.has(id)) { removeNode(id); $('#ps').textContent = 'Cihaz hatası: ' + e.message; }
  }
}
function removeNode(id) {
  const n = nodes.get(id); if (!n) return;
  n.ctx.close().catch(() => {}); nodes.delete(id);
}
function sync() {
  for (const id of [...nodes.keys()])
    if (!sel.has(id) || id === defId || !outs.some(o => o.deviceId === id)) removeNode(id);
  const now = Date.now();
  for (const id of sel)
    if (!restarting && defId && id !== defId && !nodes.has(id) && outs.some(o => o.deviceId === id)
        && now - (seen.get(id) ?? 0) >= SETTLE) addNode(id);
  ui();
}

function ui() {
  $('#power').classList.toggle('run', running);
  $('#pt').textContent = running ? 'DURDUR' : 'BAŞLAT';
  if (!$('#ps').textContent.startsWith('Cihaz') && !$('#ps').textContent.startsWith('Ses yak'))
    $('#ps').textContent = running ? (defId ? `${nodes.size} ek cihaza ses gidiyor` : 'Varsayılan cihaz algılanıyor…') : 'Ses tüm seçili cihazlara gidecek';
  $('#count').textContent = `(${sel.size + 1} seçili)`;
}

async function toggle() {
  $('#ps').textContent = '';
  if (!running) {
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 16, height: 16, frameRate: 1 }, audio: true }); }
    catch (e) { $('#ps').textContent = 'Ses yakalanamadı: ' + e.message; return; }
    const at = stream.getAudioTracks();
    if (!at.length) { stream.getTracks().forEach(t => t.stop()); $('#ps').textContent = 'Ses yakalanamadı: ses kanalı yok'; return; }
    keep = new Audio(); keep.srcObject = stream; keep.muted = true; keep.play().catch(() => {});
    actx = new AudioContext({ latencyHint: 'interactive' }); await actx.resume();
    srcNode = actx.createMediaStreamSource(new MediaStream(at));
    const an = actx.createAnalyser(); an.fftSize = 512; srcNode.connect(an);
    bus = actx.createMediaStreamDestination(); srcNode.connect(bus);
    const b = new Uint8Array(an.fftSize);
    (function loop() {
      an.getByteTimeDomainData(b); let m = 0;
      for (const v of b) m = Math.max(m, Math.abs(v - 128));
      $('#cap i').style.width = Math.min(100, m / 128 * 180) + '%';
      capRaf = requestAnimationFrame(loop);
    })();
    running = true; sync();
  } else {
    [...nodes.keys()].forEach(removeNode);
    cancelAnimationFrame(capRaf); $('#cap i').style.width = '0';
    keep.srcObject = null; stream.getTracks().forEach(t => t.stop()); actx.close(); running = false;
  }
  ui();
}

function onDefaultChanged() {
  restarting = true;
  [...nodes.keys()].forEach(removeNode);            // bozuk sesi hemen kes
  $('#ps').textContent = 'Ses yakalama yenileniyor…';
  clearTimeout(rsT); rsT = setTimeout(restartCapture, 1200); // Windows'un oturmasını bekle
}
async function restartCapture() {
  try {
    if (!running) return;                           // bu arada kullanıcı durdurduysa dokunma
    await toggle();                                 // durdur
    await new Promise(r => setTimeout(r, 300));
    await toggle();                                 // yeni varsayılanı yakalayarak başlat
    if (!running) console.log('__noox_start__');    // kullanıcı hareketi gerekirse main.js devralır
  } finally { restarting = false; }
}
window.__nooxStart = async () => { if (!running) await toggle(); };

async function beep(id) {
  try {
    const c = new AudioContext(); await c.setSinkId(id); await c.resume();
    const lb = outs.find(o => o.deviceId === id)?.label || id;
    $('#ps').textContent = 'Cihaz testi → ' + lb + ' | sinkId: ' + (typeof c.sinkId === 'string' ? (c.sinkId === id ? 'eşleşti' : 'FARKLI') : JSON.stringify(c.sinkId)) + ' | ' + c.sampleRate + ' Hz | ' + c.state;
    const o = c.createOscillator(), g = c.createGain(); g.gain.value = .15;
    o.connect(g); g.connect(c.destination); o.start();
    setTimeout(() => { o.stop(); c.close(); }, 800);
  } catch (e) { $('#ps').textContent = 'Cihaz hatası: ' + e.message; }
}

async function startMic() {
  cancelAnimationFrame(raf); micStream?.getTracks().forEach(t => t.stop()); micCtx?.close();
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: micId === 'default' ? true : { deviceId: { exact: micId } } }); }
  catch { $('#mstat').textContent = 'Mikrofon açılamadı'; return; }
  $('#mstat').textContent = 'Mikrofon aktif'; $('#mute').classList.remove('off');
  micCtx = new AudioContext();
  const an = micCtx.createAnalyser(); an.fftSize = 512;
  micCtx.createMediaStreamSource(micStream).connect(an);
  const b = new Uint8Array(an.fftSize);
  (function loop() {
    an.getByteTimeDomainData(b); let m = 0;
    for (const v of b) m = Math.max(m, Math.abs(v - 128));
    $('#meter i').style.width = Math.min(100, m / 128 * 180) + '%';
    raf = requestAnimationFrame(loop);
  })();
}

$('#power').onclick = toggle;
$('#devs').addEventListener('click', e => { const id = e.target.dataset.test; if (id) beep(id); });
$('#devs').addEventListener('change', e => {
  const id = e.target.dataset.id; if (!id) return;
  e.target.checked ? sel.add(id) : sel.delete(id);
  save('sel', [...sel]); render(); if (running) sync(); else ui();
});
$('#devs').addEventListener('input', e => {
  const id = e.target.dataset.vol; if (!id) return;
  vol[id] = +e.target.value; save('vol', vol);
  const n = nodes.get(id); if (n) n.g.gain.value = vol[id] / 100;
});
$('#mic').onchange = e => { micId = e.target.value; save('mic', micId); startMic(); };
$('#mute').onclick = () => {
  const t = micStream?.getAudioTracks()[0]; if (!t) return;
  t.enabled = !t.enabled; $('#mute').classList.toggle('off', !t.enabled);
  $('#mstat').textContent = t.enabled ? 'Mikrofon aktif' : 'Mikrofon susturuldu';
};
navigator.mediaDevices.addEventListener('devicechange', refresh);
(async () => { await startMic(); await refresh(); ui(); })();
// Windows varsayılanı değiştirdiğinde her zaman devicechange tetiklenmez; kısa aralıkla kontrol et
setInterval(() => refresh().catch(() => {}), 800);
