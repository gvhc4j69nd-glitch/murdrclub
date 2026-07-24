export default function RatingStars({ value = 0, onRate, disabled, size }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <span className="stars" style={size ? { fontSize: size } : undefined}>
      {stars.map(n => (
        <button
          key={n}
          type="button"
          className={`star-btn ${n <= Math.round(value) ? 'filled' : ''}`}
          disabled={disabled || !onRate}
          onClick={() => onRate?.(n)}
          title={onRate ? `Rate ${n}` : undefined}
        >
          ★
        </button>
      ))}
    </span>
  );
}
