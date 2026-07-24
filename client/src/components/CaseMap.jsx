const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

// Renders nothing if there's no key configured or no address to show —
// never renders a broken/keyless embed.
export default function CaseMap({ address }) {
  if (!MAPS_KEY || !address?.trim()) return null;

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0, overflow: 'hidden' }}>
      <iframe
        title="Case location map"
        width="100%"
        height="320"
        style={{ border: 0, display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        src={`https://www.google.com/maps/embed/v1/place?key=${MAPS_KEY}&q=${encodeURIComponent(address)}`}
        allowFullScreen
      />
    </div>
  );
}
