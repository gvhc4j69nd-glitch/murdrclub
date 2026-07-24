import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/AuthContext.jsx';
import { regionName } from '../lib/regions';
import ContributionForm from '../components/ContributionForm.jsx';
import ContributionCard from '../components/ContributionCard.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

export default function CaseDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);

  const load = useCallback(() => {
    api.get(`/cases/${id}`).then(setData).catch(err => setError(err.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!data?.isMember || !user) return;
    api.get(`/chat/case/${id}`).then(({ messages }) => setChatMessages(messages)).catch(() => {});

    const socket = getSocket();
    if (!socket) return;
    socket.emit('case:join', { caseId: Number(id) });
    const onMessage = ({ caseId, message }) => {
      if (Number(caseId) === Number(id)) setChatMessages(prev => [...prev, message]);
    };
    socket.on('case:message', onMessage);
    return () => {
      socket.emit('case:leave', { caseId: Number(id) });
      socket.off('case:message', onMessage);
    };
  }, [data?.isMember, id, user]);

  async function toggleMembership() {
    setBusy(true);
    try {
      if (data.isMember) await api.del(`/cases/${id}/join`);
      else await api.post(`/cases/${id}/join`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleContribute(form) {
    const { contribution } = await api.post(`/cases/${id}/contributions`, form);
    setData(d => ({ ...d, contributions: [contribution, ...d.contributions], case: { ...d.case, contribution_count: d.case.contribution_count + 1 } }));
  }

  async function handleRate(contributionId, rating) {
    const result = await api.post(`/contributions/${contributionId}/rate`, { rating });
    setData(d => ({
      ...d,
      contributions: d.contributions.map(c =>
        c.id === contributionId ? { ...c, avg_rating: result.avg_rating, rating_count: result.rating_count } : c
      ),
    }));
  }

  function sendChat(body) {
    const socket = getSocket();
    socket?.emit('case:message', { caseId: Number(id), body });
  }

  if (error) return <div className="container" style={{ padding: 40 }}><div className="error-banner">{error}</div></div>;
  if (!data) return <div className="loading">Loading…</div>;

  const { case: c, members, contributions, isMember } = data;

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <div className="case-header">
        <span className="badge badge-approved" style={{ marginBottom: 10, display: 'inline-block' }}>{regionName(c.region_key)}</span>
        <h1>{c.title}</h1>
        <div className="case-meta">
          {c.victim_name && <span>Victim: {c.victim_name}</span>}
          {c.location && <span>{c.location}</span>}
          {c.date_occurred && <span>{c.date_occurred}</span>}
          <span>{c.member_count} on the hunt</span>
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 20 }}>
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <p>{c.summary}</p>
          </div>

          {user && (
            <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={toggleMembership} disabled={busy}>
              {isMember ? 'Leave the hunt' : 'Join the hunt'}
            </button>
          )}

          {isMember && <ContributionForm onSubmit={handleContribute} />}

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Evidence & leads ({contributions.length})</h3>
            {contributions.length === 0 && <div className="empty-state">No contributions yet. Join the hunt and add the first one.</div>}
            {contributions.map(ct => (
              <ContributionCard key={ct.id} contribution={ct} currentUserId={user?.id} onRate={handleRate} />
            ))}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 10 }}>On the hunt ({members.length})</h3>
            {members.map(m => (
              <div key={m.id} className="hint" style={{ padding: '4px 0' }}>{m.username}</div>
            ))}
          </div>

          <h3 style={{ marginBottom: 10 }}>Group chat</h3>
          <ChatPanel
            messages={chatMessages}
            currentUserId={user?.id}
            onSend={sendChat}
            disabled={!isMember}
            placeholder="Message the hunt group…"
          />
        </div>
      </div>
    </div>
  );
}
