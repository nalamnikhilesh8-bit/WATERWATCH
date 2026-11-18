import { useCallback, useEffect, useState } from 'react'
import api from '../../api/axiosClient'
import { apiErrorMessage } from '../../api/errorMessage'
import PageHeader from '../../components/PageHeader'
import LeakMap from '../../components/LeakMap'
import StatusBadge from '../../components/StatusBadge'
import SeverityIndicator from '../intelligence/SeverityIndicator'

const categories = [
  ['suspected_pipe_leak', 'Suspected pipe leak'],
  ['overflow', 'Overflow'],
  ['damaged_valve', 'Damaged valve'],
  ['other', 'Other issue'],
]
const categoryLabel = (value) => categories.find(([key]) => key === value)?.[1] || value?.replaceAll('_', ' ') || 'Unspecified'
const flowLabel = { LOW_DRIP: 'Low drip', MODERATE_STREAM: 'Moderate stream', HIGH_BURST: 'High burst' }
const dateTime = (value) => value ? new Date(value).toLocaleString() : 'Not recorded'

function directionsUrl(location) {
  if (location?.latitude == null || location?.longitude == null) return ''
  const destination = `${location.latitude},${location.longitude}`
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

export default function MaintenanceWorkerView() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [notes, setNotes] = useState({})
  const [photos, setPhotos] = useState({})
  const [verifiedCategories, setVerifiedCategories] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/operations/assignments/')
      setRows(Array.isArray(data) ? data.filter((row) => row.report && !row.report.is_demo) : [])
      setError('')
    } catch {
      setError('Your real work queue could not be loaded. Check the API connection and sign-in.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const updateStatus = async (row, nextStatus) => {
    const report = row.report
    setBusy(report.id)
    setError('')
    setNotice('')
    try {
      if (nextStatus === 'RESOLVED') {
        if (!notes[report.id]?.trim()) throw new Error('Add completion notes before closing this report.')
        if (!photos[report.id]) throw new Error('Attach an after-repair photo before closing this report.')
        const form = new FormData()
        form.append('image', photos[report.id])
        form.append('stage', 'AFTER')
        await api.post(`/operations/reports/${report.id}/images/`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      await api.patch(`/operations/reports/${report.id}/status/`, {
        status: nextStatus,
        completion_notes: notes[report.id] || '',
        note: nextStatus === 'IN_PROGRESS' ? 'Repair work started.' : 'Repair completed and evidence attached.',
      })
      setNotice(nextStatus === 'RESOLVED' ? `Verified closure saved for report #${report.id}.` : `Report #${report.id} moved to in progress.`)
      await load()
    } catch (e) {
      setError(e.response ? apiErrorMessage(e, { fallback: 'Could not update this report.' }) : e.message || 'Could not update this report.')
    } finally {
      setBusy(null)
    }
  }

  const reviewImage = async (report, image) => {
    const category = verifiedCategories[image.id] || image.verified_category
    if (!category) {
      setError('Choose the category you verified from the resident photo.')
      return
    }
    setBusy(`image-${image.id}`)
    setError('')
    setNotice('')
    try {
      await api.patch(`/reports/${report.id}/images/${image.id}/classification-review/`, { verified_category: category })
      setNotice(`Resident photo reviewed as ${categoryLabel(category)}. It can enter training only if the resident opted in.`)
      await load()
    } catch (e) {
      setError(e.response ? apiErrorMessage(e, { fallback: 'Could not save the reviewed photo label.' }) : 'Could not save the reviewed photo label.')
    } finally {
      setBusy(null)
    }
  }

  return <main className="page-shell">
    <PageHeader
      eyebrow="OPERATIONS · MAINTENANCE"
      title="Your work queue"
      description="Real resident reports assigned to your team, with the location and evidence needed to do the repair."
      action={<button type="button" className="button button-outline button-small" onClick={load} disabled={loading}>↻ {loading ? 'Refreshing…' : 'Refresh queue'}</button>}
    />
    <div className="work-queue-live"><i /> Real assigned reports · refreshes every 30 seconds</div>
    {error && <div className="inline-error">{error}</div>}
    {notice && <div className="success-banner compact-banner"><span>✓</span>{notice}</div>}
    {loading ? <div className="loading-card">Loading assigned reports…</div> : rows.length === 0 ? <div className="empty-state"><span>✓</span><h2>All caught up</h2><p>Real reports assigned to your team will appear here. Demo examples are kept out of the maintenance queue.</p></div> : <div className="worker-grid">
      {rows.map((row) => {
        const report = row.report
        const assignment = row.assignment
        const location = report.location || {}
        const hasCoordinates = location.latitude != null && location.longitude != null
        const beforePhotos = (report.images || []).filter((image) => image.stage === 'BEFORE' && !image.is_demo_placeholder)
        const afterPhotos = (report.images || []).filter((image) => image.stage === 'AFTER' && !image.is_demo_placeholder)

        return <article className="panel work-card" key={report.id}>
          <div className="work-top"><span className="record-id">REPORT #{String(report.id).padStart(4, '0')}</span><StatusBadge status={report.status} /></div>
          <h2>{report.title}</h2>
          <p className="work-location">⌖ {[location.address_landmark, location.ward_or_zone].filter(Boolean).join(' · ') || 'Location details were not provided'}</p>
          {hasCoordinates && <div className="work-directions-row">
            <span>Exact pin · {Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)}</span>
            <a href={directionsUrl(location)} target="_blank" rel="noopener noreferrer">Open directions in Google Maps ↗</a>
          </div>}
          {hasCoordinates ? <div className="work-map"><LeakMap reports={[report]} selected={{ latitude: Number(location.latitude), longitude: Number(location.longitude) }} zoom={16} height={235} /></div> : <div className="work-location-missing">No exact map pin was attached to this report. Ask the administrator for a location update before dispatch.</div>}

          <div className="work-meta"><span>{categoryLabel(report.category)}</span><SeverityIndicator score={report.priority_score} severity={report.severity_level} /></div>
          <p className="work-description">{report.description}</p>
          <div className="work-details-grid">
            <div><small>Reported flow</small><strong>{flowLabel[report.estimated_flow] || report.estimated_flow || 'Not provided'}</strong></div>
            <div><small>Leak duration</small><strong>{report.duration_hours ? `${report.duration_hours} hours` : 'Not provided'}</strong></div>
            <div><small>Households affected</small><strong>{report.affected_households ?? 'Not provided'}</strong></div>
            <div><small>Assigned to</small><strong>{assignment?.team_name || 'Your team'}</strong></div>
          </div>
          {report.ai_suggested_category && <div className="work-ai-note"><strong>Photo suggestion:</strong> {categoryLabel(report.ai_suggested_category)} · {Math.round((report.ai_confidence || 0) * 100)}% confidence. Verify against the resident photo and field conditions.</div>}

          <section className="work-evidence-section">
            <div className="eyebrow">RESIDENT EVIDENCE · BEFORE REPAIR</div>
            {beforePhotos.length ? <div className="work-photo-grid">{beforePhotos.map((image) => <article className="work-photo-card" key={image.id}>
              <a href={image.image_url} target="_blank" rel="noopener noreferrer"><img src={image.image_url} alt="Resident uploaded leak before repair" /><span>Resident photo · before repair ↗</span></a>
              {image.consent_for_training && <div className="image-review-control">
                <label>Verified photo category<select value={verifiedCategories[image.id] ?? image.verified_category ?? ''} onChange={(e) => setVerifiedCategories((current) => ({ ...current, [image.id]: e.target.value }))}><option value="">Choose the category you see</option>{categories.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                <button type="button" className="button button-outline button-small" disabled={busy === `image-${image.id}`} onClick={() => reviewImage(report, image)}>{busy === `image-${image.id}` ? 'Saving…' : image.verified_category ? 'Update verified label' : 'Verify photo label'}</button>
                <small>Resident opted in · label review is required before training.</small>
              </div>}
            </article>)}</div> : <p className="work-no-photo">No resident photo was attached. Use the report description, category, and exact map pin to inspect the site.</p>}
          </section>

          <div className="work-resident-note"><strong>Community context</strong><span>{report.upvotes_count} neighbor confirmations · reported {dateTime(report.created_at)}</span></div>
          <details className="work-history"><summary>Assignment and status history</summary>
            <p>Assigned {dateTime(assignment?.assigned_at)} · {assignment?.team_name || 'team not recorded'}</p>
            {(report.history || []).map((event) => <div className="work-history-item" key={event.id}><strong>{event.new_status?.replaceAll('_', ' ').toLowerCase()}</strong><span>{dateTime(event.timestamp)} · {event.changed_by_name || 'WaterWatch'}</span>{event.note && <p>{event.note}</p>}</div>)}
          </details>

          {report.status === 'ASSIGNED' && <button type="button" className="button button-dark button-full" disabled={busy === report.id} onClick={() => updateStatus(row, 'IN_PROGRESS')}>{busy === report.id ? 'Updating…' : 'Start repair'} <span>→</span></button>}
          {report.status === 'IN_PROGRESS' && <div className="completion-form">
            <div className="eyebrow">REPAIR COMPLETION · REQUIRED</div>
            <label>Completion notes <span>*</span><textarea rows="4" placeholder="Describe the repair performed, parts replaced, water status, and anything residents should know." value={notes[report.id] ?? assignment?.completion_notes ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [report.id]: e.target.value }))} /></label>
            <label className="after-upload"><span className="after-icon">＋</span><span><strong>After-repair photo <span>*</span></strong><small>{photos[report.id]?.name || 'Attach clear proof of the completed repair'}</small></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const photo = e.target.files?.[0]; if (photo && photo.size > 8 * 1024 * 1024) { setError('Choose an after-repair photo smaller than 8 MB.'); e.target.value = ''; return } setPhotos((current) => ({ ...current, [report.id]: photo || null })); setError('') }} /></label>
            {photos[report.id] && <button type="button" className="remove-photo-button" onClick={() => setPhotos((current) => ({ ...current, [report.id]: null }))}>Remove selected after photo</button>}
            <button type="button" className="button button-dark button-full" disabled={busy === report.id} onClick={() => updateStatus(row, 'RESOLVED')}>{busy === report.id ? 'Saving repair evidence…' : 'Submit verified closure'} <span>✓</span></button>
            <small className="closure-help">WaterWatch saves these notes and the after photo to the report record, then marks it resolved.</small>
          </div>}

          {report.status === 'RESOLVED' && <section className="resolved-evidence">
            <div className="resolved-note">✓ Verified closure recorded · {dateTime(assignment?.resolved_at)}</div>
            <div><strong>Work completed</strong><p>{assignment?.completion_notes || 'No completion notes were recorded.'}</p></div>
            {afterPhotos.length ? <div className="work-photo-grid">{afterPhotos.map((image) => <a className="work-photo-card" href={image.image_url} target="_blank" rel="noopener noreferrer" key={image.id}><img src={image.image_url} alt="Maintenance after repair evidence" /><span>Maintenance photo · after repair ↗</span></a>)}</div> : <p className="work-no-photo">No after-repair photo is attached to this closure.</p>}
          </section>}
        </article>
      })}
    </div>}
  </main>
}
