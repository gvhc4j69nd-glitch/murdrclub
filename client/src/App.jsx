import { Routes, Route } from 'react-router-dom';
import NavBar from './components/NavBar.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import RegionsPage from './pages/RegionsPage.jsx';
import RegionDetailPage from './pages/RegionDetailPage.jsx';
import CaseDetailPage from './pages/CaseDetailPage.jsx';
import SubmitCasePage from './pages/SubmitCasePage.jsx';
import MembersPage from './pages/MembersPage.jsx';
import MemberProfilePage from './pages/MemberProfilePage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

export default function App() {
  return (
    <>
      <NavBar />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/regions" element={<RegionsPage />} />
          <Route path="/regions/:key" element={<RegionDetailPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
          <Route path="/submit" element={<ProtectedRoute><SubmitCasePage /></ProtectedRoute>} />
          <Route path="/members" element={<MembersPage />} />
          <Route path="/members/:username" element={<MemberProfilePage />} />
          <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/messages/:userId" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="footer">MURD'R CLUB — Real People. Real Cases. Real Impact.</footer>
    </>
  );
}

function NotFound() {
  return (
    <div className="container" style={{ padding: '60px 20px', textAlign: 'center' }}>
      <h2>Case not found</h2>
      <p className="hint">This trail's gone cold. That page doesn't exist.</p>
    </div>
  );
}
