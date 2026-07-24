import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useAuth } from '../lib/AuthContext.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

export default function MessagesPage() {
  const { userId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [thread, setThread] = useState(null);

  const loadConversations = useCallback(() => {
    api.get('/chat/dm').then(({ conversations }) => setConversations(conversations)).catch(() => {});
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!userId) { setThread(null); return; }
    api.get(`/chat/dm/${userId}`).then(setThread).catch(() => setThread(null));
  }, [userId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMessage = ({ conversationId, message }) => {
      setThread(t => (t && t.conversationId === conversationId ? { ...t, messages: [...t.messages, message] } : t));
      loadConversations();
    };
    socket.on('dm:message', onMessage);
    return () => socket.off('dm:message', onMessage);
  }, [loadConversations]);

  function sendMessage(body) {
    const socket = getSocket();
    socket?.emit('dm:message', { toUserId: Number(userId), body });
  }

  return (
    <div className="container" style={{ padding: '40px 20px' }}>
      <h1 style={{ marginBottom: 20 }}>Messages</h1>
      <div className="dm-layout">
        <div className="dm-list">
          {conversations.length === 0 && <div className="empty-state" style={{ padding: 20 }}>No conversations yet.</div>}
          {conversations.map(c => (
            <button
              key={c.id}
              className={`dm-list-item ${Number(userId) === c.other_id ? 'active' : ''}`}
              onClick={() => navigate(`/messages/${c.other_id}`)}
            >
              <div className="name">{c.other_username}</div>
              <div className="preview">{c.last_message || 'No messages yet'}</div>
            </button>
          ))}
        </div>
        <div>
          {!userId && <div className="empty-state">Pick a conversation, or visit a member's profile to start one.</div>}
          {userId && !thread && <div className="loading">Loading…</div>}
          {userId && thread && (
            <>
              <div style={{ marginBottom: 10 }}>
                <Link to={`/members/${thread.otherUser.username}`} style={{ fontWeight: 700 }}>{thread.otherUser.username}</Link>
              </div>
              <ChatPanel messages={thread.messages} currentUserId={user.id} onSend={sendMessage} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
