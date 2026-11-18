import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import api from '../../api/axiosClient'
import { apiErrorMessage } from '../../api/errorMessage'
import PageHeader from '../../components/PageHeader'
import StatusBadge from '../../components/StatusBadge'
import SeverityIndicator from '../intelligence/SeverityIndicator'

const dateTime = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const label = (value = '') => value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, (character) => character.toUpperCase())

export default function MyReports() {
  const location = useLocation()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [consentBusy, setConsentBusy] = useState(null)
  const [photoDrafts, setPhotoDrafts] = useState({})
  const [photoBusy, setPhotoBusy] = useState(null)

  useEffect(() => {
    api.get('/reports/')
      .then(({ data }) => setReports(Array.isArray(data) ? data : data.results || []))
      .catch(() => setError('We could not load your reports. Check that the API is running and try again.'))
      .finally(() => setLoading(false))
  }, [])

  const addBeforePhoto = async (report) => {
    const draft = photoDrafts[report.id]
    if (!draft?.file) { setError('Choose a leak photo to attach first.'); return }
    if (draft.file.size > 8 * 1024 * 1024) { setError('Choose a photo smaller than 8 MB.'); return }
    setPhotoBusy(report.id)
    setError('')
    setNotice('')
    const body = new FormData()
    body.append('image', draft.file)
    body.append('stage', 'BEFORE')
    body.append('consent_for_training', String(Boolean(draft.consent)))
    try {
      const { data } = await api.post(`/reports/${report.id}/images/`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
      setReports((current) => current.map((item) => item.id === report.id ? { ...item, images: [...(item.images || []), data] } : item))
      setPhotoDrafts((current) => ({ ...current, [report.id]: { file: null, consent: false, inputKey: (current[report.id]?.inputKey || 0) + 1 } }))
      setNotice(`Before-repair photo added to report #${report.id}. Assigned maintenance staff will see it in their queue.`)
    } catch (e) {
      setError(apiErrorMessage(e, { fallback: 'Could not add this photo to the report.' }))
    } finally {
      setPhotoBusy(null)
    }
  }

  const updateTrainingConsent = async (report, image) => {
    setConsentBusy(image.id)
    setError('')
    try {
      const { data } = await api.patch(`/reports/${report.id}/images/${image.id}/training-consent/`, { consent_for_training: !image.consent_for_training })
      setReports((current) => current.map((item) => item.id !== report.id ? item : { ...item, images: item.images.map((entry) => entry.id === image.id ? data : entry) }))
    } catch (e) {
      setError(apiErrorMessage(e, { fallback: 'Could not update photo training consent.' }))
    } finally {
      setConsentBusy(null)
    }
  }

  return <main className="page-shell">
    <PageHeader eyebrow="RESIDENT PORTAL" title="My reports" description="Every report, update, and verified repair in one place." action={<Link to="/report" className="button button-dark">＋ Report a leak</Link>} />
    {location.state?.submitted && <div className="success-banner"><span>✓</span><div><strong>Report received</strong><p>Your neighborhood team can now review it. We’ll keep the timeline updated as work moves forward.</p></div></div>}
    {error && <div className="inline-error">{error}</div>}
    {notice && <div className="success-banner compact-banner"><span>✓</span>{notice}</div>}
    {loading ? <div className="loading-card">Loading your reports…</div> : reports.length === 0 ? <div className="empty-state"><span>≈</span><h2>No reports you submitted yet</h2><p>My reports lists leaks submitted from this account. If you confirmed a neighbor’s report, it stays on the Community map and does not create a personal report entry.</p><div className="empty-actions"><Link to="/report" className="button button-dark">Submit a separate leak <span>→</span></Link><Link to="/" className="button button-outline">View community reports</Link></div></div> : <div className="report-list">
      {reports.map((report) => <article className="panel report-record" key={report.id}>
        <div className="record-top"><div><span className="record-id">REPORT #{String(report.id).padStart(4, '0')} <span>·</span> {dateTime(report.created_at)}</span><h2>{report.title} {report.is_demo && <b className="demo-report-badge">DEMO EXAMPLE</b>}</h2><p>{report.location?.address_landmark || report.location?.ward_or_zone || 'Community location'}</p></div><StatusBadge status={report.status} /></div>
        <div className="record-tags"><span className="category-tag">{label(report.category)}</span><SeverityIndicator score={report.priority_score} severity={report.severity_level} /><span className="upvote-tag">↑ {report.upvotes_count} community confirmations</span></div>
        <p className="record-description">{report.description}</p>
        {report.status === 'RESOLVED' && report.completion_notes && <section className="resident-closure-record"><div><strong>Verified repair closure</strong><time>{dateTime(report.resolved_at)}</time></div><p>{report.completion_notes}</p></section>}
        {report.images?.length > 0 && <div className="evidence-strip">{report.images.map((image) => <div className="evidence-card" key={image.id}><a href={image.image_url} target="_blank" rel="noreferrer"><img src={image.image_url} alt={`${label(image.stage)} evidence`} /><span>{image.stage === 'AFTER' ? '✓ After repair' : 'Before repair'}</span></a>{image.stage === 'BEFORE' && !image.is_demo_placeholder && <button type="button" className="consent-toggle" disabled={consentBusy === image.id} onClick={() => updateTrainingConsent(report, image)}>{image.consent_for_training ? 'Opted in · revoke' : 'Allow reviewed training use'}</button>}</div>)}</div>}
        {!['RESOLVED', 'DUPLICATE'].includes(report.status) && <div className="resident-photo-add">
          <label>Attach a before-repair leak photo<input key={photoDrafts[report.id]?.inputKey || 0} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhotoDrafts((current) => ({ ...current, [report.id]: { ...current[report.id], file: e.target.files?.[0] || null } }))} /></label>
          <p className="resident-photo-hint">Leak photos only. Do not upload identity documents or private images. JPG, PNG, or WEBP · up to 8 MB.</p>
          <label className="training-consent"><input type="checkbox" checked={Boolean(photoDrafts[report.id]?.consent)} onChange={(e) => setPhotoDrafts((current) => ({ ...current, [report.id]: { ...current[report.id], consent: e.target.checked } }))} /><span>Optionally allow this photo for classifier improvement after an operations reviewer verifies its category.</span></label>
          <button type="button" className="button button-outline" disabled={!photoDrafts[report.id]?.file || photoBusy === report.id} onClick={() => addBeforePhoto(report)}>{photoBusy === report.id ? 'Uploading photo…' : 'Add before photo'}</button>
        </div>}
        <div className="timeline"><div className="timeline-title">STATUS TIMELINE <span>· {report.history?.length || 0} updates</span></div>{(report.history || []).length ? report.history.map((event) => <div className="timeline-event" key={event.id}><span className={`timeline-dot ${event.new_status === 'RESOLVED' ? 'done' : ''}`} /><div><div><strong>{label(event.new_status)}</strong><time>{dateTime(event.timestamp)}</time></div><p>{event.note || `Status changed${event.old_status ? ` from ${label(event.old_status)}` : ''}.`}</p></div></div>) : <div className="timeline-event"><span className="timeline-dot done" /><div><strong>Report received</strong><p>Waiting for the first review.</p></div></div>}</div>
      </article>)}
    </div>}
  </main>
}
