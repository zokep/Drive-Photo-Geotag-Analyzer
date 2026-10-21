import { useMemo, useState } from 'react'
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google'
import { Acct, Ocr, Result, Row, scanAll, datasets } from './scan'
import { exportXlsx, exportCsv, SHEETS } from './exporter'
import MapView from './MapView'

const CID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email'
type Tab = 'peta' | keyof typeof SHEETS
const LBL: Record<Tab, string> = { peta: '🗺 Peta', ringkasan: 'Ringkasan', foto: 'Foto', folder: 'Folder', nocoord: 'Tanpa koordinat', docs: 'Dokumen', wilayah: 'Wilayah & Luasan', teks: 'Teks Dokumen' }
const EMPTY: Result = { rows: [], docs: [], folders: new Set(), wilayah: [], teks: [] }

function Table({ data }: { data: Row[] }) {
  const cols = data.length ? Object.keys(data[0]).filter(c => c !== 'exif_lengkap') : []
  const cls = (c: string, v: any) => (c === 'berkoordinat' ? (v === 'YA' ? 'ok' : 'no') : c === 'status_koordinat' ? (v === 'Tidak ada' || v === 'Error' ? 'no' : 'ok') : undefined)
  return (
    <div className="tw"><table><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{data.slice(0, 500).map((r, i) => (
        <tr key={i} className={r.berkoordinat === 'YA' ? 'ya' : r.berkoordinat === 'TIDAK' ? 'no' : ''}>
          {cols.map(c => <td key={c} className={cls(c, r[c])} title={String(r[c] ?? '')}>{c === 'berkoordinat' ? (r[c] === 'YA' ? '✔ YA' : '✖ TIDAK') : String(r[c] ?? '')}</td>)}</tr>))}</tbody></table>
      {data.length > 500 && <div className="m" style={{ padding: 8 }}>Menampilkan 500 dari {data.length} baris — ekspor untuk data lengkap.</div>}
    </div>
  )
}

