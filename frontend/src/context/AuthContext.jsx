import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import api from '../api/axiosClient'

const AuthContext = createContext(null)
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ww_user')) } catch { return null }
  })
  const signOut = useCallback(() => {
    setUser(null)
    localStorage.removeItem('ww_access')
    localStorage.removeItem('ww_refresh')
    localStorage.removeItem('ww_user')
  }, [])
  useEffect(() => {
    const listener = () => signOut()
    window.addEventListener('ww:unauthorized', listener)
    return () => window.removeEventListener('ww:unauthorized', listener)
  }, [signOut])
  const signIn = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login/', credentials)
    localStorage.setItem('ww_access', data.access)
    localStorage.setItem('ww_refresh', data.refresh)
    localStorage.setItem('ww_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])
  const signUp = useCallback(async (profile) => {
    const { data } = await api.post('/auth/register/', profile)
    localStorage.setItem('ww_access', data.access)
    localStorage.setItem('ww_refresh', data.refresh)
    localStorage.setItem('ww_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])
  const value = useMemo(() => ({ user, signIn, signUp, signOut, isAuthenticated: Boolean(user) }), [user, signIn, signUp, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)
