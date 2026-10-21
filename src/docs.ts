import JSZip from 'jszip'
import exifr from 'exifr'
import * as pdfjs from 'pdfjs-dist'
import worker from 'pdfjs-dist/build/pdf.worker.min.js?url'
import { Job, Result, XO, js, exRow, dl } from './scan'
import { tcoords, setCoord, applyOcr, extractRegion, isRel, rawJpegs, ocrCanvas, ocrBuffer } from './analyze'
pdfjs.GlobalWorkerOptions.workerSrc = worker

interface Img { label: string; ex: any; hal: string; ctx: string; cv?: HTMLCanvasElement | null; buf?: ArrayBuffer }
const MAXOCR = 40

function getObj(pg: any, name: string): Promise<any> {
  return new Promise(res => { try { (name.startsWith('g_') ? pg.commonObjs : pg.objs).get(name, res) } catch { res(null) } setTimeout(() => res(null), 4000) })
}
function toCanvas(img: any): HTMLCanvasElement | null {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d')!
  if (img.bitmap) { x.drawImage(img.bitmap, 0, 0); return c }
  const n = img.width * img.height, d = img.data; if (!d) return null
  const o = x.createImageData(img.width, img.height)
  if (d.length === n * 4) o.data.set(d)
  else if (d.length === n * 3) for (let i = 0, k = 0; i < n; i++) { o.data[k++] = d[i * 3]; o.data[k++] = d[i * 3 + 1]; o.data[k++] = d[i * 3 + 2]; o.data[k++] = 255 }
  else return null
  x.putImageData(o, 0, 0); return c
}
const strip = (x: string) => x.replace(/<\/(w:p|a:p)>/g, '\n').replace(/<w:tab\/>/g, ' ').replace(/<[^>]+>/g, '')

