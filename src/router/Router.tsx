import { useState, useEffect, createContext, useContext, ReactNode } from 'react'

type Route = '/' | '/login' | '/signup' | '/terms' | '/privacy' | '/app'

interface RouterContextType {
  currentRoute: Route
  navigate: (to: Route) => void
}

const RouterContext = createContext<RouterContextType | null>(null)

export function useRouter() {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}

function getInitialRoute(): Route {
  const path = window.location.pathname as Route
  const validRoutes: Route[] = ['/', '/login', '/signup', '/terms', '/privacy', '/app']
  return validRoutes.includes(path) ? path : '/'
}

interface RouterProviderProps {
  children: ReactNode
}

export function RouterProvider({ children }: RouterProviderProps) {
  const [currentRoute, setCurrentRoute] = useState<Route>(getInitialRoute)

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(getInitialRoute())
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = (to: Route) => {
    window.history.pushState({}, '', to)
    setCurrentRoute(to)
  }

  return (
    <RouterContext.Provider value={{ currentRoute, navigate }}>
      {children}
    </RouterContext.Provider>
  )
}

interface LinkProps {
  to: Route
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Link({ to, children, className, onClick }: LinkProps) {
  const { navigate } = useRouter()
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    onClick?.()
    navigate(to)
  }

  return (
    <a href={to} onClick={handleClick} className={className}>
      {children}
    </a>
  )
}

