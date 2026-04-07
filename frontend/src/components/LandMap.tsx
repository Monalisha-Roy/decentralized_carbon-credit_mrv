"use client";

import { useEffect, useRef, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Polygon,
    useMapEvents,
    Marker,
    Popup,
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
    for (let i = 0; i < coords.length; i++) {
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
    const [searchQuery, setSearchQuery] = useState("");
    const [undoStack, setUndoStack] = useState<[number, number][][]>([]);
    const [redoStack, setRedoStack] = useState<[number, number][][]>([]);
    const mapRef = useRef<any>(null);

    const handleClick = (latlng: [number, number]) => {
        if (finished) return;
        
        // Save current state to undo stack
        setUndoStack([...undoStack, points]);
        // Clear redo stack when adding new point
        setRedoStack([]);
        
        const newPoints = [...points, latlng];
        setPoints(newPoints);
        if (newPoints.length >= 3) {
            onPolygonChange(newPoints, calculateArea(newPoints));
        }
    };

    const handleDoubleClick = () => {
        if (points.length >= 3) {
            setFinished(true);
            onPolygonChange(points, calculateArea(points));
        }
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        
        const newUndoStack = [...undoStack];
        const previousPoints = newUndoStack.pop()!;
        
        setRedoStack([...redoStack, points]);
        setUndoStack(newUndoStack);
        setPoints(previousPoints);
        
        if (previousPoints.length >= 3) {
            onPolygonChange(previousPoints, calculateArea(previousPoints));
        } else {
            onPolygonChange(previousPoints, 0);
        }
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        
        const newRedoStack = [...redoStack];
        const nextPoints = newRedoStack.pop()!;
        
        setUndoStack([...undoStack, points]);
        setRedoStack(newRedoStack);
        setPoints(nextPoints);
        
        if (nextPoints.length >= 3) {
            onPolygonChange(nextPoints, calculateArea(nextPoints));
        } else {
            onPolygonChange(nextPoints, 0);
        }
    };

    const handleReset = () => {
        setPoints([]);
        setFinished(false);
        setUndoStack([]);
        setRedoStack([]);
        onPolygonChange([], 0);
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim() || !mapRef.current) return;

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`
            );
            const data = await response.json();
            
            if (data && data.length > 0) {
                const { lat, lon } = data[0];
                mapRef.current.setView([parseFloat(lat), parseFloat(lon)], 12);
                setSearchQuery("");
            } else {
                alert("Location not found. Try another search.");
            }
        } catch (error) {
            console.error("Search error:", error);
            alert("Error searching location");
        }
    };

    return (
        <div className="relative bg-gray-100 rounded-lg overflow-hidden">
            {/* Top Controls - Search Bar on Right */}
            <div className="absolute top-3 right-3 z-10">
                {/* Search Bar */}
                <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="🔍 Search location..."
                        className="px-3 py-1.5 rounded-lg bg-gray-300 text-black border border-gray-300 shadow-md text-xs font-medium focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <button
                        type="submit"
                        className="bg-green-600 text-white px-3 py-1.5 rounded-lg shadow-md hover:bg-green-700 transition font-medium text-xs"
                    >
                        Search
                    </button>
                </form>
            </div>

            {/* Map */}
            <MapContainer
                ref={mapRef}
                center={[26.5, 90.5]}
                zoom={10}
                style={{ height: "500px", width: "100%", zIndex: 0 }}
            >
                {/* Hybrid View: Satellite + Labels */}
                <>
                    <TileLayer
                        attribution='&copy; Esri, DigitalGlobe, GeoEye, Earthstar Geographics'
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    />
                    <TileLayer
                        attribution='&copy; Esri'
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                    />
                </>
                
                <ClickHandler
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                />

                {/* Polygon */}
                {points.length >= 3 && (
                    <Polygon
                        positions={points}
                        pathOptions={{
                            color: "#dc2626",
                            weight: 3,
                            opacity: 0.8,
                            fillColor: "#22c55e",
                            fillOpacity: 0.2,
                        }}
                    />
                )}

                {/* Point Markers */}
                {points.map((point, idx) => (
                    <Marker key={idx} position={point}>
                        <Popup>
                            <div className="text-sm font-medium">
                                Point {idx + 1}
                                <br />
                                {point[0].toFixed(4)}, {point[1].toFixed(4)}
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>

            {/* Bottom Controls */}
            <div className="absolute bottom-3 left-3 right-3 z-[1000] flex gap-2 justify-between items-end flex-wrap">
                <div className="bg-white rounded-lg shadow-md px-3 py-2 max-w-xs">
                    {!finished && points.length > 0 && (
                        <div className="text-xs font-medium text-gray-700">
                            📍 {points.length} points marked — double-click to finish drawing
                        </div>
                    )}
                    {finished && (
                        <div className="text-xs font-medium text-green-700">
                            ✅ Polygon complete and locked
                        </div>
                    )}
                    {points.length === 0 && (
                        <div className="text-xs font-medium text-gray-600">
                            Click on map to start drawing
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                    {points.length > 0 && !finished && (
                        <>
                            <button
                                onClick={handleUndo}
                                disabled={undoStack.length === 0}
                                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg shadow-md hover:bg-blue-700 transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                ↶ Undo
                            </button>
                            <button
                                onClick={handleRedo}
                                disabled={redoStack.length === 0}
                                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg shadow-md hover:bg-blue-700 transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                ↷ Redo
                            </button>
                        </>
                    )}
                    {points.length > 0 && (
                        <button
                            onClick={handleReset}
                            className="bg-red-600 text-white px-3 py-1.5 rounded-lg shadow-md hover:bg-red-700 transition font-medium text-xs"
                        >
                            ✕ Clear Map
                        </button>
                    )}
                </div>
            </div>

            {/* Legend */}
            <div className="absolute top-3 left-3 z-10 bg-white rounded-lg shadow-md p-2 text-xs max-w-xs">
                <p className="font-semibold text-gray-800 mb-1">📖 Drawing Guide:</p>
                <ul className="space-y-0.5 text-gray-700 text-xs">
                    <li>🖱️ Click map to place points</li>
                    <li>⏫ Double-click to finish</li>
                    <li>🔴 Red border = land boundary</li>
                    <li>🟢 Green fill = surveyed area</li>
                </ul>
            </div>
        </div>
    );
}