import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AppContent } from './App'
import { DrawingsWorkspace } from './components/drawings/DrawingsWorkspace'
import LoginPage from './pages/LoginPage'
import PendingAccessPage from './pages/PendingAccessPage'
import TermsOfService from './pages/TermsOfService'
import PrivacyPolicy from './pages/PrivacyPolicy'
import ProjectEditorLayout from './pages/ProjectEditorLayout'
import { RequireInternalAccess } from './components/RequireInternalAccess'
import { JobBomRoute, JobCanvasRoute, JobDrawingsRoute } from './pm/components/JobWorkspace'
import JobContextOnlyLayout from './pm/components/JobContextOnlyLayout'
import JobWorkspaceLayout from './pm/components/JobWorkspaceLayout'
import PmShellLayout from './pm/pages/PmShellLayout'
import PmHomePage from './pm/pages/PmHomePage'
import PmInboxPage from './pm/pages/PmInboxPage'
import PmJobsPage from './pm/pages/PmJobsPage'
import PmInsightsPage from './pm/pages/PmInsightsPage'
import PmSettingsPage from './pm/pages/PmSettingsPage'
import PmJobLayout from './pm/pages/PmJobLayout'
import PmJobBoardPage from './pm/pages/PmJobBoardPage'
import PmJobListPage from './pm/pages/PmJobListPage'
import PmJobMyTasksPage from './pm/pages/PmJobMyTasksPage'
import PmJobDashboardPage from './pm/pages/PmJobDashboardPage'
import { homePath, inboxPath, jobPmPath, jobTasksBoardPath, jobTasksDashboardPath, jobTasksListPath, jobTasksMyTasksPath, jobsPath } from './pm/utils/pmRoutes'

function LegacyPmJobRedirect() {
  const { jobId = '', taskView = 'board' } = useParams()

  if (!jobId) {
    return <Navigate to={jobsPath()} replace />
  }

  const destination =
    taskView === 'list'
      ? jobTasksListPath(jobId)
      : taskView === 'my-tasks'
        ? jobTasksMyTasksPath(jobId)
        : taskView === 'dashboard'
          ? jobTasksDashboardPath(jobId)
          : jobTasksBoardPath(jobId)

  return <Navigate to={destination} replace />
}

function LegacyJobTasksRedirect() {
  const { jobId = '', taskView = 'board' } = useParams()

  if (!jobId) {
    return <Navigate to={jobsPath()} replace />
  }

  return <Navigate to={jobPmPath(jobId) + '/' + (taskView || 'board')} replace />
}

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/pending-access" element={<PendingAccessPage />} />
        <Route path="/terms" element={<TermsOfService />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />

				{/* Projects dashboard (post-login landing) */}
				<Route
					path="/projects"
					element={
						<RequireInternalAccess>
							<Navigate to={homePath()} replace />
						</RequireInternalAccess>
					}
				/>

				<Route
					element={
						<RequireInternalAccess>
							<PmShellLayout />
						</RequireInternalAccess>
					}
				>
					<Route path={homePath()} element={<PmHomePage />} />
					<Route path={inboxPath()} element={<PmInboxPage />} />
					<Route path={jobsPath()} element={<PmJobsPage />} />
					<Route path="/pm/insights" element={<PmInsightsPage />} />
					<Route path="/pm/settings" element={<PmSettingsPage />} />

					{/* ── Job Workspace Hub (inside PM shell) ── */}
					<Route path="/jobs/:jobId" element={<JobWorkspaceLayout />}>
						{/* Default: redirect to PM board */}
						<Route index element={<Navigate to="pm" replace />} />

						{/* PM board (tasks) – nested under /jobs/:jobId/pm */}
						<Route path="pm" element={<PmJobLayout embedded />}>
							<Route index element={<Navigate to="board" replace />} />
							<Route path="board" element={<PmJobBoardPage />} />
							<Route path="list" element={<PmJobListPage />} />
							<Route path="my-tasks" element={<PmJobMyTasksPage />} />
							<Route path="dashboard" element={<PmJobDashboardPage />} />
						</Route>

						{/* Placeholder routes */}
						<Route path="files" element={<div className="pm-job-layout"><div className="pm-panel"><h2 className="pm-page-title">Files</h2><p className="pm-page-subtitle">File management coming soon.</p></div></div>} />
						<Route path="settings" element={<div className="pm-job-layout"><div className="pm-panel"><h2 className="pm-page-title">Settings</h2><p className="pm-page-subtitle">Job settings coming soon.</p></div></div>} />
					</Route>
				</Route>

				{/* ── Dedicated full-page workspaces (outside PM shell) ── */}
				<Route
					path="/jobs/:jobId"
					element={
						<RequireInternalAccess>
							<JobContextOnlyLayout />
						</RequireInternalAccess>
					}
				>
					<Route path="canvas" element={<JobCanvasRoute />} />
					<Route path="drawings" element={<JobDrawingsRoute />} />
					<Route path="bom" element={<JobBomRoute />} />
				</Route>

				{/* Legacy /jobs/:jobId/tasks/* → redirect to /jobs/:jobId/pm/* */}
				<Route path="/jobs/:jobId/tasks" element={<LegacyJobTasksRedirect />} />
				<Route path="/jobs/:jobId/tasks/:taskView" element={<LegacyJobTasksRedirect />} />

				<Route path="/pm" element={<Navigate to={homePath()} replace />} />
				<Route path="/pm/home" element={<Navigate to={homePath()} replace />} />
					<Route path="/my-tasks" element={<Navigate to={homePath()} replace />} />
					<Route path="/pm/my-tasks" element={<Navigate to={homePath()} replace />} />
				<Route path="/pm/inbox" element={<Navigate to={inboxPath()} replace />} />
				<Route path="/pm/jobs" element={<Navigate to={jobsPath()} replace />} />
				<Route path="/pm/job/:jobId" element={<LegacyPmJobRedirect />} />
				<Route path="/pm/job/:jobId/:taskView" element={<LegacyPmJobRedirect />} />

				{/* Shared editor shell: model space + drawings workspace */}
				<Route
					path="/app/:projectId"
					element={
						<RequireInternalAccess>
							<ProjectEditorLayout />
						</RequireInternalAccess>
					}
				>
					<Route index element={<AppContent />} />
					<Route path="drawings" element={<DrawingsWorkspace />} />
				</Route>

				{/* Back-compat: /app without an id should not drop users into the canvas */}
				<Route path="/app" element={<Navigate to={homePath()} replace />} />
				<Route path="*" element={<Navigate to={homePath()} replace />} />
      </Routes>
    </BrowserRouter>
  )
}