function Inner() {
  const [accts, setAccts] = useState<Acct[]>([])
  const [res, setRes] = useState<Result>(EMPTY)
  const [tab, setTab] = useState<Tab>('peta')
  const [geo, setGeo] = useState(true)
  const [ocr, setOcr] = useState<Ocr>('missing')
  const [fk, setFk] = useState('semua'), [fs, setFs] = useState('semua'), [q, setQ] = useState('')
  const [busy, setBusy] = useState(false), [st, setSt] = useState('Belum berjalan.'), [pct, setPct] = useState(0)

  const login = useGoogleLogin({
    flow: 'implicit', prompt: 'select_account', scope: SCOPE,
    onSuccess: async r => {
      const u = await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + r.access_token } })).json()
      setAccts(p => p.some(x => x.email === u.email) ? p.map(x => (x.email === u.email ? { ...x, token: r.access_token } : x)) : [...p, { email: u.email, token: r.access_token, folders: '', on: true }])
    },
    onError: () => alert('Login gagal atau popup diblokir browser. Izinkan popup untuk situs ini.'),
  })
  const upd = (i: number, p: Partial<Acct>) => setAccts(a => a.map((x, k) => (k === i ? { ...x, ...p } : x)))

  async function scan() {
    setBusy(true)
    try {
      const r = await scanAll(accts, { geo, ocr }, (t, p) => { setSt(t); if (p) setPct(p) })
      setRes(r); setPct(100); setSt(`Selesai: ${r.rows.length} foto, ${r.docs.length} dokumen, ${r.wilayah.length} temuan wilayah/luasan.`)
    } catch (e: any) { setSt('Error: ' + e.message) }
    setBusy(false)
  }
  const d = useMemo(() => datasets(res), [res])
  const S = useMemo(() => { const R = res.rows, y = R.filter(x => x.berkoordinat === 'YA').length
    return { total: R.length, y, n: R.length - y, file: R.filter(x => x.sumber === 'File').length, dok: R.filter(x => x.sumber !== 'File').length, wk: R.filter(x => x.waktu).length } }, [res])
  const rows = useMemo(() => {
    if (tab === 'peta') return []
    let a = d[tab] as Row[]
    if (tab === 'foto') a = a.filter(r => (fk === 'semua' || r.berkoordinat === fk) && (fs === 'semua' || (fs === 'File') === (r.sumber === 'File')))
    const ql = q.trim().toLowerCase()
    return ql ? a.filter(r => Object.entries(r).some(([k, v]) => k !== 'exif_lengkap' && String(v).toLowerCase().includes(ql))) : a
  }, [d, tab, fk, fs, q])
  const go = (t: Tab, k = 'semua', s = 'semua') => { setTab(t); setFk(k); setFs(s) }

  return (
    <div className="wrap">
      <h1>📍 Drive Photo Auditor</h1>
      <div className="card">
        <b>1. Akun Google</b>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="p" onClick={() => login()}>+ Login akun Google (popup)</button>
          <span className="m">Klik lagi untuk menambah akun lain di browser yang sama.</span>
        </div>
        {accts.map((a, i) => (
          <div className="acc" key={a.email}>
            <label><input type="checkbox" checked={a.on} onChange={e => upd(i, { on: e.target.checked })} /> <b>{a.email}</b></label>
            <textarea value={a.folders} onChange={e => upd(i, { folders: e.target.value })} placeholder="Link/ID folder (satu per baris). Kosong = seluruh My Drive" />
          </div>))}
      </div>
      <div className="card">
        <b>2. Pindai</b>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="p" disabled={busy || !accts.length} onClick={scan}>Mulai pindai</button>
          <label><input type="checkbox" checked={geo} onChange={e => setGeo(e.target.checked)} /> Alamat dari koordinat (OSM)</label>
          <label>OCR cap waktu/teks pada gambar:{' '}
            <select value={ocr} onChange={e => setOcr(e.target.value as Ocr)}>
              <option value="off">Mati (cepat)</option><option value="missing">Hanya foto tanpa koordinat/waktu EXIF</option><option value="all">Semua foto (lambat)</option>
            </select></label>
        </div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div><div className="m">{st}</div>
      </div>

      {S.total > 0 && (
        <div className="stats">
          <div className="stat" onClick={() => go('foto')}>Total foto<b>{S.total}</b><span className="m">{S.file} file · {S.dok} dalam dokumen</span></div>
          <div className="stat ok" onClick={() => go('foto', 'YA')}>✔ Berkoordinat<b>{S.y}</b></div>
          <div className="stat no" onClick={() => go('foto', 'TIDAK')}>✖ Tanpa koordinat<b>{S.n}</b></div>
          <div className="stat or" onClick={() => go('foto', 'semua', 'dok')}>Foto dalam dokumen<b>{S.dok}</b><span className="m">{res.docs.length} dokumen</span></div>
          <div className="stat" onClick={() => go('foto')}>Cap waktu terbaca<b>{S.wk}</b><span className="m">dari {S.total} foto</span></div>
          <div className="stat" onClick={() => go('wilayah')}>Wilayah & luasan<b>{res.wilayah.length}</b></div>
        </div>)}

      <div className="card">
        <div className="row">
          <button className="p" onClick={() => exportXlsx(res)}>⬇ XLSX (semua sheet)</button>
          {(Object.keys(SHEETS) as (keyof typeof SHEETS)[]).map(k => <button key={k} onClick={() => exportCsv(res, k)}>CSV {SHEETS[k]}</button>)}
        </div>
        <div className="row" style={{ margin: '12px 0' }}>
          {(Object.keys(LBL) as Tab[]).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{LBL[k]}{k !== 'peta' && d[k].length ? ` (${d[k].length})` : ''}</button>)}
        </div>
        {tab === 'peta' ? (
          <>
            <div className="m leg" style={{ marginBottom: 6 }}><i style={{ background: '#1a9a4a' }} />EXIF/GPS<i style={{ background: '#e8590c' }} />dari teks/OCR/dokumen
              <b style={{ marginLeft: 12, color: '#d93025' }}>{S.n} foto tanpa koordinat tidak tampil di peta</b></div>
            <MapView rows={res.rows} />
          </>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <input placeholder="Cari (nama, folder, wilayah, teks…)" value={q} onChange={e => setQ(e.target.value)} />
              {tab === 'foto' && <>
                <select value={fk} onChange={e => setFk(e.target.value)}><option value="semua">Semua koordinat</option><option value="YA">✔ Berkoordinat</option><option value="TIDAK">✖ Tanpa koordinat</option></select>
                <select value={fs} onChange={e => setFs(e.target.value)}><option value="semua">Semua sumber</option><option value="File">File foto</option><option value="dok">Dalam dokumen</option></select></>}
              <span className="m">{rows.length} baris</span>
            </div>
            <Table data={rows} />
          </>)}
      </div>
    </div>
  )
}

export default function App() {
  if (!CID) return <div className="wrap"><div className="card">Isi <code>VITE_GOOGLE_CLIENT_ID</code> di file <code>.env</code> (lihat <code>.env.example</code>) lalu jalankan ulang.</div></div>
  return <GoogleOAuthProvider clientId={CID}><Inner /></GoogleOAuthProvider>
}
