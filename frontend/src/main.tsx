import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n';
import './styles.css';
import { Loading } from './components';
import { AuthProvider, Protected } from './auth';
import { AppLayout, PublicLayout } from './layouts';
const AlertsPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.AlertsPage })));
const HomePage = lazy(() => import('./PublicPages').then((m) => ({ default: m.HomePage })));
const InformationPage = lazy(() =>
  import('./PublicPages').then((m) => ({ default: m.InformationPage })),
);
const ShelterDetails = lazy(() =>
  import('./PublicPages').then((m) => ({ default: m.ShelterDetails })),
);
const SheltersPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.SheltersPage })));
const AuthPage = lazy(() => import('./CitizenPages').then((m) => ({ default: m.AuthPage })));
const CitizenOverview = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.CitizenOverview })),
);
const MyRequests = lazy(() => import('./CitizenPages').then((m) => ({ default: m.MyRequests })));
const NewRequest = lazy(() => import('./CitizenPages').then((m) => ({ default: m.NewRequest })));
const NotificationsPage = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.NotificationsPage })),
);
const ProfilePage = lazy(() => import('./CitizenPages').then((m) => ({ default: m.ProfilePage })));
const RequestTracking = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.RequestTracking })),
);
const CaseDetails = lazy(() => import('./StaffPages').then((m) => ({ default: m.CaseDetails })));
const CaseQueue = lazy(() => import('./StaffPages').then((m) => ({ default: m.CaseQueue })));
const ResourcesPage = lazy(() =>
  import('./StaffPages').then((m) => ({ default: m.ResourcesPage })),
);
const ShelterManagement = lazy(() =>
  import('./StaffPages').then((m) => ({ default: m.ShelterManagement })),
);
const StaffOverview = lazy(() =>
  import('./StaffPages').then((m) => ({ default: m.StaffOverview })),
);
const AdminPage = lazy(() => import('./StaffSupport').then((m) => ({ default: m.AdminPage })));
const CrisesPage = lazy(() => import('./StaffSupport').then((m) => ({ default: m.CrisesPage })));
const VolunteerPage = lazy(() =>
  import('./StaffSupport').then((m) => ({ default: m.VolunteerPage })),
);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15000, refetchOnWindowFocus: false } },
});
const staffRoles = [
  'Coordinator',
  'CaseManager',
  'Logistics',
  'ShelterAdmin',
  'VolunteerCoordinator',
  'Partner',
];
function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<AuthPage />} />
        <Route path="register" element={<AuthPage register />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="shelters" element={<SheltersPage />} />
        <Route path="shelters/:id" element={<ShelterDetails />} />
        <Route path="contact" element={<InformationPage kind="contact" />} />
        <Route path="guidance" element={<InformationPage kind="guidance" />} />
        <Route path="privacy" element={<InformationPage kind="privacy" />} />
      </Route>
      <Route
        path="app"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<CitizenOverview />} />
        <Route path="requests" element={<MyRequests />} />
        <Route path="requests/new" element={<NewRequest />} />
        <Route path="requests/:id" element={<RequestTracking />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route
        path="staff"
        element={
          <Protected roles={staffRoles}>
            <AppLayout mode="staff" />
          </Protected>
        }
      >
        <Route index element={<StaffOverview />} />
        <Route path="cases" element={<CaseQueue />} />
        <Route path="cases/:id" element={<CaseDetails />} />
        <Route
          path="resources"
          element={
            <Protected roles={['Coordinator', 'Logistics']}>
              <ResourcesPage />
            </Protected>
          }
        />
        <Route
          path="shelters"
          element={
            <Protected roles={['Coordinator', 'ShelterAdmin']}>
              <ShelterManagement />
            </Protected>
          }
        />
        <Route
          path="volunteers"
          element={
            <Protected roles={['Coordinator', 'VolunteerCoordinator']}>
              <VolunteerPage />
            </Protected>
          }
        />
        <Route
          path="crises"
          element={
            <Protected roles={['Coordinator']}>
              <CrisesPage />
            </Protected>
          }
        />
      </Route>
      <Route
        path="volunteer"
        element={
          <Protected roles={['Volunteer']}>
            <AppLayout mode="volunteer" />
          </Protected>
        }
      >
        <Route index element={<VolunteerPage self />} />
      </Route>
      <Route
        path="admin"
        element={
          <Protected roles={['Administrator']}>
            <AppLayout mode="admin" />
          </Protected>
        }
      >
        <Route index element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<Loading />}>
            <App />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
