import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/axiosClient'
import { apiErrorMessage } from '../../api/errorMessage'
import PageHeader from '../../components/PageHeader'
import LeakMap from '../../components/LeakMap'
import { useAuth } from '../../context/AuthContext'
import DuplicateWarningModal from '../intelligence/DuplicateWarningModal'
import SeverityIndicator from '../intelligence/SeverityIndicator'

const categories = [
  ['suspected_pipe_leak', 'Suspected pipe leak'], ['overflow', 'Overflow'], ['damaged_valve', 'Damaged valve'], ['other', 'Other issue'],
]
const storedCoordinate = (value) => Number(Number(value).toFixed(6))

export default function ResidentReportForm() {
  const navigate = useNavigate(); const { user } = useAuth()
  const [form, setForm] = useState({ title: '', description: '', category: 'other', estimated_flow: 'LOW_DRIP', duration_hours: 1, affected_households: 1, latitude: null, longitude: null, address_landmark: '', ward_or_zone: user?.locality || '' })
  const [locationConfirmed, setLocationConfirmed] = useState(false); const [locationSource, setLocationSource] = useState(''); const [locationAccuracy, setLocationAccuracy] = useState(null); const [locating, setLocating] = useState(false)
  const [file, setFile] = useState(null); const [ai, setAi] = useState(null); const [trainingConsent, setTrainingConsent] = useState(false); const [manualCategory, setManualCategory] = useState(false)
  const [busy, setBusy] = useState(false); const [classifying, setClassifying] = useState(false); const [matches, setMatches] = useState([]); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const selectedLocation = locationConfirmed ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null
  const score = Math.min(100, ({ LOW_DRIP: 15, MODERATE_STREAM: 35, HIGH_BURST: 55 }[form.estimated_flow] || 15) + Math.min(Number(form.duration_hours) * .5, 20) + Math.min(Number(form.affected_households) * 1.5, 25))
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const useGps = () => {
    if (!navigator.geolocation) return setError('Location services are not available in this browser.')
    setLocating(true); setError(''); setNotice('')
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setForm((current) => ({ ...current, latitude: storedCoordinate(coords.latitude), longitude: storedCoordinate(coords.longitude) }))
      setLocationConfirmed(true); setLocationSource('gps'); setLocationAccuracy(coords.accuracy); setError('')
      if (coords.accuracy > 100) setNotice(`GPS accuracy is about ${Math.round(coords.accuracy)} m. Check the map and tap the leak's exact point if needed.`)
      setLocating(false)
    }, (geoError) => {
      const message = geoError.code === geoError.PERMISSION_DENIED ? 'Location access was denied. Allow it in your browser, or tap the leak location on the map.' : 'Could not get a GPS fix. Try again or tap the leak location on the map.'
      setError(message); setLocating(false)
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  }
  const choosePhoto = async (event) => {
    const image = event.target.files?.[0]
    setFile(image || null); setAi(null); setTrainingConsent(false)
    if (!image) return
    if (/(?:aadhaar?|aadhar|passport|identity|id[\s_-]?(?:card|proof)|driver.?s?[\s_-]?license)/i.test(image.name)) {
      setFile(null); event.target.value = ''
      setError('This filename looks like an identity document. Please choose a leak photo instead; do not upload identity documents here.')
      return
    }
    if (image.size > 8 * 1024 * 1024) { setError('Please choose an image under 8 MB.'); event.target.value = ''; setFile(null); return }
    setClassifying(true); setError('')
    try {
      const body = new FormData(); body.append('image', image)
      const { data } = await api.post('/reports/classify-image/', body, { headers: { 'Content-Type': 'multipart/form-data' } })
      setAi(data)
      if (data.auto_select_category && !manualCategory) setForm((current) => ({ ...current, category: data.suggested_category }))
    } catch { setNotice('The photo is ready; image suggestions are unavailable right now. You can still choose a category yourself.') }
    finally { setClassifying(false) }
  }
  const createReport = async () => {
    setBusy(true); setError(''); setNotice('')
    let reportId
    try {
      const latitude = storedCoordinate(form.latitude)
      const longitude = storedCoordinate(form.longitude)
      const { latitude: _latitude, longitude: _longitude, ...reportFields } = form
      const payload = { ...reportFields, location: { latitude, longitude, address_landmark: form.address_landmark, ward_or_zone: form.ward_or_zone }, ai_suggested_category: ai?.suggested_category || null, ai_confidence: ai?.confidence || 0, ai_model_version: ai?.model_version || '', ai_classifier_method: ai?.method || '' }
      const { data } = await api.post('/reports/', payload); reportId = data.id
      if (file) {
        const body = new FormData(); body.append('image', file); body.append('stage', 'BEFORE'); body.append('consent_for_training', String(trainingConsent))
        await api.post(`/reports/${data.id}/images/`, body, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      navigate('/my-reports', { state: { submitted: true } })
    } catch (e) {
      if (reportId) { setNotice('Your report was saved, but the photo could not be attached. You can add it from My reports.'); navigate('/my-reports', { state: { submitted: true } }) }
      else setError(apiErrorMessage(e, { fallback: 'Could not submit the report. Please review the fields and try again.' }))
    } finally { setBusy(false) }
  }
  const submit = async (event) => {
    event.preventDefault(); setError(''); setNotice('')
    if (!form.title.trim() || !form.description.trim()) return setError('Add a title and short description so the team knows what to look for.')
    if (!locationConfirmed || !Number.isFinite(Number(form.latitude)) || !Number.isFinite(Number(form.longitude))) return setError('Choose the leak location on the map or use GPS before submitting.')
    setBusy(true)
    try {
      const { data } = await api.post('/reports/check-duplicates/', { latitude: Number(form.latitude), longitude: Number(form.longitude) })
      if (data.matches?.length) { setMatches(data.matches); setBusy(false); return }
      setBusy(false); await createReport()
    } catch { setBusy(false); setError('We could not check nearby reports. Please try again when the service is available.') }
  }
  return <main className="page-shell"><PageHeader eyebrow="RESIDENT PORTAL · NEW REPORT" title="Report a water leak" description="Share what you are seeing. Your exact pin is only available to you and authorized repair staff." action={<span className="privacy-note"><span>◈</span> Exact location protected</span>} />
    <form className="report-layout" onSubmit={submit}>
      <div className="form-column">
        <section className="panel form-panel"><div className="panel-heading"><div><span className="step-number">01</span><div><h2>What did you notice?</h2><p>A clear description helps the right team respond.</p></div></div><span className="required-label">ALL FIELDS MARKED * REQUIRED</span></div>
          <label>Report title <span>*</span><input required maxLength="150" placeholder="e.g. Water pooling near the north gate" value={form.title} onChange={(e) => update('title', e.target.value)} /></label>
          <label>What is happening? <span>*</span><textarea required rows="4" placeholder="Describe where the water is coming from and what you can see…" value={form.description} onChange={(e) => update('description', e.target.value)} /></label>
          <div className="form-grid two"><label>Estimated flow<select value={form.estimated_flow} onChange={(e) => update('estimated_flow', e.target.value)}><option value="LOW_DRIP">Low drip</option><option value="MODERATE_STREAM">Moderate stream</option><option value="HIGH_BURST">High burst / active burst</option></select></label><label>How long has it been leaking?<div className="input-suffix"><input type="number" min="1" max="500" value={form.duration_hours} onChange={(e) => update('duration_hours', e.target.value)} /><span>hours</span></div></label></div>
          <div className="form-grid two"><label>Households affected<input type="number" min="1" max="10000" value={form.affected_households} onChange={(e) => update('affected_households', e.target.value)} /></label><div className="severity-preview"><span>Suggested priority</span><SeverityIndicator score={score} /></div></div>
        </section>
        <section className="panel form-panel"><div className="panel-heading"><div><span className="step-number">02</span><div><h2>Mark the leak location</h2><p>Tap the leak on the map, zoom in for precision, or use GPS and adjust the pin.</p></div></div><button type="button" className="button button-outline button-small" onClick={useGps} disabled={locating}>{locating ? 'Finding location…' : '◎ Use my GPS'}</button></div>
          <LeakMap selected={selectedLocation} onSelect={({ latitude, longitude }) => { setForm((current) => ({ ...current, latitude: storedCoordinate(latitude), longitude: storedCoordinate(longitude) })); setLocationConfirmed(true); setLocationSource('map'); setLocationAccuracy(null); setError(''); setNotice('') }} height={300} zoom={16} />
          <div className={`coordinate-readout ${locationConfirmed ? '' : 'location-unconfirmed'}`}><span className={locationConfirmed ? 'live-dot' : 'location-dot'} /><span>{locationConfirmed ? 'PIN CONFIRMED' : 'LOCATION REQUIRED'}</span>{locationConfirmed && <strong>{Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}</strong>}<small>{!locationConfirmed ? 'Tap the leak location on the map or use GPS.' : locationSource === 'gps' ? `GPS accuracy ±${Math.max(1, Math.round(locationAccuracy || 1))} m · adjust the pin if needed` : 'Pin set on map · exact coordinates shared with operations staff'}</small></div>
          <div className="form-grid two"><label>Nearby landmark<input maxLength="255" placeholder="Street, building, or nearby landmark" value={form.address_landmark} onChange={(e) => update('address_landmark', e.target.value)} /></label><label>Ward or zone<input maxLength="100" placeholder="Your area" value={form.ward_or_zone} onChange={(e) => update('ward_or_zone', e.target.value)} /></label></div>
        </section>
      </div>
      <aside className="form-aside"><section className="panel photo-panel"><div className="eyebrow">OPTIONAL · PHOTO</div><h2>Show us what you see</h2><p>A photo helps the team understand the issue. Avoid including people or private details.</p>
        <label className="upload-zone"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} /><span className="upload-icon">＋</span><strong>{file ? file.name : 'Add a leak photo'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ready to attach` : 'Leak photos only · JPG, PNG or WEBP · up to 8 MB'}</small><span className="upload-browse">Browse files</span></label>
        <small className="photo-privacy-hint">Do not upload identity documents or photos with private information.</small>
        {file && <button type="button" className="remove-photo-button" onClick={() => { setFile(null); setAi(null); setTrainingConsent(false); setError(''); setNotice('') }}>Remove selected photo</button>}
        {classifying && <div className="ai-callout"><span className="ai-spark">✳</span><div><strong>Looking at your photo…</strong><small>AI suggestion is optional and needs your review.</small></div></div>}
        {ai && <div className={`ai-callout ${ai.model_ready ? 'ai-ready' : 'ai-cold-start'}`}><span className="ai-spark">✳</span><div><strong>{ai.model_ready ? 'AI suggestion' : 'Cold-start estimate'} · {categories.find(([value]) => value === ai.suggested_category)?.[1] || ai.suggested_category}</strong><small>{Math.round(ai.confidence * 100)}% confidence · {ai.model_ready ? `model ${ai.model_version} · verify visually` : 'the WaterWatch model has not been trained on reviewed local photos yet; choose the category yourself'}</small></div></div>}
        {ai && <label>Report category<select value={form.category} onChange={(e) => { setManualCategory(true); update('category', e.target.value) }}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {!ai && <label>Report category<select value={form.category} onChange={(e) => { setManualCategory(true); update('category', e.target.value) }}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {file && <label className="training-consent"><input type="checkbox" checked={trainingConsent} onChange={(e) => setTrainingConsent(e.target.checked)} /><span><strong>Allow reviewed use for classifier improvement</strong><small>Optional. Only operations-reviewed photos may be used, and only after you opt in.</small></span></label>}
        <div className="ai-disclaimer">AI classifications are suggestions only. Your category choice always takes priority.</div>
      </section><section className="privacy-card"><span className="privacy-card-icon">⌖</span><div><strong>Your pin stays protected</strong><p>Public maps show an approximate area. Your exact location is shared only with you and authorized operations staff.</p></div></section>
      {notice && <div className="success-callout">{notice}</div>}{error && <div className="inline-error">{error}</div>}
      <button className="button button-dark button-full submit-report" disabled={busy || classifying || locating}>{busy ? 'Checking nearby reports…' : 'Submit leak report'}<span>→</span></button><p className="submit-hint">You can follow status updates from My reports.</p></aside>
    </form>
    {matches.length > 0 && <DuplicateWarningModal matches={matches} onClose={() => setMatches([])} onNewReport={() => { setMatches([]); createReport() }} onFinish={() => navigate('/')} />}
  </main>
}
