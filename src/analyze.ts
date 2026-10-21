import { createWorker } from 'tesseract.js'
import type { Row } from './scan'

/* ---------- Koordinat ---------- */
export const CRE = /(-?\d{1,2}[.,]\d{3,})\s*[,;° ]\s*(-?\d{1,3}[.,]\d{3,})/g
const num = (s: string) => parseFloat(s.replace(',', '.'))
export const tcoords = (t: string): number[][] => [...t.matchAll(CRE)].map(m => [num(m[1]), num(m[2])]).filter(c => Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180)
const NUM = '[-−–—]?[\\dOolISB|]{1,3}[.,][\\dOolISB|]{4,8}'
const LATLON = new RegExp(`l[aeo][tl1]\\w{0,6}[^\\w\\-−–—]{0,6}(${NUM}).{0,8}?l[oa0][nm][gq9]?\\w{0,6}[^\\w\\-−–—]{0,6}(${NUM})`, 'i')
const fixNum = (x: string) => { const [a, b = ''] = x.replace(/[−–—]/g, '-').replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(',', '.').split('.'); return parseFloat(a + '.' + b.slice(0, 6)) }
const DMS = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|'')?\s*([NSEW]|LU|LS|BT|BB)?\b/gi
export const setCoord = (r: Row, lat: number, lon: number, st: string) => { r.lat = lat; r.lon = lon; r.berkoordinat = 'YA'; r.status_koordinat = st }

/* ---------- Cap waktu / time stamp dari teks OCR ---------- */
const DT = [/\b\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:GMT|UTC)\s*[+\-−]?\s*\d{1,2}(?::?\d{2})?/gi, /\b(?:senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b,?/gi,
  /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, /\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g,
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?\s+\d{2,4}\b/gi,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|WIB|WITA|WIT)?/gi]
export function parseStamp(text: string) {
  let lat: number | undefined, lon: number | undefined
  const ll = LATLON.exec(text)
  if (ll) { lat = fixNum(ll[1]); lon = fixNum(ll[2]) }
  if (lat == null) { const g = [...text.matchAll(/[-−–—]?\d{1,3}[.,]\d{5,8}/g)].map(m => fixNum(m[0])); if (g.length >= 2 && Math.abs(g[0]) <= 90 && Math.abs(g[1]) <= 180) { lat = g[0]; lon = g[1] } }
  if (lat == null) {
    const d = [...text.matchAll(DMS)].map(m => { const v = +m[1] + +m[2] / 60 + num(m[3]) / 3600; return /^(S|W|LS|BB)$/i.test(m[4] || '') ? -v : v })
    if (d.length >= 2) { lat = d[0]; lon = d[1] }
  }
  if (lat == null) { const c = tcoords(text)[0]; if (c) { lat = c[0]; lon = c[1] } }
  if (lat != null && (Math.abs(lat) > 90 || Math.abs(lon!) > 180)) lat = lon = undefined
  const got: string[] = []
  for (const re of DT) for (const m of text.matchAll(re)) { const v = m[0].trim(); if (!got.some(c => c.includes(v))) got.push(v) }
  const waktu = got.join(' ')
  const alamat = text.split(/\n+/).map(s => s.trim()).filter(s => /\b(jl\.?|jalan|desa|kel\.|kelurahan|kec\.|kecamatan|kab\.|kabupaten|kota|provinsi|indonesia|dusun|kampung|distrik)\b/i.test(s)).join(' | ')
  return { lat, lon, waktu, koordinat: lat != null ? `${lat}, ${lon}` : '', alamat }
}
export function applyOcr(r: Row, text: string) {
  const s = parseStamp(text)
  r.ocr_teks = text.replace(/\s+/g, ' ').trim().slice(0, 1500); r.ocr_waktu = s.waktu; r.ocr_koordinat = s.koordinat; r.ocr_alamat = s.alamat
  r.ocr_status = s.lat != null ? 'OCR: koordinat terbaca' : s.waktu ? 'OCR: waktu terbaca, koordinat TIDAK terbaca' : 'OCR berjalan, tidak ada cap terbaca'
  if (!r.waktu && s.waktu) r.waktu = 'OCR: ' + s.waktu
  if (r.berkoordinat !== 'YA' && s.lat != null) setCoord(r, s.lat, s.lon!, 'Dari OCR cap waktu')
}

