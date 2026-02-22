/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Play, Square, Pause, Heart, Navigation, Activity, Battery, Signal, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Point {
  lat: number;
  lng: number;
  alt: number | null;
  timestamp: number;
  speed: number | null;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function generateGPX(points: Point[]) {
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="Web Wear OS Hiking App">\n';
  gpx += '  <trk>\n';
  gpx += '    <name>Hiking Session</name>\n';
  gpx += '    <trkseg>\n';
  points.forEach(p => {
    gpx += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
    if (p.alt) gpx += `        <ele>${p.alt}</ele>\n`;
    gpx += `        <time>${new Date(p.timestamp).toISOString()}</time>\n`;
    gpx += `      </trkpt>\n`;
  });
  gpx += '    </trkseg>\n';
  gpx += '  </trk>\n';
  gpx += '</gpx>';
  return gpx;
}

const customIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="#3b82f6"/></svg>'),
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
}

export default function App() {
  const [status, setStatus] = useState<'idle' | 'active' | 'paused' | 'summary'>('idle');
  const [points, setPoints] = useState<Point[]>([]);
  const [distance, setDistance] = useState(0); // km
  const [elapsedTime, setElapsedTime] = useState(0); // seconds
  const [elevationGain, setElevationGain] = useState(0); // meters
  const [maxAltitude, setMaxAltitude] = useState(0); // meters
  const [currentSpeed, setCurrentSpeed] = useState(0); // km/h
  const [avgSpeed, setAvgSpeed] = useState(0); // km/h
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [gpsSignal, setGpsSignal] = useState<'good' | 'fair' | 'poor' | 'none'>('none');
  const [calories, setCalories] = useState(0);
  const [screenIndex, setScreenIndex] = useState(0); // 0: Map, 1: Stats

  // Battery
  useEffect(() => {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    } else {
      setBatteryLevel(100);
    }
  }, []);

  // GPS Tracking
  useEffect(() => {
    let watchId: number;
    if (status === 'active') {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, altitude, speed, accuracy } = position.coords;
          
          if (accuracy < 20) setGpsSignal('good');
          else if (accuracy < 50) setGpsSignal('fair');
          else setGpsSignal('poor');

          const newPoint: Point = {
            lat: latitude,
            lng: longitude,
            alt: altitude,
            timestamp: position.timestamp,
            speed: speed,
          };

          setPoints(prev => {
            if (prev.length > 0) {
              const lastPoint = prev[prev.length - 1];
              const dist = haversine(lastPoint.lat, lastPoint.lng, newPoint.lat, newPoint.lng);
              setDistance(d => d + dist);
              
              if (newPoint.alt && lastPoint.alt && newPoint.alt > lastPoint.alt) {
                setElevationGain(e => e + (newPoint.alt! - lastPoint.alt!));
              }
            }
            if (newPoint.alt && newPoint.alt > maxAltitude) {
              setMaxAltitude(newPoint.alt);
            }
            return [...prev, newPoint];
          });

          if (speed !== null) {
            setCurrentSpeed(speed * 3.6);
          }
        },
        (error) => {
          console.error("GPS Error", error);
          setGpsSignal('none');
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }

    return () => {
      if (watchId !== undefined) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [status, maxAltitude]);

  // Timer & Calories
  useEffect(() => {
    let interval: number;
    if (status === 'active') {
      interval = window.setInterval(() => {
        setElapsedTime(t => {
          const newTime = t + 1;
          setCalories(Math.round(6.0 * 70 * (newTime / 3600)));
          return newTime;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [status]);

  // Avg Speed
  useEffect(() => {
    if (elapsedTime > 0) {
      setAvgSpeed(distance / (elapsedTime / 3600));
    }
  }, [distance, elapsedTime]);

  const connectHeartRate = async () => {
    const startSimulated = () => {
      setHeartRate(85);
      setInterval(() => {
        setHeartRate(prev => prev ? prev + (Math.floor(Math.random() * 5) - 2) : 85);
      }, 2000);
    };

    if (!('bluetooth' in navigator)) {
      startSimulated();
      return;
    }
    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }]
      });
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService('heart_rate');
      const characteristic = await service?.getCharacteristic('heart_rate_measurement');
      await characteristic?.startNotifications();
      characteristic?.addEventListener('characteristicvaluechanged', (event: any) => {
        const value = event.target.value;
        const flags = value.getUint8(0);
        const rate16Bits = flags & 0x1;
        let hr = 0;
        if (rate16Bits) {
          hr = value.getUint16(1, true);
        } else {
          hr = value.getUint8(1);
        }
        setHeartRate(hr);
      });
    } catch (e) {
      // Fallback to simulated heart rate if bluetooth is denied by permissions policy or user
      startSimulated();
    }
  };

  const handleStart = () => {
    if (!heartRate) connectHeartRate();
    setStatus('active');
  };

  const currentPos = points.length > 0 ? [points[points.length - 1].lat, points[points.length - 1].lng] as [number, number] : null;

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center font-sans text-white p-4">
      
      <div className="mb-8 text-center max-w-md">
        <h1 className="text-2xl font-bold mb-2">Wear OS Simulator</h1>
        <p className="text-zinc-400 text-sm">
          Native Android/Kotlin code cannot be compiled in this web environment. 
          This is a web-based prototype replicating the requested Wear OS hiking app functionality using React, Leaflet, and Web APIs (Geolocation, Bluetooth).
        </p>
      </div>

      <div className="relative w-[320px] h-[320px] rounded-full bg-black overflow-hidden border-[16px] border-zinc-800 shadow-2xl ring-1 ring-zinc-700">
        <AnimatePresence mode="wait">
          {status === 'summary' ? (
            <motion.div 
              key="summary"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-full bg-zinc-900 flex flex-col items-center justify-center p-6 text-center"
            >
              <h2 className="text-lg font-bold text-emerald-400 mb-2">Session Saved</h2>
              
              <div className="grid grid-cols-2 gap-2 text-sm w-full max-w-[200px] mb-4">
                <div className="flex flex-col">
                  <span className="text-zinc-400 text-[10px] uppercase">Distance</span>
                  <span className="font-mono font-bold">{distance.toFixed(2)} km</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-zinc-400 text-[10px] uppercase">Time</span>
                  <span className="font-mono font-bold">{formatTime(elapsedTime)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-zinc-400 text-[10px] uppercase">Avg Speed</span>
                  <span className="font-mono font-bold">{avgSpeed.toFixed(1)} km/h</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-zinc-400 text-[10px] uppercase">Calories</span>
                  <span className="font-mono font-bold">{calories} kcal</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    const gpx = generateGPX(points);
                    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `hike-${new Date().toISOString().slice(0,10)}.gpx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }} 
                  className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-700"
                >
                  <Download size={16} />
                </button>
                <button 
                  onClick={() => {
                    setStatus('idle');
                    setPoints([]);
                    setDistance(0);
                    setElapsedTime(0);
                    setElevationGain(0);
                    setMaxAltitude(0);
                    setCalories(0);
                    setScreenIndex(0);
                  }} 
                  className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center hover:bg-zinc-700"
                >
                  <Square fill="currentColor" size={16} />
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="main"
              className="flex w-[640px] h-full"
              animate={{ x: screenIndex === 0 ? 0 : -320 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              drag="x"
              dragConstraints={{ left: -320, right: 0 }}
              onDragEnd={(e, { offset }) => {
                if (offset.x < -50) setScreenIndex(1);
                if (offset.x > 50) setScreenIndex(0);
              }}
            >
              {/* Map Screen */}
              <div className="w-[320px] h-[320px] relative shrink-0">
                <MapContainer 
                  center={currentPos || [51.505, -0.09]} 
                  zoom={15} 
                  zoomControl={false} 
                  attributionControl={false}
                  className="w-full h-full"
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {currentPos && <MapUpdater center={currentPos} />}
                  {currentPos && <Marker position={currentPos} icon={customIcon} />}
                  {points.length > 1 && (
                    <Polyline positions={points.map(p => [p.lat, p.lng])} color="#ef4444" weight={4} />
                  )}
                </MapContainer>

                {/* HUD Overlay */}
                <div className="absolute top-4 left-0 right-0 z-[1000] flex flex-col items-center pointer-events-none">
                  <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full flex items-center gap-2 text-xs font-mono">
                    <span className={cn("w-2 h-2 rounded-full", gpsSignal === 'good' ? 'bg-green-500' : gpsSignal === 'fair' ? 'bg-yellow-500' : 'bg-red-500')} />
                    {formatTime(elapsedTime)}
                  </div>
                </div>

                {/* Controls Overlay */}
                <div className="absolute bottom-6 left-0 right-0 z-[1000] flex justify-center gap-4">
                  {status === 'idle' && (
                    <button onClick={handleStart} className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-black shadow-lg hover:bg-emerald-400">
                      <Play fill="currentColor" size={20} />
                    </button>
                  )}
                  {status === 'active' && (
                    <button onClick={() => setStatus('paused')} className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-black shadow-lg hover:bg-yellow-400">
                      <Pause fill="currentColor" size={20} />
                    </button>
                  )}
                  {(status === 'active' || status === 'paused') && (
                    <button onClick={() => setStatus('summary')} className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg hover:bg-red-400">
                      <Square fill="currentColor" size={20} />
                    </button>
                  )}
                </div>

                {/* Swipe Hint */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-[1000] text-white/30 animate-pulse pointer-events-none">
                  <ChevronRight size={20} />
                </div>
              </div>

              {/* Stats Screen */}
              <div className="w-[320px] h-[320px] relative shrink-0 bg-zinc-900 flex flex-col items-center justify-center p-6 text-center">
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30 animate-pulse pointer-events-none">
                  <ChevronLeft size={20} />
                </div>

                <div className="absolute top-4 flex items-center gap-1 text-xs text-zinc-500">
                  <Battery size={12} />
                  <span>{batteryLevel}%</span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 w-full max-w-[220px]">
                  <div className="flex flex-col items-center">
                    <Heart className="text-red-500 mb-1" size={16} />
                    <span className="text-xl font-bold font-mono leading-none">{heartRate || '--'}</span>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">BPM</span>
                  </div>
                  
                  <div className="flex flex-col items-center">
                    <Navigation className="text-blue-400 mb-1" size={16} />
                    <span className="text-xl font-bold font-mono leading-none">{distance.toFixed(2)}</span>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">KM</span>
                  </div>

                  <div className="flex flex-col items-center">
                    <Activity className="text-emerald-400 mb-1" size={16} />
                    <span className="text-xl font-bold font-mono leading-none">{Math.round(elevationGain)}</span>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">M Gain</span>
                  </div>

                  <div className="flex flex-col items-center">
                    <Signal className="text-purple-400 mb-1" size={16} />
                    <span className="text-xl font-bold font-mono leading-none">{currentSpeed.toFixed(1)}</span>
                    <span className="text-[10px] text-zinc-400 uppercase tracking-wider">KM/H</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col items-center">
                  <span className="text-2xl font-bold font-mono text-yellow-400">{formatTime(elapsedTime)}</span>
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wider">Duration</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

