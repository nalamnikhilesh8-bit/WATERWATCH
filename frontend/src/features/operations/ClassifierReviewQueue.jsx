import { useState } from 'react'
import api from '../../api/axiosClient'

const categories = [
  ['suspected_pipe_leak', 'Suspected pipe leak'],
  ['overflow', 'Overflow'],
  ['damaged_valve', 'Damaged valve'],
  ['other', 'Other issue'],
]

export default function ClassifierReviewQueue({ reports, onReviewed }) {
  const [selected, setSelected] = useState({})
  const [saving, setSaving] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const photos = reports.flatMap((report) => (report.images || [])
    .filter((image) => image.stage === 'BEFORE' && image.consent_for_training && !image.is_demo_placeholder)
    .map((image) => ({ report, image })))

  const review = async ({ report, image }) => {
    const category = selected[image.id] || image.verified_category
    if (!category) return
    setSaving(image.id); setError(''); setNotice('')
    try {
      await api.patch(`/reports/${report.id}/images/${image.id}/classification-review/`, { verified_category: category })
      setNotice(`Reviewed the photo for report #${report.id}.`)
      await onReviewed()
    } catch (e) {
      setError(e.response?.data?.detail || e.response?.data?.verified_category?.[0] || 'Could not save this reviewed category.')
    } finally { setSaving(null) }
  }

  return <section className="triage-section classifier-review-section">
    <div className="section-heading"><div><div className="eyebrow">SUPERVISED LEARNING</div><h2>Opted-in photo review</h2></div><span className="queue-count">{photos.length} photos</span></div>
    <div className="panel classifier-review-panel">
      <p className="classifier-review-intro">Review the category visible in each opted-in before-repair photo. Generated demo drawings and photos without resident consent stay out of this queue.</p>
      {error && <div className="inline-error">{error}</div>}{notice && <div className="success-banner compact-banner"><span>✓</span>{notice}</div>}
      {photos.length === 0 ? <div className="empty-inline">No resident opted-in real photos are waiting for review.</div> : <div className="classifier-review-grid">{photos.map(({ report, image }) => <article className="classifier-review-card" key={image.id}>
        <a href={image.image_url} target="_blank" rel="noreferrer"><img src={image.image_url} alt={`Before-repair photo for report ${report.id}`} /></a>
        <strong>{report.title}</strong><small>Report #{report.id} · {report.location?.ward_or_zone || 'Community area'}</small>
        <label>Category confirmed by visual review<select value={selected[image.id] ?? image.verified_category ?? ''} onChange={(event) => setSelected((current) => ({ ...current, [image.id]: event.target.value }))}><option value="">Choose a category</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button-outline button-small" disabled={saving === image.id || !(selected[image.id] || image.verified_category)} onClick={() => review({ report, image })}>{saving === image.id ? 'Saving…' : image.verified_category ? 'Update reviewed category' : 'Save reviewed category'}</button>
      </article>)}</div>}
    </div>
  </section>
}
