import axios from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000/api`
const api = axios.create({ baseURL: apiBaseUrl, timeout: 20000 })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ww_access')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshing = false
let waiters = []
const settleWaiters = (token, error) => {
  waiters.forEach(({ resolve, reject }) => error ? reject(error) : resolve(token))
  waiters = []
}

api.interceptors.response.use((response) => response, async (error) => {
  const original = error.config
  if (error.response?.status !== 401 || original?._retried || original?.url?.includes('/auth/login/')) throw error
  const refresh = localStorage.getItem('ww_refresh')
  if (!refresh) throw error
  if (refreshing) {
    const token = await new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    original.headers.Authorization = `Bearer ${token}`
    return api(original)
  }
  original._retried = true
  refreshing = true
  try {
    const { data } = await axios.post(`${api.defaults.baseURL}/auth/token/refresh/`, { refresh })
    localStorage.setItem('ww_access', data.access)
    if (data.refresh) localStorage.setItem('ww_refresh', data.refresh)
    settleWaiters(data.access)
    original.headers.Authorization = `Bearer ${data.access}`
    return api(original)
  } catch (refreshError) {
    settleWaiters(null, refreshError)
    localStorage.removeItem('ww_access')
    localStorage.removeItem('ww_refresh')
    localStorage.removeItem('ww_user')
    window.dispatchEvent(new Event('ww:unauthorized'))
    throw refreshError
  } finally {
    refreshing = false
  }
})

export default api
