import { useCallback, useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../../api/axiosClient'
import LeakMap from '../../components/LeakMap'

const categoryLabels = { suspected_pipe_leak: 'Pipe leak', overflow: 'Overflow', damaged_valve: 'Damaged valve', other: 'Other issue' }
const categoryColors = { suspected_pipe_leak: '#16808a', overflow: '#e5a34f', damaged_valve: '#db7058', other: '#7c9a83' }
const categoryOptions = Object.entries(categoryLabels)
const chartTooltipStyles = {
  contentStyle: { backgroundColor: '#143536', border: '1px solid #315c59', borderRadius: 8, color: '#edf6f2', fontSize: 10, boxShadow: '0 8px 22px rgba(4, 24, 23, .22)' },
  labelStyle: { color: '#a8cbbd', fontSize: 9 },
  itemStyle: { color: '#edf6f2', fontSize: 10 },
}

const formatDate = (date) => {
  const parsed = new Date(date)
  return Number.isNaN(parsed.valueOf()) ? date : parsed.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function downloadCsv(data) {
  if (!data) return
  const rows = [
    ['Dataset', data.data_source],
    ['Period', data.window],
    ['Generated at', data.generated_at],
    [],
    ['Report status', 'Count'],
    ...Object.entries(data.counts_by_status || {}),
    [],
    ['Report category', 'Count'],
    ...Object.entries(data.counts_by_category || {}).map(([key, value]) => [categoryLabels[key] || key, value]),
    [],
    ['Date', 'Reports'],
    ...(data.reports_over_time || []).map((item) => [item.date, item.count]),
  ]
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `waterwatch-analytics-${data.data_source.toLowerCase()}-${data.window}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function CommunityMapAnalytics({ compact = false }) {
  const [data, setData] = useState(null)
  const [source, setSource] = useState('live')
  const [windowKey, setWindowKey] = useState('30d')
  const [category, setCategory] = useState('all')
  const [mapStatus, setMapStatus] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      const { data: result } = await api.get('/operations/analytics/', { params: { source, window: windowKey, category } })
      setData(result)
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'Live analytics could not be loaded. Check that the API is connected.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [source, windowKey, category])

  useEffect(() => {
    setLoading(true)
    refresh(false)
    const timer = window.setInterval(() => refresh(false), 30_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const categories = useMemo(() => Object.entries(data?.counts_by_category || {}).map(([key, value]) => ({ key, name: categoryLabels[key] || key, value })), [data])
  const statuses = useMemo(() => Object.entries(data?.counts_by_status || {}).map(([key, value]) => ({ key, name: key.replaceAll('_', ' ').toLowerCase(), count: value })), [data])
  const timeline = useMemo(() => (data?.reports_over_time || []).map((item) => ({ ...item, label: formatDate(item.date) })), [data])
  const resolution = useMemo(() => (data?.resolution_times || []).map((item) => ({ ...item, label: item.label || item.month })), [data])
  const mapReports = useMemo(() => (data?.map_reports || []).filter((report) => mapStatus === 'ALL' || report.status === mapStatus), [data, mapStatus])
  const lastUpdated = data?.generated_at ? new Date(data.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null
  const isDemo = data?.data_source === 'DEMO'
  const hasReports = (data?.report_count || 0) > 0

  const chooseCategory = (key) => setCategory((current) => current === key ? 'all' : key)

  return <section className={`analytics-section ${compact ? 'analytics-compact' : ''}`}>
    {!compact && <div className="section-heading"><div><div className="eyebrow">COMMUNITY SIGNALS</div><h2>What’s happening nearby</h2></div><span className={`data-source ${!isDemo && !error ? 'source-live' : ''}`}><i />{error ? 'Connection issue' : isDemo ? 'SIMULATED DEMO DATA' : 'LIVE DATABASE'}</span></div>}
    <div className="analytics-toolbar panel">
      <div className="analytics-filters">
        <label>Data source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="live">Real reports</option>{data?.demo_data_available && <option value="demo">Demo examples</option>}</select></label>
        <label>Time period<select value={windowKey} onChange={(event) => setWindowKey(event.target.value)}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option><option value="all">All time</option></select></label>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <div className="analytics-actions"><button className="button button-outline button-small" onClick={() => refresh(true)} disabled={refreshing}>{refreshing ? 'Updating…' : '↻ Refresh'}</button><button className="button button-outline button-small" onClick={() => downloadCsv(data)} disabled={!data}>↓ Export CSV</button><small>{lastUpdated ? `Updated ${lastUpdated} · refreshes every 30 sec` : 'Waiting for API data'}</small></div>
    </div>

    {isDemo && <div className="demo-data-banner"><strong>DEMO MODE</strong><span>These are seeded examples for walkthroughs; they are not reports from residents.</span></div>}
    {error && <div className="inline-error analytics-error">{error}</div>}
    {loading && !data ? <div className="loading-card">Loading report analytics…</div> : <>
      <div className="kpi-grid kpi-grid-4">
        <article className="kpi-card"><div className="kpi-icon teal">⌖</div><span>Reports in period</span><strong>{data?.report_count || 0}</strong><small>{isDemo ? 'Demo examples' : 'Resident submissions'}</small></article>
        <article className="kpi-card"><div className="kpi-icon amber">◷</div><span>Open reports</span><strong>{data?.open_report_count || 0}</strong><small>Awaiting or in progress</small></article>
        <article className="kpi-card"><div className="kpi-icon green">↗</div><span>Need assignment</span><strong>{data?.unassigned_count || 0}</strong><small>Reported or verified</small></article>
        <article className="kpi-card"><div className="kpi-icon coral">!</div><span>Open over 72 hours</span><strong>{data?.over_72h_open_count || 0}</strong><small>Follow-up may be needed</small></article>
      </div>

      <div className="analytics-grid">
        <article className="panel chart-panel"><div className="chart-title"><div><span className="eyebrow">REPORT MIX · CLICK A SLICE TO FILTER</span><h3>Reports by category</h3></div><span className="chart-total">{categories.reduce((sum, item) => sum + item.value, 0)} total</span></div>
          {categories.some((item) => item.value > 0) ? <><div className="category-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={4} stroke="none">{categories.map((entry) => <Cell key={entry.key} fill={categoryColors[entry.key]} onClick={() => chooseCategory(entry.key)} style={{ cursor: 'pointer' }} />)}</Pie><Tooltip cursor={false} formatter={(value) => [`${value} reports`, 'Category']} {...chartTooltipStyles} /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{categories.reduce((sum, item) => sum + item.value, 0)}</strong><span>reports</span></div></div><div className="legend-list">{categories.map((item) => <button key={item.key} className={category === item.key ? 'legend-selected' : ''} onClick={() => chooseCategory(item.key)}><i style={{ background: categoryColors[item.key] }} />{item.name}<b>{item.value}</b></button>)}</div></> : <div className="chart-empty">No reports match this period and category.</div>}
        </article>

        <article className="panel chart-panel"><div className="chart-title"><div><span className="eyebrow">WORKFLOW · CLICK A BAR TO FILTER THE MAP</span><h3>Reports by status</h3></div><span className="chart-total">{statuses.reduce((sum, item) => sum + item.count, 0)} total</span></div>
          {statuses.some((item) => item.count > 0) ? <div className="status-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={statuses} margin={{ top: 10, right: 8, left: -18, bottom: 6 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eeeb" /><XAxis dataKey="name" tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} interval={0} /><YAxis tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, 'dataMax']} /><Tooltip cursor={false} {...chartTooltipStyles} /><Bar dataKey="count" name="Reports" fill="#247b82" radius={[6, 6, 0, 0]} maxBarSize={34}>{statuses.map((item) => <Cell key={item.key} fill={mapStatus === item.key ? '#df7558' : '#247b82'} onClick={() => setMapStatus((current) => current === item.key ? 'ALL' : item.key)} style={{ cursor: 'pointer' }} />)}</Bar></BarChart></ResponsiveContainer></div> : <div className="chart-empty">No status data for this selection.</div>}
        </article>

        <article className="panel chart-panel chart-panel-wide"><div className="chart-title"><div><span className="eyebrow">REPORT INTAKE</span><h3>Reports over time</h3></div><span className="chart-total">{windowKey === 'all' ? 'Monthly' : windowKey === '90d' ? 'Weekly' : 'Daily'} totals</span></div>
          {timeline.length ? <div className="status-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}><defs><linearGradient id="reportFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#25808a" stopOpacity={0.28} /><stop offset="95%" stopColor="#25808a" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eeeb" /><XAxis dataKey="label" tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} minTickGap={24} /><YAxis tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, 'dataMax']} /><Tooltip cursor={false} labelFormatter={(label) => `Period: ${label}`} formatter={(value) => [value, 'Reports']} {...chartTooltipStyles} /><Area type="monotone" dataKey="count" name="Reports" stroke="#247b82" strokeWidth={2.5} fill="url(#reportFill)" activeDot={{ r: 5, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer></div> : <div className="chart-empty">No reports in the selected period.</div>}
        </article>

        <article className="panel chart-panel chart-panel-wide"><div className="chart-title"><div><span className="eyebrow">VERIFIED REPAIRS</span><h3>Average resolution time</h3></div><span className="chart-total">Hours from report to closure</span></div>
          {resolution.length ? <div className="status-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={resolution} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eeeb" /><XAxis dataKey="label" tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 9, fill: '#83918e' }} axisLine={false} tickLine={false} domain={[0, 'dataMax']} /><Tooltip cursor={false} formatter={(value) => [`${value} hours`, 'Average resolution']} {...chartTooltipStyles} /><Bar dataKey="average_hours" name="Average hours" fill="#d4a052" radius={[6, 6, 0, 0]} maxBarSize={40} /></BarChart></ResponsiveContainer></div> : <div className="chart-empty">Resolved reports with assignment timestamps will appear here.</div>}
        </article>
      </div>

      <div className="panel map-panel"><div className="map-panel-heading"><div><span className="eyebrow">{isDemo ? 'SIMULATED NEIGHBORHOOD' : 'LIVE NEIGHBORHOOD'}</span><h3>{isDemo ? 'Demo report map' : 'Open reports & recurring areas'}</h3><p>{isDemo ? 'Example records are shown for training and walkthroughs.' : 'Public pins are rounded to protect household locations.'}</p></div><div className="map-heading-actions"><label>Map status<select value={mapStatus} onChange={(event) => setMapStatus(event.target.value)}><option value="ALL">All open statuses</option>{['REPORTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ').toLowerCase()}</option>)}</select></label><div className="map-legend"><span><i className="legend-orange" />Open report</span><span><i className="legend-hotspot" />Recurring area</span></div></div></div>
        {mapReports.length ? <LeakMap reports={mapReports} hotspots={data?.hotspots || []} height={compact ? 300 : 390} autoFit /> : <div className="map-empty"><span>⌖</span><strong>{hasReports ? 'No open reports match this map filter.' : isDemo ? 'No demo reports in this period.' : 'No real reports have been submitted yet.'}</strong><p>{isDemo ? 'Switch to Real reports to see community submissions.' : 'New resident submissions will appear here automatically.'}</p></div>}
        <div className="map-footnote"><span>◈</span>{data?.map_limited ? 'Showing the highest-priority 500 open reports. ' : ''}{isDemo ? 'SIMULATED DATA · not community-submitted' : 'Public map pins are approximate · hotspot groups contain reports within about 150 m'}{mapStatus !== 'ALL' && <button onClick={() => setMapStatus('ALL')}>Clear map filter</button>}</div>
      </div>
      {!compact && data && <div className="analytics-method-note">Source: {isDemo ? 'seeded development examples' : 'WaterWatch resident submissions'} · {data.report_count || 0} reports · refreshed {lastUpdated || '—'}.</div>}
    </>}
  </section>
}