export async function procDoc(j: Job, res: Result, ocr: string) {
  const ext = j.f.name.split('.').pop()!.toLowerCase(), b = await dl(j.a, j.f.id, false, j.f.gdoc)
  let meta: any = {}, note = '', small = 0, rawEx = 0, cnt = 0, cntC = 0, ocrN = 0
  const seen = new Set<string>(), who = { akun: j.a.email, folder: j.path, dokumen: j.f.name }

  const addText = (hal: string, t: string) => {
    t = t.replace(/[ \t]+/g, ' ').trim(); if (!t) return
    res.teks.push({ ...who, tipe: ext, halaman: hal, relevan: isRel(t) ? 'YA' : 'TIDAK', teks: t.slice(0, 30000) })
    for (const w of extractRegion(t)) { const k = hal + w.jenis + w.nama + w.nilai + w.satuan; if (!seen.has(k)) { seen.add(k); res.wilayah.push({ ...who, sumber_teks: 'Teks dokumen', halaman: hal, ...w }) } }
  }
  const emit = async (m: Img) => {
    const r = exRow(j, m.ex, null, { sumber: 'Dalam dokumen', dokumen: j.f.name, nama: `${j.f.name} › ${m.label}`, halaman: m.hal, teks_sekitar: m.ctx.slice(0, 300) })
    if (r.berkoordinat !== 'YA') { const c = tcoords(m.ctx)[0]; if (c) setCoord(r, c[0], c[1], 'Dari teks sekitar foto') }
    if ((m.cv || m.buf) && ocr !== 'off' && ocrN < MAXOCR && (ocr === 'all' || r.berkoordinat !== 'YA' || !r.waktu)) {
      ocrN++
      try {
        const t = m.cv ? await ocrCanvas(m.cv) : await ocrBuffer(m.buf!); applyOcr(r, t)
        for (const w of extractRegion(t)) res.wilayah.push({ ...who, sumber_teks: 'OCR foto', halaman: m.hal, ...w })
      } catch (e: any) { r.ocr_error = String(e.message || e) }
    }
    cnt++; if (r.berkoordinat === 'YA') cntC++; res.rows.push(r)
  }
  const exOf = async (buf: ArrayBuffer) => { try { return (await exifr.parse(buf, XO)) || null } catch { return null } }

  if (ext === 'pdf') {
    const raws = rawJpegs(b), used = new Set<number>(), O = pdfjs.OPS as any
    const p = await pdfjs.getDocument({ data: new Uint8Array(b.slice(0)) }).promise
    try { meta = (await p.getMetadata()).info } catch { /* */ }
    for (let i = 1; i <= p.numPages; i++) {
      const pg = await p.getPage(i), t = (await pg.getTextContent()).items.map((x: any) => x.str).join(' ')
      addText('hal. ' + i, t)
      const ol = await pg.getOperatorList(), names = new Set<string>(); let inl = 0
      ol.fnArray.forEach((f: number, k: number) => {
        if (f === O.paintImageXObject || f === O.paintJpegXObject) names.add(ol.argsArray[k][0])
        else if (f === O.paintInlineImageXObject) names.add('inline' + inl++)
      })
      let n = 0
      for (const nm of names) {
        const im = nm.startsWith('inline') ? null : await getObj(pg, nm), w = im?.width || 0, h = im?.height || 0
        if (im && (w < 100 || h < 100)) { small++; continue }   // ikon/logo/garis
        n++; let ex: any = null
        const ri = w ? raws.findIndex((r, q) => !used.has(q) && r.w === w && r.h === h) : -1
        if (ri >= 0) { used.add(ri); ex = await exOf(b.slice(raws[ri].off, raws[ri].off + 262144)); if (ex?.latitude != null || ex?.DateTimeOriginal) rawEx++ }
        await emit({ label: `hal.${i} foto#${n}${w ? ` (${w}x${h})` : ''}`, ex, hal: 'hal. ' + i, ctx: t, cv: im ? toCanvas(im) : null })
      }
    }
  } else if (ext === 'doc') {
    note = 'DOC biner: teks dibaca best-effort; simpan sebagai DOCX untuk hasil akurat.'
    const raws = rawJpegs(b).filter(r => r.w >= 100 && r.h >= 100)
    for (let k = 0; k < raws.length; k++) {
      const end = raws[k + 1]?.off ?? b.byteLength, ex = await exOf(b.slice(raws[k].off, raws[k].off + 262144))
      if (ex?.latitude != null) rawEx++
      await emit({ label: `foto#${k + 1} (${raws[k].w}x${raws[k].h})`, ex, hal: '-', ctx: '', buf: b.slice(raws[k].off, end) })
    }
    const runs = new Set<string>()
    for (const enc of ['windows-1252', 'utf-16le']) for (const m of new TextDecoder(enc).decode(b).matchAll(/[\x20-\x7E]{6,}/g)) runs.add(m[0])
    addText('teks doc', [...runs].join('\n'))
  } else {
    const z = await JSZip.loadAsync(b), rd = (n: string) => z.file(n)?.async('string')
    const core = await rd('docProps/core.xml')
    if (core) meta = Object.fromEntries([...core.matchAll(/<(?:dc|cp|dcterms):(\w+)[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]))
    if (ext === 'docx') {
      const doc = (await rd('word/document.xml')) || '', rel: Record<string, string> = {}
      for (const t of ((await rd('word/_rels/document.xml.rels')) || '').match(/<Relationship\b[^>]*>/g) || []) {
        const id = /Id="([^"]+)"/.exec(t)?.[1], tg = /Target="([^"]+)"/.exec(t)?.[1]; if (id && tg) rel[id] = tg
      }
      const paras = doc.split('</w:p>'), txt = paras.map(s => strip(s).trim())
      txt.forEach((t, i) => addText('paragraf ' + (i + 1), t))
      for (let i = 0; i < paras.length; i++)
        for (const m of paras[i].matchAll(/<(?:a:blip|v:imagedata)\b[^>]*?r:(?:embed|id)="([^"]+)"/g)) {
          const f = rel[m[1]] && z.file('word/' + rel[m[1]].replace(/^\.?\//, '')); if (!f) continue
          const dp = /<wp:docPr\b[^>]*>/.exec(paras[i])?.[0] || '', alt = [/descr="([^"]*)"/.exec(dp)?.[1], /title="([^"]*)"/.exec(dp)?.[1]].filter(Boolean).join('; ')
          const cap = [txt[i], txt[i + 1], txt[i + 2]].find(Boolean) || '', buf = await f.async('arraybuffer')
          await emit({ label: rel[m[1]].split('/').pop()! + (alt ? ` [${alt.slice(0, 60)}]` : ''), ex: await exOf(buf), hal: 'paragraf ' + (i + 1), ctx: (alt ? alt + '. ' : '') + cap, buf })
        }
      for (const n of Object.keys(z.files)) if (/^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(n)) addText(n.slice(5, -4), strip((await rd(n)) || ''))
    } else {
      for (const n of Object.keys(z.files)) {
        if (/^(ppt|xl)\/media\/.+\.(jpe?g|png|tiff?|bmp|gif|webp)$/i.test(n)) { const buf = await z.files[n].async('arraybuffer'); await emit({ label: n.split('/').pop()!, ex: await exOf(buf), hal: n.split('/')[0], ctx: '', buf }) }
        else if (/^ppt\/slides\/slide\d+\.xml$/.test(n)) addText('slide ' + /\d+/.exec(n.split('/').pop()!)![0], strip((await rd(n)) || ''))
        else if (n === 'xl/sharedStrings.xml') addText('sheet', strip((await rd(n)) || ''))
      }
    }
  }
  const mine = res.wilayah.filter(w => w.dokumen === j.f.name && w.folder === j.path)
  res.docs.push({ ...who, nama: j.f.name, tipe: ext, jumlah_foto: cnt, foto_berkoordinat: cntC, foto_tanpa_koordinat: cnt - cntC, foto_kecil_diabaikan: small,
    jpeg_exif_utuh: rawEx, jumlah_nama_wilayah: mine.filter(w => !w.nilai).length, jumlah_luasan: mine.filter(w => w.nilai).length, metadata: js(meta).slice(0, 2000), catatan: note })
}
