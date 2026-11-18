import { useState } from 'react'
import api from '../../api/axiosClient'

export default function DuplicateWarningModal({ matches, onNewReport, onClose, onFinish }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const upvote = async (id) => {
    setBusyId(id); setError('')
    try { await api.post(`/reports/${id}/upvote/`); setDone(true) }
    catch { setError('Could not add your confirmation. Please try again.') }
    finally { setBusyId(null) }
  }
  return <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
    <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
    <div className="modal-icon">↗</div><div className="eyebrow">A neighbor has already reported this</div><h2 id="duplicate-title">Is this the same leak?</h2>
    <p className="modal-copy">We found an open report close to your pin. Upvoting adds your confirmation to that report; it does not create a new entry and will not appear under My reports. Choose the separate-report option if this is a different leak.</p>
    <div className="match-list">{matches.map((match) => <div className="match-row" key={match.id}><div><strong>{match.title}</strong><small>{match.distance_meters} m away · {match.category?.replaceAll('_', ' ')}</small></div><span className="vote-count">↑ {match.upvotes_count || 1}</span></div>)}</div>
    {error && <div className="inline-error">{error}</div>}
    {done ? <div className="success-callout">Your confirmation is on the neighbor’s report. Find it on the Community map.</div> : <button className="button button-dark button-full" onClick={() => upvote(matches[0].id)} disabled={busyId != null}>{busyId ? 'Adding your confirmation…' : 'Confirm & upvote closest report'}</button>}
    <button className="button button-quiet button-full" onClick={done ? onFinish : onNewReport}>{done ? 'View community reports' : 'This is a separate leak · submit a new report'}</button>
  </div></div>
}
