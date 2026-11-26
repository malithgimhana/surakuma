import { RecoveryPage } from './RecoveryPage';
import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Route, Routes, Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import './i18n';
import './styles.css';
import './citizen-workspace.css';
import './volunteer-self.css';
import { Loading } from './components';
import { AuthProvider, Protected } from './auth';
import { donorWorkspace, fundingWorkspace, isCitizenInbox, isCoordinatorWorkspace, isLogisticsWorkspace, isVolunteerCoordinatorWorkspace, isVolunteerSelfWorkspace, landing, staffRoles } from './countryScope';
import { useAuth } from './auth';
import { AppLayout, PublicLayout } from './layouts';
const AlertsPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.AlertsPage })));
const HomePage = lazy(() => import('./PublicPages').then((m) => ({ default: m.HomePage })));
const DonationPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.DonationPage })));
const InformationPage = lazy(() =>
  import('./PublicPages').then((m) => ({ default: m.InformationPage })),
);
const ShelterDetails = lazy(() =>
  import('./PublicPages').then((m) => ({ default: m.ShelterDetails })),
);
const SheltersPage = lazy(() => import('./PublicPages').then((m) => ({ default: m.SheltersPage })));
const AssistanceCentres = lazy(() => import('./AssistanceCentres').then(m => ({ default: m.AssistanceCentres })));
const ManageAssistanceCentres = lazy(() => import('./AssistanceCentres').then(m => ({ default: m.ManageAssistanceCentres })));
const CitizenHelp = lazy(() => import('./CitizenHelp'));
const AuthPage = lazy(() => import('./CitizenPages').then((m) => ({ default: m.AuthPage })));
const CitizenOverview = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.CitizenOverview })),
);
const MyRequests = lazy(() => import('./CitizenPages').then((m) => ({ default: m.MyRequests })));
const NewRequest = lazy(() => import('./CitizenPages').then((m) => ({ default: m.NewRequest })));
const NotificationsPage = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.NotificationsPage })),
);
const ProfilePage = lazy(() => import('./ProfilePage'));
const RequestTracking = lazy(() =>
  import('./CitizenPages').then((m) => ({ default: m.RequestTracking })),
);
const CaseDetails = lazy(() => import('./StaffPages').then((m) => ({ default: m.CaseDetails })));
const CaseQueue = lazy(() => import('./StaffPages').then((m) => ({ default: m.CaseQueue })));
const ResourcesPage = lazy(() =>
  import('./StaffPages').then((m) => ({ default: m.ResourcesPage })),
);
const AdminLogistics = lazy(() => import('./AdminLogistics'));
const ShelterManagement = lazy(() =>
  import('./StaffPages').then((m) => ({ default: m.ShelterManagement })),
);
const ShelterRegistration = lazy(() => import('./ShelterRegistration'));
const StaffOverview = lazy(() => import('./StaffOverview'));
const PartnerWorkspace = lazy(() => import('./PartnerWorkspace'));
const FundingWorkspace = lazy(() => import('./FundingWorkspace'));
const DonorWorkspace = lazy(() => import('./DonorWorkspace'));
const FundingOfficerWorkspace = lazy(() => import('./FundingOfficerWorkspace'));
const DecisionSupport = lazy(() => import('./DecisionSupport'));
const SupplySupport = lazy(() => import('./SupplySupport'));
const LogisticsSupplySupport = lazy(() => import('./LogisticsSupplySupport'));
const LogisticsCases = lazy(() => import('./LogisticsCases'));
const LogisticsProfile = lazy(() => import('./LogisticsProfile'));
const PartnerCommitments = lazy(() => import('./PartnerWorkspace').then((m) => ({ default: m.PartnerCommitments })));
const AdminPage = lazy(() => import('./StaffSupport').then((m) => ({ default: m.AdminPage })));
const CrisesPage = lazy(() => import('./StaffSupport').then((m) => ({ default: m.CrisesPage })));
const CrisisOperationsPage = lazy(() => import('./CrisisOperationsPage'));
const VolunteerPage = lazy(() =>
  import('./StaffSupport').then((m) => ({ default: m.VolunteerPage })),
);
const VolunteerCoordinatorWorkspace = lazy(() => import('./VolunteerCoordinatorWorkspace'));
const CoordinatorVolunteers = lazy(() => import('./CoordinatorVolunteers'));
const MyVolunteerAssignments = lazy(() => import('./MyVolunteerAssignments'));
const MyVolunteerProfile = lazy(() => import('./MyVolunteerProfile'));
function VolunteerAssignmentsRoute() {
  const { search } = useLocation();
  const task = new URLSearchParams(search).get('task') ?? undefined;
  return <MyVolunteerAssignments key={task ?? ''} initialTaskId={task} />;
}
const queryClient = new QueryClient({
  defaultOptions: { queries: {
    retry: (failures, error) => failures < 1 && !(isAxiosError(error) && error.response?.status === 403),
    staleTime: 15000,
    refetchOnWindowFocus: false,
  } },
});
function LogisticsRoute({ standard, logistics }: { standard: React.ReactNode; logistics: React.ReactNode }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  return isLogisticsWorkspace(user, pathname, search) ? logistics : standard;
}
function SharedAccountWorkspace() {
  const { user } = useAuth();
  const { pathname, search, hash } = useLocation();
  const home = user && landing(user);
  if (home === donorWorkspace) return <Navigate to={donorWorkspace} replace />;
  if (home === fundingWorkspace) {
    const path = pathname.toLowerCase().replace(/\/+$/, '');
    const profile = path === '/app/profile';
    const citizenPage = profile ? user?.roles.includes('Citizen') : isCitizenInbox(user, path, search);
    if (!citizenPage) return <Navigate to={`${fundingWorkspace}/${profile ? 'profile' : 'notifications'}${search}${hash}`} replace />;
  }
  return <AppLayout />;
}

