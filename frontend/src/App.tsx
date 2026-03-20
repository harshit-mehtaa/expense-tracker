import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { AppShell } from '@/components/layout/AppShell';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import TransactionsPage from '@/pages/Transactions';
import AccountsPage from '@/pages/accounts/Accounts';
import InvestmentsPage from '@/pages/investments/Investments';
import InsurancePage from '@/pages/insurance/Insurance';
import BudgetsPage from '@/pages/budgets/Budgets';
import LoansPage from '@/pages/loans/Loans';
import TaxCentrePage from '@/pages/tax/TaxCentre';
import FamilyMembersPage from '@/pages/admin/FamilyMembers';
import ReportsPage from '@/pages/admin/Reports';
import SettingsPage from '@/pages/Settings';
import GoldRealEstatePage from '@/pages/investments/GoldRealEstate';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="accounts/*" element={<AccountsPage />} />
        <Route path="investments/*" element={<InvestmentsPage />} />
        <Route path="gold-realestate" element={<GoldRealEstatePage />} />
        <Route path="insurance" element={<InsurancePage />} />
        <Route path="budgets" element={<BudgetsPage />} />
        <Route path="loans/*" element={<LoansPage />} />
        <Route path="tax/*" element={<TaxCentrePage />} />
        <Route path="settings" element={<SettingsPage />} />

        {/* Admin-only routes */}
        <Route
          path="family"
          element={
            <AdminRoute>
              <FamilyMembersPage />
            </AdminRoute>
          }
        />
        <Route
          path="reports"
          element={
            <AdminRoute>
              <ReportsPage />
            </AdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
