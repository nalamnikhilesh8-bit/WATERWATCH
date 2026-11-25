import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/axiosClient'
import PageHeader from '../../components/PageHeader'
import StatusBadge from '../../components/StatusBadge'
import SeverityIndicator from '../intelligence/SeverityIndicator'
import CommunityMapAnalytics from './CommunityMapAnalytics'
import OperationsOverview from './OperationsOverview'
import ClassifierStatusPanel from './ClassifierStatusPanel'
import ClassifierReviewQueue from './ClassifierReviewQueue'

const label = (value = '') => value.replaceAll('_', ' ').toLowerCase()
export default function AdminDashboard() {
  const [reports, setReports] = useState([]); const [teams, setTeams] = useState([]); const [analytics, setAnalytics] = useState(null); const [overviewUpdateFailed, setOverviewUpdateFailed] = useState(false); const [filter, setFilter] = useState('ALL'); const [sourceFilter, setSourceFilter] = useState('live'); const [query, setQuery] = useState(''); const [busy, setBusy] = useState(null); const [notice, setNotice] = useState(''); const [error, setError] = useState('')
  const load = async () => { try { const [r, t, stats] = await Promise.all([api.get('/reports/'), api.get('/operations/teams/'), api.get('/operations/analytics/', { params: { source: 'live', window: '30d' } })]); setReports(Array.isArray(r.data) ? r.data : r.data.results || []); setTeams(Array.isArray(t.data) ? t.data : t.data.results || []); setAnalytics(stats.data); setOverviewUpdateFailed(false); setError('') } catch { setOverviewUpdateFailed(true); setError('Operations data is unavailable. Make sure the API is running and you are signed in as an administrator.') } }
  useEffect(() => { load(); const timer = window.setInterval(load, 30_000); return () => window.clearInterval(timer) }, [])
  const filtered = useMemo(() => reports.filter((report) => (sourceFilter === 'all' || (sourceFilter === 'demo') === Boolean(report.is_demo)) && (filter === 'ALL' || report.status === filter) && `${report.title} ${report.category} ${report.status} ${report.location?.ward_or_zone || ''} ${report.location?.address_landmark || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.priority_score - a.priority_score), [reports, filter, sourceFilter, query])
  const assign = async (report, team) => { if (!team) return; setBusy(report.id); setError(''); setNotice(''); try { await api.post('/operations/assign/', { report: report.id, team }); setNotice(`Report #${report.id} assigned to ${teams.find((item) => String(item.id) === String(team))?.name}.`); await load() } catch (e) { setError(e.response?.data?.detail || 'Could not assign this report.') } finally { setBusy(null) } }
  const exportCsv = () => {
    const rows = [['id', 'title', 'category', 'status', 'priority', 'zone', 'created_at'], ...filtered.map((report) => [report.id, report.title, report.category, report.status, report.priority_score, report.location?.ward_or_zone || '', report.created_at])]
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'waterwatch-filtered-reports.csv'; anchor.click(); URL.revokeObjectURL(url)
  }
  return <main className="page-shell"><PageHeader eyebrow="OPERATIONS · ADMIN" title="Community operations" description="A clear view of reports, team capacity, and verified repair outcomes." action={<Link to="/report" className="button button-outline">View community portal ↗</Link>} />
    {error && <div className="inline-error">{error}</div>}{notice && <div className="success-banner compact-banner"><span>✓</span>{notice}</div>}
    <OperationsOverview analytics={analytics} teams={teams} updateFailed={overviewUpdateFailed} />
    <CommunityMapAnalytics />
    <ClassifierStatusPanel />
    <ClassifierReviewQueue reports={reports} onReviewed={load} />
    <section className="triage-section"><div className="section-heading"><div><div className="eyebrow">FIELD INTAKE</div><h2>Report triage</h2></div><span className="queue-count">{filtered.length} reports in view</span></div>
      <div className="panel triage-panel"><div className="triage-controls"><div className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reports, categories, or locations" /></div><div className="admin-filters"><label>Data<select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="live">Real reports</option><option value="demo">Demo examples</option><option value="all">All reports</option></select></label><label>Status<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="ALL">All statuses</option>{['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'DUPLICATE'].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label><button className="button button-outline button-small" onClick={load}>↻ Refresh</button><button className="button button-outline button-small" onClick={exportCsv}>↓ Export CSV</button></div></div>
      {filtered.length === 0 ? <div className="empty-inline">No {sourceFilter === 'demo' ? 'demo examples' : sourceFilter === 'live' ? 'real resident reports' : 'reports'} match these filters.</div> : <div className="table-scroll"><table className="triage-table"><thead><tr><th>REPORT</th><th>LOCATION</th><th>PRIORITY</th><th>STATUS</th><th>ASSIGN TEAM</th></tr></thead><tbody>{filtered.map((report) => <tr key={report.id}><td><div className="table-report-title">{report.title} {report.is_demo && <b className="demo-report-badge">DEMO</b>}</div><small>#{String(report.id).padStart(4, '0')} · {label(report.category)}{(report.parent_report || report.status === 'DUPLICATE') && <b className="duplicate-flag"> · duplicate</b>}</small></td><td>{report.location?.address_landmark || 'Approximate location'}<small>{report.location?.ward_or_zone || 'Community area'}</small></td><td><SeverityIndicator score={report.priority_score} severity={report.severity_level} /></td><td><StatusBadge status={report.status} /></td><td>{report.is_demo ? <span className="demo-assignment-note">Practice example · not assignable</span> : <div className="assign-control"><select aria-label={`Assign ${report.title}`} defaultValue="" onChange={(e) => assign(report, e.target.value)} disabled={busy === report.id || ['RESOLVED', 'DUPLICATE'].includes(report.status)}><option value="">{busy === report.id ? 'Assigning…' : 'Choose team'}</option>{teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><span>⌄</span></div>}</td></tr>)}</tbody></table></div>}
      </div>
    </section>
  </main>
}
