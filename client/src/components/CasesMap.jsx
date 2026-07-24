import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { api } from '../lib/api';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

let optionsSet = false;
function ensureOptionsSet() {
  if (!optionsSet) {
    setOptions({ key: MAPS_KEY, v: 'weekly' });
    optionsSet = true;
  }
}

// Renders nothing without a key — same graceful no-op as the case-detail map.
export default function CasesMap() {
  const mapContainerRef = useRef(null);
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!MAPS_KEY || !mapContainerRef.current) return;
    let cancelled = false;

    async function init() {
      try {
        ensureOptionsSet();
        const { Map } = await importLibrary('maps');
        const { Geocoder } = await importLibrary('geocoding');
        const { Marker } = await importLibrary('marker');
        if (cancelled) return;

        const map = new Map(mapContainerRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 2,
          minZoom: 2,
        });

        const { cases } = await api.get('/cases/pins');
        if (cancelled) return;

        const geocoder = new Geocoder();
        const geocoded = await Promise.allSettled(
          cases.map(c => {
            const query = (c.map_address || c.location || '').trim();
            if (!query) return Promise.reject(new Error('no address'));
            return geocoder.geocode({ address: query }).then(({ results }) => ({
              caseData: c,
              position: results[0].geometry.location,
            }));
          })
        );
        if (cancelled) return;

        const markers = geocoded
          .filter(r => r.status === 'fulfilled')
          .map(r => {
            const { caseData, position } = r.value;
            const marker = new Marker({ position, title: caseData.title });
            marker.addListener('click', () => navigate(`/cases/${caseData.id}`));
            return marker;
          });

        if (markers.length > 0) new MarkerClusterer({ map, markers });
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (!MAPS_KEY) return null;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: 420 }} />
      {error && <div className="error-banner" style={{ margin: 12 }}>{error}</div>}
    </div>
  );
}
