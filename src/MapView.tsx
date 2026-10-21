import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { Row } from './scan'
const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
export default function MapView({ rows }: { rows: Row[] }) {
  const el = useRef<HTMLDivElement>(null), map = useRef<L.Map>(), layer = useRef<L.LayerGroup>()
  useEffect(() => {
    if (!map.current) {
      map.current = L.map(el.current!).setView([-2.5, 118], 5)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map.current)
      layer.current = L.layerGroup().addTo(map.current)
    }
    layer.current!.clearLayers(); const pts: L.LatLngTuple[] = []
    rows.filter(r => r.lat !== '').forEach(r => {
      const p: L.LatLngTuple = [+r.lat, +r.lon]; pts.push(p)
      L.circleMarker(p, { radius: 6, color: r.status_koordinat === 'Ada (EXIF/GPS)' ? '#1a9a4a' : '#e8590c', fillOpacity: 0.7 }).addTo(layer.current!)
        .bindPopup(`<b>${esc(r.nama)}</b><br>${esc(r.folder)}<br>${esc(r.waktu)}<br>${esc(r.alamat)}<br>${r.lat}, ${r.lon}`)
    })
    if (pts.length) map.current.fitBounds(pts, { padding: [30, 30], maxZoom: 17 })
  }, [rows])
  return <div ref={el} className="map" />
}
