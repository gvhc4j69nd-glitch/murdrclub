import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ messages, currentUserId, onSend, disabled, placeholder }) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim() || disabled) return;
    onSend(draft.trim());
    setDraft('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && <div className="empty-state">No messages yet. Say something.</div>}
        {messages.map(m => (
          <div key={m.id} className={`chat-msg ${m.sender_id === currentUserId ? 'mine' : ''}`}>
            <div className="who">{m.sender_id === currentUserId ? 'You' : m.sender_username}</div>
            <div className="bubble">{m.body}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={disabled ? 'Join the hunt to chat' : placeholder || 'Type a message…'}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled}>Send</button>
      </form>
    </div>
  );
}