function AccountProfileRoute() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  if (isVolunteerSelfWorkspace(user, pathname, search)) return <Navigate to="/volunteer/profile" replace />;
  return <LogisticsRoute standard={<ProfilePage />} logistics={<LogisticsProfile />} />;
}

function LegacyDonorRoute() {
  const { section } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${donorWorkspace}${section ? '/' + section : ''}${search}${hash}`} replace />;
}

function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomePage />} />
        <Route path="forgot-password" element={<RecoveryPage />} />
        <Route path="reset-password" element={<RecoveryPage reset />} />
        <Route path="login" element={<AuthPage />} />
        <Route path="register" element={<AuthPage register />} />
        <Route path="donation" element={<DonationPage />} />
        <Route path="donation/login" element={<AuthPage key="donor-login" donor />} />
        <Route path="donation/register" element={<AuthPage key="donor-register" donor register />} />
        <Route path="donation/forgot-password" element={<RecoveryPage donor />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="shelters" element={<SheltersPage />} />
        <Route path="shelters/:id" element={<ShelterDetails />} />
        <Route path="assistance-centres" element={<AssistanceCentres />} />
        <Route path="contact" element={<InformationPage kind="contact" />} />
        <Route path="guidance" element={<InformationPage kind="guidance" />} />
        <Route path="privacy" element={<InformationPage kind="privacy" />} />
      </Route>
      <Route path="app" element={<Protected><Outlet /></Protected>}>
        <Route element={<Protected roles={['Citizen']}><AppLayout /></Protected>}>
          <Route index element={<CitizenOverview />} />
          <Route path="requests" element={<MyRequests />} />
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="requests/:id" element={<RequestTracking />} />
          <Route path="alerts" element={<AlertsPage workspace />} />
          <Route path="shelters" element={<SheltersPage workspace />} />
          <Route path="shelters/:id" element={<ShelterDetails workspace />} />
          <Route path="assistance-centres" element={<AssistanceCentres workspace />} />
          <Route path="help" element={<CitizenHelp />} />
        </Route>
        <Route element={<SharedAccountWorkspace />}>
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<AccountProfileRoute />} />
        </Route>
      </Route>
      <Route
        path="staff"
        element={
          <Protected roles={['Administrator', 'CountryAdministrator', ...staffRoles]}>
            <AppLayout mode="staff" />
          </Protected>
        }
      >
        <Route index element={<StaffOverview />} />
        <Route path="crises/:id/decision-support" element={<Protected roles={['Coordinator', 'Administrator', 'CountryAdministrator']}><DecisionSupport /></Protected>} />
        <Route path="supply-support" element={<Protected roles={['Logistics', 'ShelterAdmin', 'Administrator', 'CountryAdministrator']}>
          <LogisticsRoute standard={<SupplySupport />} logistics={<LogisticsSupplySupport />} /></Protected>} />
        <Route path="cases" element={<LogisticsRoute standard={<CaseQueue />} logistics={<LogisticsCases />} />} />
        <Route path="cases/:id" element={<LogisticsRoute standard={<CaseDetails />} logistics={<LogisticsCases />} />} />
        <Route
          path="resources"
          element={
            <Protected roles={['Administrator', 'CountryAdministrator', 'Coordinator', 'Logistics']}>
              <LogisticsRoute standard={<ResourcesPage />} logistics={<AdminLogistics specialist />} />
            </Protected>
          }
        />
        <Route
          path="shelters"
          element={
            <Protected roles={['Administrator', 'CountryAdministrator', 'Coordinator', 'ShelterAdmin']}>
              <ShelterManagement />
            </Protected>
          }
        />
        <Route path="shelters/new" element={<Protected roles={['ShelterAdmin']}><ShelterRegistration /></Protected>} />
        <Route
          path="volunteers"
          element={
            <Protected roles={['Administrator', 'CountryAdministrator', 'Coordinator', 'VolunteerCoordinator']}>
              <VolunteerCoordinationRoute />
            </Protected>
          }
        />
        <Route
          path="crises"
          element={
            <Protected roles={['Administrator', 'CountryAdministrator', 'Coordinator']}>
              <CrisesPage />
            </Protected>
          }
        />
      </Route>
      <Route path="donor" element={<Protected roles={['Donor']} login="/donation/login"><AppLayout mode="donor" /></Protected>}>
        <Route index element={<DonorWorkspace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path=":section" element={<DonorWorkspace />} />
      </Route>
      <Route path="funding/:section?" element={<LegacyDonorRoute />} />
      <Route path={fundingWorkspace} element={<Protected roles={['FundingOfficer']}><AppLayout mode="funding" /></Protected>}>
        <Route index element={<FundingOfficerWorkspace />} />
        <Route path="profile" element={<ProfilePage funding />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path=":section" element={<FundingOfficerWorkspace />} />
      </Route>
      <Route path="partner" element={<Protected roles={['Partner']}><AppLayout mode="partner" /></Protected>}>
        <Route index element={<PartnerWorkspace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="supply-support" element={<SupplySupport />} />
        <Route path=":section" element={<PartnerWorkspace />} />
      </Route>
      <Route
        path="volunteer"
        element={
          <Protected roles={['Volunteer']}>
            <AppLayout mode="volunteer" />
          </Protected>
        }
      >
        <Route index element={<VolunteerAssignmentsRoute />} />
        <Route path="profile" element={<MyVolunteerProfile />} />
        <Route path="profile/edit" element={<MyVolunteerProfile editing />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route
        path="admin"
        element={
          <Protected roles={['Administrator','CountryAdministrator']}>
            <AppLayout mode="admin" />
          </Protected>
        }
      >
        <Route index element={<AdminPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="cases" element={<CaseQueue />} />
        <Route path="cases/:id" element={<CaseDetails />} />
        <Route path="crises" element={<CrisisOperationsPage />} />
        <Route path="crises/:id/decision-support" element={<DecisionSupport />} />
        <Route path="resources" element={<AdminLogistics />} />
        <Route path="shelters" element={<ShelterManagement />} />
        <Route path="assistance-centres" element={<ManageAssistanceCentres />} />
        <Route path="partner-commitments" element={<PartnerCommitments />} />
        <Route path="funding/:section?" element={<FundingWorkspace manage admin />} />
        <Route path="supply-support" element={<SupplySupport />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function VolunteerCoordinationRoute() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  return isCoordinatorWorkspace(user, pathname, search) ? <CoordinatorVolunteers /> :
    isVolunteerCoordinatorWorkspace(user, pathname, search) ? <VolunteerCoordinatorWorkspace /> : <VolunteerPage />;
}
const router = createBrowserRouter([{
  path: '*',
  element: <AuthProvider><Suspense fallback={<Loading />}><App /></Suspense></AuthProvider>,
}]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
