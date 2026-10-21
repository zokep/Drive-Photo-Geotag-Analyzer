import { createWorker } from 'tesseract.js'
import type { Row } from './scan'

/* ---------- Koordinat ---------- */
export const CRE = /(-?\d{1,2}[.,]\d{3,})\s*[,;° ]\s*(-?\d{1,3}[.,]\d{3,})/g
const num = (s: string) => parseFloat(s.replace(',', '.'))
export const tcoords = (t: string): number[][] => [...t.matchAll(CRE)].map(m => [num(m[1]), num(m[2])]).filter(c => Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180)
const LATLON = /lat(?:itude)?\s*[:=]?\s*(-?\d+[.,]\d+)[^\d-]{0,14}lon(?:g|gitude)?\s*[:=]?\s*(-?\d+[.,]\d+)/i
const DMS = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|'')?\s*([NSEW]|LU|LS|BT|BB)?\b/gi
export const setCoord = (r: Row, lat: number, lon: number, st: string) => { r.lat = lat; r.lon = lon; r.berkoordinat = 'YA'; r.status_koordinat = st }

/* ---------- Cap waktu / time stamp dari teks OCR ---------- */
const DT = [/\b(?:senin|selasa|rabu|kamis|jum'?at|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b,?/gi,
  /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, /\b\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}\b/g,
  /\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\.?\s+\d{2,4}\b/gi,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|WIB|WITA|WIT)?/gi]
export function parseStamp(text: string) {
  let lat: number | undefined, lon: number | undefined
  const ll = LATLON.exec(text)
  if (ll) { lat = num(ll[1]); lon = num(ll[2]) }
  if (lat == null) {
    const d = [...text.matchAll(DMS)].map(m => { const v = +m[1] + +m[2] / 60 + num(m[3]) / 3600; return /^(S|W|LS|BB)$/i.test(m[4] || '') ? -v : v })
    if (d.length >= 2) { lat = d[0]; lon = d[1] }
  }
  if (lat == null) { const c = tcoords(text)[0]; if (c) { lat = c[0]; lon = c[1] } }
  if (lat != null && (Math.abs(lat) > 90 || Math.abs(lon!) > 180)) lat = lon = undefined
  const waktu = [...new Set(DT.flatMap(re => [...text.matchAll(re)].map(m => m[0].trim())))].join(' ')
  const alamat = text.split(/\n+/).map(s => s.trim()).filter(s => /\b(jl\.?|jalan|desa|kel\.|kelurahan|kec\.|kecamatan|kab\.|kabupaten|kota|provinsi|indonesia|dusun|kampung|distrik)\b/i.test(s)).join(' | ')
  return { lat, lon, waktu, koordinat: lat != null ? `${lat}, ${lon}` : '', alamat }
}
export function applyOcr(r: Row, text: string) {
  const s = parseStamp(text)
  r.ocr_teks = text.replace(/\s+/g, ' ').trim().slice(0, 1500); r.ocr_waktu = s.waktu; r.ocr_koordinat = s.koordinat; r.ocr_alamat = s.alamat
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

/* ---------- OCR (Tesseract.js, antrean satu-satu) ---------- */
let wk: Promise<any> | null = null, chain: Promise<any> = Promise.resolve()
function ocr(src: HTMLCanvasElement): Promise<string> {
  const run = chain.then(async () => { wk ??= createWorker('eng+ind'); return (await (await wk).recognize(src)).data.text as string })
  chain = run.catch(() => {}); return run
}
function shrink(c: HTMLCanvasElement) {
  const s = Math.min(1, 1800 / Math.max(c.width, c.height)); if (s >= 1) return c
  const o = document.createElement('canvas'); o.width = Math.round(c.width * s); o.height = Math.round(c.height * s)
  o.getContext('2d')!.drawImage(c, 0, 0, o.width, o.height); return o
}
export const ocrCanvas = (c: HTMLCanvasElement) => ocr(shrink(c))
export async function ocrBuffer(b: ArrayBuffer, mime = 'image/jpeg') {
  const bm = await createImageBitmap(new Blob([b], { type: mime })), c = document.createElement('canvas')
  c.width = bm.width; c.height = bm.height; c.getContext('2d')!.drawImage(bm, 0, 0); return ocrCanvas(c)
}
