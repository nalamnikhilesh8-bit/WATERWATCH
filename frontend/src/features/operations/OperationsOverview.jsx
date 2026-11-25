function formatUpdatedAt(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function OperationsOverview({ analytics, teams, updateFailed }) {
  const reportCount = analytics?.report_count || 0
  const resolvedCount = analytics?.counts_by_status?.RESOLVED || 0
  const completionRate = reportCount ? Math.round((resolvedCount / reportCount) * 100) : 0
  const resolutionTimes = analytics?.resolution_times || []
  const resolvedWithTiming = resolutionTimes.reduce((total, item) => total + item.reports, 0)
  const averageResolutionHours = resolvedWithTiming
    ? resolutionTimes.reduce((total, item) => total + item.average_hours * item.reports, 0) / resolvedWithTiming
    : null
  const workerCount = new Set(
    (teams || [])
      .filter((team) => team.is_active && team.lead_worker != null)
      .map((team) => team.lead_worker),
  ).size
  const updatedAt = analytics?.generated_at ? formatUpdatedAt(analytics.generated_at) : null

  return <section className="operations-overview" aria-labelledby="operations-overview-title">
    <div className="operations-overview-heading">
      <div><div className="eyebrow">AT A GLANCE · LAST 30 DAYS</div><h2 id="operations-overview-title">Repair performance</h2></div>
      <div className={`operations-live-status ${updateFailed ? 'is-stale' : ''}`} role="status" aria-live="polite"><i />{updateFailed ? 'Live update failed' : updatedAt ? `Live · updated ${updatedAt}` : 'Loading live data'}<small>{updateFailed && updatedAt ? `Last successful update ${updatedAt} · retrying every 30 seconds` : 'Refreshes every 30 seconds'}</small></div>
    </div>
    <div className="operations-overview-grid">
      <article className="panel operations-summary-card completion-summary">
        <div className="operations-summary-label"><span>REPORT COMPLETION</span><i>✓</i></div>
        <div className="operations-summary-value"><strong>{completionRate}%</strong><span>{resolvedCount} of {reportCount} reports resolved</span></div>
        <div className="completion-meter" role="progressbar" aria-label="Reports resolved in the last 30 days" aria-valuemin="0" aria-valuemax="100" aria-valuenow={completionRate}>
          <span style={{ width: `${completionRate}%` }} />
        </div>
        <small>Resolved reports ÷ all reports received in this period</small>
      </article>
      <article className="panel operations-summary-card">
        <div className="operations-summary-label"><span>AVERAGE REPAIR TIME</span><i>◷</i></div>
        <div className="operations-summary-value"><strong>{averageResolutionHours === null ? '—' : `${averageResolutionHours.toFixed(1)} h`}</strong></div>
        <small>{resolvedWithTiming ? `Across ${resolvedWithTiming} completed repairs` : 'Available after repairs are completed'}</small>
      </article>
      <article className="panel operations-summary-card">
        <div className="operations-summary-label"><span>WORKERS ON ACTIVE TEAMS</span><i>♙</i></div>
        <div className="operations-summary-value"><strong>{workerCount}</strong></div>
        <small>Unique team leads assigned to active teams</small>
      </article>
    </div>
  </section>
}
