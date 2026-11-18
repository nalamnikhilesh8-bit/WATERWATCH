import { useEffect } from 'react'
import { latLngBounds } from 'leaflet'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'

function MapClick({ onSelect }) {
  useMapEvents({ click(event) { onSelect?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }) } })
  return null
}

function RecenterMap({ selected }) {
  const map = useMap()
  useEffect(() => {
    if (selected) map.setView([selected.latitude, selected.longitude], map.getZoom())
  }, [map, selected?.latitude, selected?.longitude])
  return null
}

function FitMap({ points }) {
  const map = useMap()
  const pointKey = points.map(([lat, lng]) => `${lat},${lng}`).join('|')
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], 15)
    else map.fitBounds(latLngBounds(points), { padding: [24, 24], maxZoom: 15 })
  }, [map, pointKey])
  return null
}

function ResizeMap() {
  const map = useMap()
  useEffect(() => {
    const target = map.getContainer().parentElement
    if (!target || !window.ResizeObserver) return undefined
    const observer = new window.ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(target)
    return () => observer.disconnect()
  }, [map])
  return null
}

export default function LeakMap({ reports = [], hotspots = [], selected, onSelect, exact = false, height = 360, zoom = 14, autoFit = false }) {
  const center = selected ? [selected.latitude, selected.longitude] : [17.385, 78.4867]
  const fitPoints = [
    ...reports.map((report) => report.location || { latitude: report.latitude, longitude: report.longitude }),
    ...hotspots,
  ].filter((point) => point.latitude != null && point.longitude != null).map((point) => [Number(point.latitude), Number(point.longitude)])
  return <div className="map-frame" style={{ height }}><MapContainer center={center} zoom={zoom} scrollWheelZoom={false} className="leaflet-map">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <ResizeMap />
    <RecenterMap selected={selected} />
    {autoFit && <FitMap points={fitPoints} />}
    <MapClick onSelect={onSelect} />
    {reports.map((report) => {
      const point = report.location || { latitude: report.latitude, longitude: report.longitude }
      if (point.latitude == null || point.longitude == null) return null
      const color = report.severity_level === 'CRITICAL' || report.severity_level === 'HIGH' ? '#df6f50' : '#e4a94e'
      return <CircleMarker key={report.id} center={[Number(point.latitude), Number(point.longitude)]} radius={report.status === 'IN_PROGRESS' ? 9 : 7} pathOptions={{ color, fillColor: color, fillOpacity: 0.82, weight: 2 }}>
        <Popup><strong>{report.title}</strong><br />{report.status?.replaceAll('_', ' ').toLowerCase()} · {report.severity_level?.toLowerCase() || 'open'}</Popup>
      </CircleMarker>
    })}
    {hotspots.map((hotspot, index) => <CircleMarker key={`hotspot-${index}`} center={[hotspot.latitude, hotspot.longitude]} radius={16} pathOptions={{ color: '#da6b50', fillColor: '#e8866b', fillOpacity: 0.13, weight: 3, className: 'hotspot-marker' }}>
      <Popup><strong>Recurring hotspot</strong><br />{hotspot.report_count} reports within roughly 150 m</Popup>
    </CircleMarker>)}
    {selected && onSelect && <CircleMarker center={center} radius={9} pathOptions={{ color: '#0c5962', fillColor: '#1d8790', fillOpacity: 0.95, weight: 3 }}><Popup>Selected report location</Popup></CircleMarker>}
  </MapContainer></div>
}
