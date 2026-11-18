import { useEffect, useState } from 'react'
import api from '../../api/axiosClient'

const labels = { suspected_pipe_leak: 'Pipe leak', overflow: 'Overflow', damaged_valve: 'Damaged valve', other: 'Other' }

export default function ClassifierStatusPanel() {
  const [model, setModel] = useState(null)
  useEffect(() => { api.get('/reports/classifier-status/').then(({ data }) => setModel(data)).catch(() => setModel({ unavailable: true })) }, [])
  return <section className="panel model-status-panel">
    <div className="model-status-main"><div><div className="eyebrow">IMAGE CLASSIFIER</div><h2>{model?.model_ready ? 'Reviewed model is active' : 'Collecting reviewed examples'}</h2><p>{model?.model_ready ? `Version ${model.model_version} · ${Math.round((model.test_accuracy || 0) * 100)}% held-out test accuracy · ${Math.round((model.test_macro_f1 || 0) * 100)}% macro F1` : 'Live suggestions remain low-confidence until a reviewed model is trained.'}</p></div><span className={`model-status-pill ${model?.model_ready ? 'is-ready' : ''}`}><i />{model?.model_ready ? 'TRAINED' : model?.unavailable ? 'STATUS UNAVAILABLE' : 'COLD START'}</span></div>
    {model?.eligible_class_counts && <><div className="eyebrow">ELIGIBLE FOR NEXT TRAINING RUN</div><div className="model-class-counts">{Object.entries(model.eligible_class_counts).map(([category, count]) => <span key={category}><b>{count}/{model.minimum_per_class}</b>{labels[category] || category.replaceAll('_', ' ')}</span>)}</div></>}
    {model?.class_counts && model?.model_ready && <><div className="eyebrow">PHOTOS IN ACTIVE MODEL</div><div className="model-class-counts">{Object.entries(model.class_counts).map(([category, count]) => <span key={category}><b>{count}</b>{labels[category] || category.replaceAll('_', ' ')}</span>)}</div></>}
    <div className="model-status-foot">Training uses only before-repair photos with resident opt-in and an operations-reviewed label. Placeholder demo drawings are excluded. After each category reaches {model?.minimum_per_class || 100} approved photos, run <code>python manage.py train_image_classifier</code>.</div>
  </section>
}
