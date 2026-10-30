import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

// Layout shell
import Layout from './components/Layout';
import { TopProgressBar } from './components/TopProgressBar';
import { PageFallback } from './components/PageFallback';
import { GlobalModalContainer } from './components/GlobalModalContainer';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Code-split page components (Part B: Code-split every route with React.lazy + Suspense)
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/Register'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const ModuleView = React.lazy(() => import('./pages/ModuleView'));
const RecordForm = React.lazy(() => import('./pages/RecordForm'));
const Settings = React.lazy(() => import('./pages/Settings'));
const AccessPrivilege = React.lazy(() => import('./pages/AccessPrivilege'));
const LeadTransfer = React.lazy(() => import('./pages/LeadTransfer'));
const LeadImportDelete = React.lazy(() => import('./pages/LeadImportDelete'));
const UsersManagement = React.lazy(() => import('./pages/UsersManagement'));
const WorkflowsList = React.lazy(() => import('./pages/WorkflowsList'));
const ReportsList = React.lazy(() => import('./pages/ReportsList'));
const ReportDetails = React.lazy(() => import('./pages/ReportDetails'));
const LeadReportsPage = React.lazy(() => import('./pages/LeadReportsPage'));
const TelecallerReportsPage = React.lazy(() => import('./pages/TelecallerReportsPage'));
const TelecallerMonthlyPage = React.lazy(() => import('./pages/TelecallerMonthlyPage'));
const DailyFunnelPage = React.lazy(() => import('./pages/DailyFunnelPage'));
const MonthlyFunnelPage = React.lazy(() => import('./pages/MonthlyFunnelPage'));
const AnnualFunnelPage = React.lazy(() => import('./pages/AnnualFunnelPage'));
const CampaignReportPage = React.lazy(() => import('./pages/CampaignReportPage'));
const Status = React.lazy(() => import('./pages/Status'));
const MyCampaign = React.lazy(() => import('./pages/MyCampaign'));

// Route Guard for authenticated workspaces
function ProtectedRoute({ children, menuKey }: { children: React.ReactNode; menuKey?: string }) {
  const { isAuthenticated, isInitializing, canAccessMenu } = useAuthStore();

  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Initializing Workspace...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (menuKey && !canAccessMenu(menuKey)) {
    if (canAccessMenu('dashboard')) return <Navigate to="/" replace />;
    if (canAccessMenu('leads')) return <Navigate to="/modules/leads" replace />;
    if (canAccessMenu('campaigns')) return <Navigate to="/modules/campaigns" replace />;
    if (canAccessMenu('lead_reports')) return <Navigate to="/reports/lead-reports" replace />;
    return <Navigate to="/my-campaign" replace />;
  }

  return (
    <Layout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </Layout>
  );
}

function DashboardGuard() {
  const { canAccessMenu } = useAuthStore();
  if (!canAccessMenu('dashboard')) {
    if (canAccessMenu('leads')) return <Navigate to="/modules/leads" replace />;
    if (canAccessMenu('campaigns')) return <Navigate to="/modules/campaigns" replace />;
    if (canAccessMenu('lead_reports')) return <Navigate to="/reports/lead-reports" replace />;
    if (canAccessMenu('settings')) return <Navigate to="/settings" replace />;
    if (canAccessMenu('access_privilege')) return <Navigate to="/access-privilege" replace />;
    return <Navigate to="/my-campaign" replace />;
  }
  return <Dashboard />;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TopProgressBar />
      <GlobalModalContainer />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected Tenant Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardGuard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/status"
            element={
              <ProtectedRoute>
                <Status />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modules/:apiPath"
            element={
              <ProtectedRoute>
                <ModuleView />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modules/:apiPath/new"
            element={
              <ProtectedRoute>
                <RecordForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/modules/:apiPath/:id"
            element={
              <ProtectedRoute>
                <RecordForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workflows"
            element={
              <ProtectedRoute>
                <WorkflowsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <ReportsList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/lead-reports"
            element={
              <ProtectedRoute menuKey="lead_reports">
                <LeadReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/telecaller-reports"
            element={
              <ProtectedRoute menuKey="telecaller_reports">
                <TelecallerReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/telecaller-monthly"
            element={
              <ProtectedRoute menuKey="telecaller_monthly">
                <TelecallerMonthlyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/campaign-daily"
            element={
              <ProtectedRoute>
                <CampaignReportPage initialPeriod="daily" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/campaign-monthly"
            element={
              <ProtectedRoute>
                <CampaignReportPage initialPeriod="monthly" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/campaign-annual"
            element={
              <ProtectedRoute>
                <CampaignReportPage initialPeriod="annually" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/campaign-report"
            element={
              <ProtectedRoute>
                <CampaignReportPage initialPeriod="daily" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/funnel-daily"
            element={
              <ProtectedRoute menuKey="funnel_daily">
                <DailyFunnelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/funnel-monthly"
            element={
              <ProtectedRoute menuKey="funnel_monthly">
                <MonthlyFunnelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/funnel-annual"
            element={
              <ProtectedRoute menuKey="funnel_annual">
                <AnnualFunnelPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/:id"
            element={
              <ProtectedRoute>
                <ReportDetails />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute menuKey="settings">
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/access-privilege"
            element={
              <ProtectedRoute menuKey="access_privilege">
                <AccessPrivilege />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lead-transfer"
            element={
              <ProtectedRoute menuKey="lead_transfer">
                <LeadTransfer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lead-import-delete"
            element={
              <ProtectedRoute menuKey="lead_import_delete">
                <LeadImportDelete />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users-management"
            element={
              <ProtectedRoute menuKey="users_management">
                <UsersManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-campaign"
            element={
              <ProtectedRoute>
                <MyCampaign />
              </ProtectedRoute>
            }
          />

          {/* Catch-all Redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
