import RatingStars from './RatingStars.jsx';
import Translatable from './Translatable.jsx';

function youtubeEmbed(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/watch\?v=|youtube\.com\/embed\/)([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export default function ContributionCard({ contribution, currentUserId, onRate, canModerate, onModerate }) {
  const c = contribution;
  const embed = c.video_url ? youtubeEmbed(c.video_url) : null;
  const isAuthor = c.user_id === currentUserId;

  return (
    <div className="contribution">
      <div className="contribution-meta">
        <span className="contribution-author">{c.username}</span>
        {c.is_club && <span className="badge badge-club">Club</span>}
        {c.status === 'pending' && <span className="badge badge-review">Awaiting review</span>}
        <span className="contribution-time">{new Date(c.created_at).toLocaleString()}</span>
        {canModerate && c.status === 'pending' && (
          <span style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button className="btn btn-sm btn-primary" onClick={() => onModerate(c.id, 'approve')}>Approve</button>
            <button className="btn btn-sm btn-danger" onClick={() => onModerate(c.id, 'reject')}>Reject</button>
          </span>
        )}
      </div>
      <Translatable text={c.body} className="contribution-body" />
      <div className="contribution-media">
        {c.link_url && <a href={c.link_url} target="_blank" rel="noopener noreferrer">🔗 Source link</a>}
        {c.photo_url && <img src={c.photo_url} alt="Evidence" loading="lazy" />}
        {c.video_url && (embed ? (
          <iframe
            width="100%"
            height="220"
            src={embed}
            title="Evidence video"
            style={{ border: 0, borderRadius: 6, marginTop: 8 }}
            allowFullScreen
          />
        ) : (
          <video controls src={c.video_url} />
        ))}
      </div>
      <div className="rating-row">
        <RatingStars value={c.avg_rating || 0} onRate={!isAuthor && currentUserId ? rating => onRate(c.id, rating) : null} disabled={isAuthor} />
        <span className="rating-summary">
          {c.avg_rating ? `${c.avg_rating} avg` : 'Not yet rated'} ({c.rating_count || 0})
        </span>
      </div>
    </div>
  );
}
