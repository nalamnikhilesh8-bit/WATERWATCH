import { lazy, Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
const LoginPage = lazy(() => import('./features/auth_reporting/AuthPages').then((module) => ({ default: module.LoginPage })))
const RegisterPage = lazy(() => import('./features/auth_reporting/AuthPages').then((module) => ({ default: module.RegisterPage })))
const ResidentReportForm = lazy(() => import('./features/auth_reporting/ResidentReportForm'))
const MyReports = lazy(() => import('./features/auth_reporting/MyReports'))
const AdminDashboard = lazy(() => import('./features/operations/AdminDashboard'))
const MaintenanceWorkerView = lazy(() => import('./features/operations/MaintenanceWorkerView'))
const CommunityMapAnalytics = lazy(() => import('./features/operations/CommunityMapAnalytics'))

function HomePage() {
  const { user } = useAuth()
  return <main className="home-page">
    <section className="home-hero page-shell"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> COMMUNITY WATER CARE</div><h1>A clearer way to<br /><em>care for our water.</em></h1><p>One shared place to report leaks, coordinate repairs, and see what’s happening in your neighborhood.</p><div className="hero-actions">{user?.role === 'RESIDENT' ? <Link className="button button-dark button-large" to="/report">Report a leak <span>→</span></Link> : user?.role === 'ADMIN' ? <Link className="button button-dark button-large" to="/admin">Open operations <span>→</span></Link> : user?.role === 'MAINTENANCE' ? <Link className="button button-dark button-large" to="/maintenance">View your work queue <span>→</span></Link> : <><Link className="button button-dark button-large" to="/register">Join your neighborhood <span>→</span></Link><Link className="text-link" to="/login">I already have an account <span>↗</span></Link></>}</div><div className="hero-proof"><span><i className="proof-icon teal">⌖</i>Community mapped</span><span><i className="proof-icon green">✓</i>Repairs tracked</span><span><i className="proof-icon amber">◈</i>Privacy protected</span></div></div>
      <div className="hero-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-water"><span>≈</span></div><div className="art-card art-card-top"><span className="art-pulse" /> <span>NEIGHBORHOOD PULSE</span><strong>Water, looked after.</strong></div><div className="art-card art-card-bottom"><div className="art-mini-map"><span className="mini-road road-a" /><span className="mini-road road-b" /><i className="mini-pin pin-a" /><i className="mini-pin pin-b" /><i className="mini-pin pin-c" /></div><div><span className="art-status-label">COMMUNITY VIEW</span><strong>Local reports,<br />clear next steps.</strong></div></div><span className="art-caption">A little more clarity, block by block.</span></div>
    </section>
    <section className="trust-strip"><div className="page-shell trust-inner"><span className="trust-label">BUILT AROUND TRUST</span><span>Exact pins kept private</span><span>People verify every repair</span><span>AI suggestions stay optional</span><span>Independent community platform</span></div></section>
    <div className="page-shell home-analytics"><Suspense fallback={<div className="loading-card">Loading neighborhood signals…</div>}><CommunityMapAnalytics compact /></Suspense></div>
    <section className="how-section"><div className="page-shell"><div className="section-heading"><div><div className="eyebrow">FROM NOTICE TO REPAIR</div><h2>One neighborhood. One shared picture.</h2></div><p>Keep the signal simple: notice it, coordinate a response, and close the loop with proof.</p></div><div className="how-grid"><article><span className="how-number">01</span><div className="how-icon">⌖</div><h3>Report what you see</h3><p>Pin a location, describe the leak, and add a photo if it helps. Nearby reports are checked first.</p></article><article><span className="how-number">02</span><div className="how-icon">↗</div><h3>Coordinate the response</h3><p>Teams can review, prioritize, and share clear status updates as repair work moves forward.</p></article><article><span className="how-number">03</span><div className="how-icon">✓</div><h3>Close with confidence</h3><p>Completion notes and an after-repair photo keep the repair record useful for everyone.</p></article></div></div></section>
    <section className="home-cta page-shell"><div><div className="eyebrow light">BETTER WATER STARTS LOCALLY</div><h2>See something? Help make it visible.</h2><p>Small observations can help a whole neighborhood coordinate a faster response.</p></div><Link className="button button-light button-large" to={user ? '/report' : '/register'}>{user ? 'Report a leak' : 'Join the community'} <span>→</span></Link></section>
  </main>
}

export default function App() {
  return <><Navbar /><Suspense fallback={<main className="page-shell"><div className="loading-card">Opening your WaterWatch workspace…</div></main>}><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/report" element={<ProtectedRoute roles={['RESIDENT']}><ResidentReportForm /></ProtectedRoute>} />
    <Route path="/my-reports" element={<ProtectedRoute roles={['RESIDENT']}><MyReports /></ProtectedRoute>} />
    <Route path="/maintenance" element={<ProtectedRoute roles={['MAINTENANCE']}><MaintenanceWorkerView /></ProtectedRoute>} />
    <Route path="/admin" element={<ProtectedRoute roles={['ADMIN']}><AdminDashboard /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense><Footer /></>
}
