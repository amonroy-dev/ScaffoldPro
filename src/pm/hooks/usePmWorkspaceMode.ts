import { useEffect } from 'react'

export function usePmWorkspaceMode() {
  useEffect(() => {
    document.body.classList.add('workspace-pm')
    return () => {
      document.body.classList.remove('workspace-pm')
    }
  }, [])
}