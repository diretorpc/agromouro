'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet'
import type { LatLngBounds } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Talhao } from '@/lib/types'

const CORES = [
  '#5B8C2A', '#8FB840', '#3A6B10', '#7BAA30', '#4A7A20',
  '#2E5A08', '#6A9E28', '#9DC848', '#1E4A00', '#5C8A1E',
]

const STATUS_FILL_OPACITY: Record<Talhao['status'], number> = {
  ativo: 0.35,
  pousio: 0.25,
  colhido: 0.15,
}

function FitBounds({ bounds }: { bounds: LatLngBounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] })
  }, [map, bounds])
  return null
}

interface Props {
  talhoes: Talhao[]
}

export default function MapaTalhoes({ talhoes }: Props) {
  const comCoordenadas = talhoes.filter(t => t.coordenadas && t.coordenadas.length > 2)

  // Calcula bounds globais para centralizar o mapa
  const allPoints = comCoordenadas.flatMap(t => t.coordenadas!)
  const L = require('leaflet') as typeof import('leaflet')
  const bounds = L.latLngBounds(allPoints)

  if (comCoordenadas.length === 0) return null

  return (
    <MapContainer
      center={[-20, -50]}
      zoom={13}
      className="h-[480px] w-full rounded-xl z-0"
      scrollWheelZoom
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, GeoEye, Earthstar Geographics"
        maxZoom={19}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
        attribution=""
        maxZoom={19}
        opacity={0.6}
      />
      {comCoordenadas.map((talhao, i) => (
        <Polygon
          key={talhao.id}
          positions={talhao.coordenadas!}
          pathOptions={{
            color: CORES[i % CORES.length],
            fillColor: CORES[i % CORES.length],
            fillOpacity: STATUS_FILL_OPACITY[talhao.status],
            weight: 2,
          }}
        >
          <Tooltip sticky>
            <span className="font-semibold">{talhao.nome}</span>
            <br />
            {talhao.area_ha} ha · {talhao.status}
            {talhao.cultura_atual && <><br />{talhao.cultura_atual}</>}
          </Tooltip>
        </Polygon>
      ))}
      {bounds.isValid() && <FitBounds bounds={bounds} />}
    </MapContainer>
  )
}
