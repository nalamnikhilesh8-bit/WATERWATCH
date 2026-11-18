export default function SeverityIndicator({ score, severity }) {
  const level = severity || (score >= 80 ? 'CRITICAL' : score >= 55 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW')
  return <span className={`severity severity-${level.toLowerCase()}`}><span className="severity-dot" />{level.toLowerCase()} priority <b>{Math.round(score || 0)}</b></span>
}
