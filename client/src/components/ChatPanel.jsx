import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ messages, currentUserId, onSend, disabled, placeholder }) {
  const [draft, setDraft] = useState('');
  const messagesRef = useRef(null);

  useEffect(() => {
    // Scroll only the message list itself — scrollIntoView here would pull
    // the whole page down to reveal it, since the chat panel sits well
    // below the fold on a case page.
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!draft.trim() || disabled) return;
    onSend(draft.trim());
    setDraft('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={messagesRef}>
        {messages.length === 0 && <div className="empty-state">No messages yet. Say something.</div>}
        {messages.map(m => (
          <div key={m.id} className={`chat-msg ${m.sender_id === currentUserId ? 'mine' : ''}`}>
            <div className="who">{m.sender_id === currentUserId ? 'You' : m.sender_username}</div>
            <div className="bubble">{m.body}</div>
          </div>
        ))}
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
