import { Sidebar } from '@/components/layout/Sidebar'
import { MetricLibraryPanel } from '@/components/metrics/MetricLibraryPanel'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', backgroundColor: 'var(--color-bg-primary)' }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </main>
      <MetricLibraryPanel />
    </div>
  )
}
