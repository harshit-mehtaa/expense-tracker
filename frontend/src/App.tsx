import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import RemindersPage from '@/pages/Reminders';
import TransactionsPage from '@/pages/Transactions';
import AccountsPage from '@/pages/accounts/Accounts';
import InvestmentsPage from '@/pages/investments/Investments';
import InsurancePage from '@/pages/insurance/Insurance';
import BudgetsPage from '@/pages/budgets/Budgets';
import LoansPage from '@/pages/loans/Loans';
import TaxCentrePage from '@/pages/tax/TaxCentre';
import ReportsPage from '@/pages/admin/Reports';
import SettingsPage from '@/pages/Settings';
import AssetsPage from '@/pages/investments/Assets';
import ChangePasswordPage from '@/pages/ChangePassword';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="recurring" element={<Navigate to="/transactions?tab=recurring" replace />} />
        <Route path="accounts/*" element={<AccountsPage />} />
        <Route path="investments/*" element={<InvestmentsPage />} />
        <Route path="gold" element={<Navigate to="/assets?tab=gold" replace />} />
        <Route path="real-estate" element={<Navigate to="/assets?tab=real-estate" replace />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="insurance" element={<InsurancePage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="loans/*" element={<LoansPage />} />
        {/* Subscriptions moved under Transactions; keep old links and bookmarks working. */}
        <Route path="subscriptions" element={<Navigate to="/transactions?tab=subscriptions" replace />} />
        <Route path="tax/*" element={<TaxCentrePage />} />
        <Route path="profit-loss" element={<Navigate to="/reports" replace />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Categories moved under Settings; keep old links and bookmarks working. */}
        <Route path="categories" element={<Navigate to="/settings?tab=categories" replace />} />

        {/* Family Members moved under Settings as an admin-only tab (gated there). */}
        <Route path="family" element={<Navigate to="/settings?tab=family" replace />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
