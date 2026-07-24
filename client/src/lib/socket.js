import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;

export function getSocket() {
  const token = getToken();
  if (!token) return null;
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  socket = io({ auth: { token } });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
