"use client";

import { useEffect, useRef, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Polygon,
    useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix leaflet default icon issue in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Calculate area in hectares from polygon coordinates
function calculateArea(coords: [number, number][]): number {
    if (coords.length < 3) return 0;
    const R = 6371000; // Earth radius in metres
    let area = 0;
    for (let i = 0; i < coords.length; i++ ) {
        const [lat1, lng1] = coords[i];
        const [lat2, lng2] = coords[(i + 1) % coords.length];
        const phi1 = (lat1 * Math.PI) / 180;
        const phi2 = (lat2 * Math.PI) / 180;
        area += (((lng2 - lng1) * Math.PI) / 180) * (2 + Math.sin(phi1) + Math.sin(phi2));
    }
    area = Math.abs((area * R * R) / 2);
    return area / 10000; // convert m2 to hectares
}

interface ClickHandlerProps {
    onClick: (latlng: [number, number]) => void;
    onDoubleClick: () => void;
}

function ClickHandler({ onClick, onDoubleClick }: ClickHandlerProps) {
    useMapEvents({
        click(e) {
            onClick([e.latlng.lat, e.latlng.lng]);
        },
        dblclick() {
            onDoubleClick();
        },
    });
    return null;
}

interface LandMapProps {
    onPolygonChange: (coords: [number, number][], area: number) => void;
}

export default function LandMap({ onPolygonChange }: LandMapProps) {
    const [points, setPoints] = useState<[number, number][]>([]);
    const [finished, setFinished] = useState(false);

    const handleClick = (latlng: [number, number]) => {
        if (finished) return;
        const newPoints = [...points, latlng];
        setPoints(newPoints);
        if(newPoints.length >= 3) {
            onPolygonChange(newPoints, calculateArea(newPoints));
        }
    };

    const handleDoubleClick = () => {
        if (points.length >= 3) {
            setFinished(true);
            onPolygonChange(points, calculateArea(points));
        }
    };

    const handleReset = () => {
        setPoints([]);
        setFinished(false);
        onPolygonChange([], 0);
    };

    return (
    <div className="relative">
      <MapContainer
        center={[26.5, 90.5]} // centered on Assam, Northeast India
        zoom={10}
        style={{ height: "400px", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
        {points.length >= 3 && (
          <Polygon
            positions={points}
            pathOptions={{ color: "green", fillOpacity: 0.3 }}
          />
        )}
      </MapContainer>

      <div className="absolute top-2 right-2 z-[1000] flex gap-2">
        <button
          onClick={handleReset}
          className="bg-white text-red-600 border border-red-300 px-3 py-1 rounded shadow text-sm font-medium hover:bg-red-50"
        >
          Reset
        </button>
      </div>

      {!finished && points.length > 0 && (
        <div className="absolute bottom-2 left-2 z-[1000] bg-white px-3 py-1 rounded shadow text-sm text-gray-600">
          {points.length} points — double-click to finish
        </div>
      )}
    </div>
  );
}