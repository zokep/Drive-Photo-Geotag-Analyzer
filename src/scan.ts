import exifr from 'exifr'
import { applyOcr, extractRegion, ocrBuffer } from './analyze'
import { procDoc } from './docs'

export interface Acct { email: string; token: string; folders: string; on: boolean }
export type Row = Record<string, any>
export interface Result { rows: Row[]; docs: Row[]; folders: Set<string>; wilayah: Row[]; teks: Row[] }
export type Ocr = 'off' | 'missing' | 'all'
export type Job = { a: Acct; f: any; path: string; k: 'img' | 'doc' }
type Prog = (t: string, p: number) => void

const API = 'https://www.googleapis.com/drive/v3/files'
const FOLDER = 'application/vnd.google-apps.folder'
export const SEP = ' > '
const H = (a: Acct) => ({ Authorization: 'Bearer ' + a.token })
export const folderId = (s: string) => (s.match(/folders\/([\w-]+)/) || s.match(/[?&]id=([\w-]+)/) || [0, s.trim()])[1] as string

async function gj(a: Acct, u: string) {
  const r = await fetch(u, { headers: H(a) })
  if (r.status === 401) throw new Error(`Token ${a.email} kedaluwarsa, login ulang akun tersebut.`)
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function walk(a: Acct, id: string, path: string, jobs: Job[], res: Result, prog: Prog) {
  res.folders.add(a.email + '|' + path)
  let pt = ''
  do {
    const q = encodeURIComponent(`'${id}' in parents and trashed=false`)
    const j = await gj(a, `${API}?q=${q}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,imageMediaMetadata)${pt ? '&pageToken=' + pt : ''}`)
    for (const f of j.files) {
      if (f.mimeType === FOLDER) await walk(a, f.id, path + SEP + f.name, jobs, res, prog)
      else if (/^image\//.test(f.mimeType) || /\.(jpe?g|png|heic|heif|tiff?|bmp|webp)$/i.test(f.name)) jobs.push({ a, f, path, k: 'img' })
      else if (f.mimeType === 'application/vnd.google-apps.document') jobs.push({ a, f: { ...f, name: f.name + '.docx', gdoc: true }, path, k: 'doc' })
      else if (/\.(pdf|docx?|pptx|xlsx)$/i.test(f.name)) jobs.push({ a, f, path, k: 'doc' })
    }
    pt = j.nextPageToken
    prog(`Membaca struktur folder… ${jobs.length} file ditemukan`, 0)
  } while (pt)
}
export async function dl(a: Acct, id: string, range: boolean, gdoc = false): Promise<ArrayBuffer> {
  const u = gdoc ? `${API}/${id}/export?mimeType=application%2Fvnd.openxmlformats-officedocument.wordprocessingml.document` : `${API}/${id}?alt=media&supportsAllDrives=true`
  if (range) try { const r = await fetch(u, { headers: { ...H(a), Range: 'bytes=0-786431' } }); if (r.ok) return r.arrayBuffer() } catch { /* fallback */ }
  const r = await fetch(u, { headers: H(a) })
  if (!r.ok) throw new Error(String(r.status))
  return r.arrayBuffer()
}

export const XO: any = { tiff: true, ifd0: true, exif: true, gps: true, interop: true, xmp: true, iptc: true, icc: false, makerNote: false,
  userComment: true, translateKeys: true, translateValues: true, reviveValues: false, sanitize: true, mergeOutput: true }
const ft = (s: any) => (typeof s === 'string' ? s.replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3') : '')
export const js = (o: any) => JSON.stringify(o, (_k, v) => (ArrayBuffer.isView(v) ? `[bin ${v.byteLength}]` : v)).slice(0, 30000)
export const base = (j: Job, x: Row): Row => ({ akun: j.a.email, folder: j.path, nama: j.f.name, id: j.f.id, sumber: 'File', dokumen: '', ukuran_kb: Math.round((j.f.size || 0) / 1024), ...x })

export function exRow(j: Job, ex: any, m: any, extra: Row = {}): Row {
  ex = ex || {}; m = m || {}
  const lat = ex.latitude ?? m.location?.latitude, lon = ex.longitude ?? m.location?.longitude
  const ok = typeof lat === 'number' && typeof lon === 'number'
  const ts = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal', 'OffsetTime', 'SubSecTimeOriginal', 'GPSDateStamp', 'GPSTimeStamp']
    .filter(k => ex[k] != null).map(k => `${k}=${ex[k]}`).join('; ') || (m.time ? 'DriveTime=' + m.time : '')
  const ket = ['ImageDescription', 'UserComment', 'XPComment', 'XPTitle', 'XPSubject', 'Artist', 'Copyright', 'Software', 'title', 'description', 'Caption']
    .filter(k => ex[k]).map(k => `${k}=${ex[k]}`).join('; ')
  return base(j, { berkoordinat: ok ? 'YA' : 'TIDAK', status_koordinat: ok ? 'Ada (EXIF/GPS)' : 'Tidak ada', lat: ok ? lat : '', lon: ok ? lon : '', altitude: ex.GPSAltitude ?? m.location?.altitude ?? '', arah: ex.GPSImgDirection ?? '',
    waktu: ft(ex.DateTimeOriginal || ex.CreateDate || m.time || ''), detail_timestamp: ts,
    kamera: [ex.Make || m.cameraMake, ex.Model || m.cameraModel].filter(Boolean).join(' '), lensa: ex.LensModel || m.lens || '',
    lebar: ex.ExifImageWidth || m.width || '', tinggi: ex.ExifImageHeight || m.height || '', keterangan: ket,
    alamat: '', kelurahan: '', kecamatan: '', kota: '', provinsi: '', ocr_status: '', ocr_teks: '', ocr_waktu: '', ocr_koordinat: '', ocr_alamat: '', teks_sekitar: '', halaman: '', exif_lengkap: js(ex), ...extra })
}

async function procImg(j: Job, res: Result, ocr: Ocr) {
  const b = await dl(j.a, j.f.id, true); let ex: any = {}
  try { ex = (await exifr.parse(b, XO)) || {} } catch { /* tanpa exif */ }
  const r = exRow(j, ex, j.f.imageMediaMetadata)
  if (ocr !== 'off' && (ocr === 'all' || r.berkoordinat !== 'YA' || !r.waktu)) {
    try {
      const t = await ocrBuffer(await dl(j.a, j.f.id, false), j.f.mimeType || 'image/jpeg'); applyOcr(r, t)
      for (const w of extractRegion(t)) res.wilayah.push({ akun: j.a.email, folder: j.path, dokumen: j.f.name, sumber_teks: 'OCR foto', halaman: '', ...w })
    } catch (e: any) { r.ocr_error = String(e.message || e); r.ocr_status = 'Gagal OCR' }
  }
  res.rows.push(r)
}
async function geocode(rows: Row[], prog: Prog) {
  const cache: Record<string, Row> = {}, pts = rows.filter(r => r.lat !== ''); let n = 0
  for (const r of pts) {
    const k = (+r.lat).toFixed(4) + ',' + (+r.lon).toFixed(4)
    if (!cache[k]) {
      prog(`Alamat ${++n}… (${k})`, 60 + (n / pts.length) * 40)
      try {
        const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=id&lat=${r.lat}&lon=${r.lon}`)).json()
        const a = j.address || {}
        cache[k] = { alamat: j.display_name || '', kelurahan: a.village || a.suburb || a.neighbourhood || '', kecamatan: a.city_district || a.municipality || a.county || '',
          kota: a.city || a.regency || a.town || a.county || '', provinsi: a.state || '' }
      } catch { cache[k] = {} }
      await new Promise(s => setTimeout(s, 1100))
    }
    Object.assign(r, cache[k])
  }
}

export async function scanAll(accts: Acct[], opt: { geo: boolean; ocr: Ocr; ocrMax: number }, prog: Prog): Promise<Result> {
  const res: Result = { rows: [], docs: [], folders: new Set(), wilayah: [], teks: [] }, jobs: Job[] = []
  for (const a of accts.filter(x => x.on)) {
    const ids = a.folders.split('\n').map(folderId).filter(Boolean); if (!ids.length) ids.push('root')
    for (const id of ids) { const n = (await gj(a, `${API}/${id}?fields=name&supportsAllDrives=true`)).name; await walk(a, id, n, jobs, res, prog) }
  }
  let done = 0; const q = [...jobs]
  await Promise.all(Array(4).fill(0).map(async () => {
    while (q.length) {
      const j = q.shift()!
      try { j.k === 'img' ? await procImg(j, res, opt.ocr) : await procDoc(j, res, opt.ocr, opt.ocrMax) } catch (e: any) { res.rows.push(base(j, { lat: '', lon: '', berkoordinat: 'TIDAK', status_koordinat: 'Error', error: String(e.message || e) })) }
      prog(`Memproses ${++done}/${jobs.length}: ${j.f.name}`, (done / jobs.length) * 60)
    }
  }))
  if (opt.geo) await geocode(res.rows, prog)
  return res
}

/* ---------- Rekap ---------- */
export function folderSummary(r: Result): Row[] {
  const d: Record<string, number[]> = {}
  r.rows.forEach(x => { const k = x.akun + '|' + x.folder, a = (d[k] = d[k] || [0, 0, 0, 0]), o = x.sumber === 'File' ? 0 : 2; a[o]++; if (x.berkoordinat === 'YA') a[o + 1]++ })
  return [...r.folders].sort().map(k => {
    const i = k.indexOf('|'), ak = k.slice(0, i), p = k.slice(i + 1), s = [0, 0, 0, 0], own = d[k] || [0, 0, 0, 0]
    for (const kk in d) if (kk.startsWith(ak + '|')) { const pp = kk.slice(ak.length + 1); if (pp === p || pp.startsWith(p + SEP)) d[kk].forEach((v, n) => (s[n] += v)) }
    return { akun: ak, folder: p, level: p.split(SEP).length, foto_file_langsung: own[0], total_foto_file: s[0], file_berkoordinat: s[1], file_tanpa_koordinat: s[0] - s[1],
      foto_dalam_dokumen: s[2], dokumen_berkoordinat: s[3], dokumen_tanpa_koordinat: s[2] - s[3] }
  })
}
export function noCoord(r: Result): Row[] {
  const d: Record<string, string[]> = {}
  r.rows.filter(x => x.berkoordinat === 'TIDAK' && !x.error).forEach(x => { const k = x.akun + '|' + x.folder + (x.dokumen ? ` [dok: ${x.dokumen}]` : ''); (d[k] = d[k] || []).push(x.nama) })
  return Object.entries(d).map(([k, v]) => ({ akun: k.split('|')[0], folder_atau_dokumen: k.slice(k.indexOf('|') + 1), jumlah: v.length, daftar_file: v.join('; ').slice(0, 30000) }))
}
export function summary(r: Result): Row[] {
  const out: Row[] = [], yn = (x: Row) => (x.berkoordinat === 'YA' ? 'berkoordinat' : 'tanpa koordinat')
  const cnt = (g: string, f: (x: Row) => string) => { const m: Record<string, number> = {}; r.rows.forEach(x => { const k = f(x); m[k] = (m[k] || 0) + 1 }); Object.entries(m).sort().forEach(([k, v]) => out.push({ kelompok: g, kategori: k, jumlah: v })) }
  out.push({ kelompok: 'Total', kategori: 'Semua foto', jumlah: r.rows.length })
  cnt('Koordinat', x => (x.berkoordinat === 'YA' ? '✔ Berkoordinat' : '✖ Tanpa koordinat'))
  cnt('Status koordinat', x => x.status_koordinat); cnt('Sumber foto', x => x.sumber)
  cnt('Sumber × koordinat', x => x.sumber + ' – ' + yn(x)); cnt('Akun × koordinat', x => x.akun + ' – ' + yn(x))
  cnt('Cap waktu / timestamp', x => (x.waktu ? (String(x.waktu).startsWith('OCR') ? 'Terbaca dari OCR' : 'Terbaca dari EXIF') : 'Tidak terbaca'))
  cnt('Dokumen (foto di dalamnya)', x => (x.dokumen ? (x.dokumen.split('.').pop() + ' – ' + yn(x)) : '(bukan dokumen)')); 
  out.push({ kelompok: 'Dokumen', kategori: 'Jumlah dokumen dibaca', jumlah: r.docs.length }, { kelompok: 'Teks', kategori: 'Nama wilayah/luasan ditemukan', jumlah: r.wilayah.length })
  return out
}
export const datasets = (r: Result) => ({ ringkasan: summary(r), foto: r.rows, folder: folderSummary(r), nocoord: noCoord(r), docs: r.docs, wilayah: r.wilayah, teks: r.teks })
