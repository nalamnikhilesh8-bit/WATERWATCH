const labels = { REPORTED: 'Reported', VERIFIED: 'Verified', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', DUPLICATE: 'Duplicate' }
export default function StatusBadge({ status }) {
  return <span className={`status-pill status-${String(status || '').toLowerCase()}`}><i aria-hidden="true" />{labels[status] || status}</span>
}
