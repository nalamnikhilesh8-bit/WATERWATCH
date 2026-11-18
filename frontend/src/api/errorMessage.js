function label(field) {
  if (field === "non_field_errors" || field === "detail") return ""
  return field.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function collectMessages(value, field = "") {
  if (Array.isArray(value)) return value.flatMap((item) => collectMessages(item, field))
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => collectMessages(item, [field, label(key)].filter(Boolean).join(" · ")))
  }
  if (value === null || value === undefined || value === "") return []
  return [`${field ? `${field}: ` : ""}${String(value)}`]
}

export function apiErrorMessage(error, { fallback = "The request could not be completed. Please try again.", network = "Could not reach WaterWatch. Check that the backend is running and try again." } = {}) {
  if (!error?.response) return network
  const data = error.response.data
  if (typeof data === "string" && data.trim()) return data
  if (data && typeof data === "object") {
    if (typeof data.detail === "string") return data.detail
    const messages = collectMessages(data)
    if (messages.length) return messages.join(" ")
  }
  return fallback
}