/* ---------- Wilayah & luasan ---------- */
const STOP = new Set(['yang', 'dan', 'di', 'dengan', 'ini', 'itu', 'untuk', 'pada', 'dari', 'adalah', 'seluas', 'tersebut', 'atau', 'ke', 'sebagai', 'tahun', 'nomor', 'no', 'dalam', 'oleh', 'serta', 'telah', 'akan', 'luas', 'sebesar', 'berada', 'terletak', 'maka', 'dapat', 'harus', 'sudah', 'juga', 'bahwa', 'karena', 'ada', 'kabupaten', 'kab', 'kota', 'kecamatan', 'kec', 'kelurahan', 'kel', 'desa', 'dusun', 'kampung', 'distrik', 'nagari', 'gampong', 'dukuh', 'provinsi', 'prov'])
const ADM = /\b(Provinsi|Prov\.|Kabupaten|Kab\.|Kota|Kecamatan|Kec\.|Kelurahan|Kel\.|Desa|Dusun|Kampung|Distrik|Nagari|Gampong|Dukuh)\s+/gi
const LUAS = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(hektar[e]?|ha|km2|km²|m2|m²|meter persegi|are)\b/gi
const JN: Record<string, string> = { prov: 'Provinsi', kab: 'Kabupaten', kec: 'Kecamatan', kel: 'Kelurahan' }
const ctx = (t: string, i: number, n: number) => t.slice(Math.max(0, i - 70), i + n + 70).replace(/\s+/g, ' ').trim()
export const isRel = (t: string) => t.search(ADM) >= 0 || t.search(LUAS) >= 0
export function extractRegion(t: string): Row[] {
  const out: Row[] = []
  for (const m of t.matchAll(ADM)) {
    const kw = m[1].replace('.', '').toLowerCase(), toks: string[] = []
    for (const w of (t.slice(m.index! + m[0].length, m.index! + m[0].length + 80).match(/^(?:[A-Za-z'’-]+[ \t]?){1,5}/)?.[0] || '').trim().split(/\s+/)) { if (STOP.has(w.toLowerCase()) || /^\d/.test(w)) break; toks.push(w) }
    if (toks.length) out.push({ jenis: JN[kw] || kw[0].toUpperCase() + kw.slice(1), nama: toks.join(' '), nilai: '', satuan: '', konteks: ctx(t, m.index!, m[0].length) })
  }
  for (const m of t.matchAll(LUAS)) out.push({ jenis: /luas/i.test(ctx(t, m.index!, 0).slice(0, 90)) ? 'Luas' : 'Angka+satuan luas', nama: '', nilai: m[1], satuan: m[2], konteks: ctx(t, m.index!, m[0].length) })
  return out
}

/* ---------- JPEG mentah di dalam PDF/DOC (EXIF yang masih utuh) ---------- */
export function rawJpegs(b: ArrayBuffer) {
  const u = new Uint8Array(b), out: { off: number; w: number; h: number }[] = []
  for (let i = 0; i < u.length - 12; i++) {
    if (u[i] !== 0xff || u[i + 1] !== 0xd8 || u[i + 2] !== 0xff) continue
    let p = i + 2, w = 0, h = 0
    while (p < u.length - 9 && u[p] === 0xff) {
      const m = u[p + 1]
      if (m === 0xd9) break
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = (u[p + 5] << 8) | u[p + 6]; w = (u[p + 7] << 8) | u[p + 8]; break }
      p += 2 + ((u[p + 2] << 8) | u[p + 3])
    }
    out.push({ off: i, w, h }); i = Math.max(i + 2, p)   // lewati thumbnail di dalam APP1
  }
  return out
}

/* ---------- OCR: pool worker + prapemrosesan khusus cap putih di atas latar gelap ---------- */
type W = { p: Promise<any> | null; q: Promise<any>; n: number }
const POOL: W[] = Array.from({ length: Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2))) }, () => ({ p: null, q: Promise.resolve(), n: 0 }))
function ocrRaw(c: HTMLCanvasElement, psm: string): Promise<string> {
  const w = POOL.reduce((a, b) => (b.n < a.n ? b : a)); w.n++
  const run = w.q.then(async () => {
    w.p ??= createWorker('eng+ind').then(async x => { await x.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' } as any); return x })
    const wk = await w.p; await wk.setParameters({ tessedit_pageseg_mode: psm } as any)
    return (await wk.recognize(c)).data.text as string
  }).finally(() => { w.n-- })
  w.q = run.catch(() => {}); return run
}
// crop bagian bawah (tempat cap), skala 0.5x–4x agar lebar ±2200px, lalu: 'w' = ambil piksel terang (teks putih) jadi hitam di latar putih; 'g' = abu-abu kontras (dibalik bila gelap)
function prep(src: HTMLCanvasElement, frac: number, mode: 'w' | 'g', thr: number) {
  const sy = Math.round(src.height * (1 - frac)), sh = src.height - sy, sc = Math.min(4, Math.max(0.5, 2200 / src.width))
  const c = document.createElement('canvas'); c.width = Math.round(src.width * sc); c.height = Math.max(1, Math.round(sh * sc))
  const x = c.getContext('2d', { willReadFrequently: true })!; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, sy, src.width, sh, 0, 0, c.width, c.height)
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data; let sum = 0
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; sum += g }
  const inv = mode === 'g' && sum / (d.length / 4) < 128
  for (let i = 0; i < d.length; i += 4) { const v = mode === 'w' ? (d[i] > thr ? 0 : 255) : inv ? 255 - d[i] : d[i]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255 }
  x.putImageData(im, 0, 0); return c
}
export async function ocrCanvas(src: HTMLCanvasElement) {
  const passes: [number, 'w' | 'g', number, string][] = [[0.5, 'w', 185, '6'], [0.5, 'w', 150, '6'], [1, 'g', 0, '6'], [0.5, 'g', 0, '11'], [1, 'w', 170, '11']]
  let best = '', bs = -1
  for (const [f, m, t, psm] of passes) {
    const txt = await ocrRaw(prep(src, f, m, t), psm), p = parseStamp(txt), sc = (p.lat != null ? 3 : 0) + (p.waktu ? 1 : 0) + (p.alamat ? 1 : 0)
    if (sc > bs) { bs = sc; best = txt }
    if (bs >= 4) break
  }
  return best
}
export async function ocrBuffer(b: ArrayBuffer, mime = 'image/jpeg') {
  const bm = await createImageBitmap(new Blob([b], { type: mime })), c = document.createElement('canvas')
  c.width = bm.width; c.height = bm.height; c.getContext('2d')!.drawImage(bm, 0, 0); return ocrCanvas(c)
}
