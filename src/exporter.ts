import * as XLSX from 'xlsx'
import { datasets, Result } from './scan'
export const SHEETS = { ringkasan: 'Ringkasan', foto: 'Rekap Foto', folder: 'Rekap Folder', nocoord: 'Tanpa Koordinat', docs: 'Dokumen', wilayah: 'Wilayah & Luasan', teks: 'Teks Dokumen' } as const
export function exportXlsx(r: Result) {
  const d = datasets(r), wb = XLSX.utils.book_new()
  ;(Object.keys(SHEETS) as (keyof typeof SHEETS)[]).forEach(k => { const ws = XLSX.utils.json_to_sheet(d[k]); if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }; XLSX.utils.book_append_sheet(wb, ws, SHEETS[k]) })
  XLSX.writeFile(wb, 'rekap-foto-drive.xlsx')
}
export function exportCsv(r: Result, k: keyof typeof SHEETS) {
  const s = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(datasets(r)[k])), a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\ufeff' + s], { type: 'text/csv' })); a.download = `rekap-${k}.csv`; a.click()
}
