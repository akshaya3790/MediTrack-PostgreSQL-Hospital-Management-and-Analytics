import React, { useEffect } from 'react';
import { BrowserRouter as Router, Redirect, Route, Switch, useLocation } from 'react-router-dom';
import { AuthProvider, RequireRole, homeFor, useAuth } from './auth';
import { ToastProvider } from './components/ui';
import { AppLayout } from './components/Layout';
import Landing from './pages/Landing';
import {
  AdminLogin, ForgotPassword, Login, NotFound, RegisterDoctor, RegisterPatient, ResetPassword, Terms,
} from './pages/Auth';
import { DepartmentPage, DepartmentsPage } from './pages/Departments';
import { AdminDepartmentEdit, AdminDepartments, AdminDoctors } from './pages/Admin';
import { BookAppointment, PatientAppointments, PatientDashboard, PatientRecords } from './pages/Patient';
import { Diagnose, DoctorAppointments, DoctorDashboard, DoctorPatients, PatientRecord } from './pages/Doctor';
import Profile from './pages/Profile';

// Logged-in pages: checks the role, then wraps the page in the sidebar layout
const AppRoute = ({ role, component: Page, ...rest }) => (
  <Route {...rest}>
    <RequireRole role={role}>
      <AppLayout><Page /></AppLayout>
    </RequireRole>
  </Route>
);

// Login and registration are only for visitors; logged-in users go to their dashboard
const GuestRoute = ({ component: Page, ...rest }) => {
  const { user } = useAuth();
  return <Route {...rest}>{user ? <Redirect to={homeFor(user)} /> : <Page />}</Route>;
};

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <Router>
      <ToastProvider>
        <AuthProvider>
          <ScrollToTop />
          <a href="#main" className="skip-link">Skip to main content</a>
          <Switch>
            <Route exact path="/" component={Landing} />
            <GuestRoute path="/login" component={Login} />
            <GuestRoute path="/register/doctor" component={RegisterDoctor} />
            <GuestRoute path="/register" component={RegisterPatient} />
            <GuestRoute path="/forgot-password" component={ForgotPassword} />
            <GuestRoute path="/reset-password" component={ResetPassword} />
            <Route path="/terms" component={Terms} />
            <Route exact path="/departments" component={DepartmentsPage} />
            <Route exact path="/departments/:slug" component={DepartmentPage} />
            <GuestRoute path="/admin/login" component={AdminLogin} />

            <AppRoute exact path="/patient" role="pat" component={PatientDashboard} />
            <AppRoute path="/patient/book" role="pat" component={BookAppointment} />
            <AppRoute path="/patient/appointments" role="pat" component={PatientAppointments} />
            <AppRoute path="/patient/records" role="pat" component={PatientRecords} />

            <AppRoute exact path="/doctor" role="doc" component={DoctorDashboard} />
            <AppRoute exact path="/doctor/appointments" role="doc" component={DoctorAppointments} />
            <AppRoute path="/doctor/appointments/:id/diagnose" role="doc" component={Diagnose} />
            <AppRoute exact path="/doctor/patients" role="doc" component={DoctorPatients} />
            <AppRoute path="/doctor/patients/:email" role="doc" component={PatientRecord} />

            <AppRoute exact path="/admin" role="adm" component={AdminDepartments} />
            <AppRoute exact path="/admin/departments/:id" role="adm" component={AdminDepartmentEdit} />
            <AppRoute exact path="/admin/doctors" role="adm" component={AdminDoctors} />

            <AppRoute path="/profile" component={Profile} />
            <Route component={NotFound} />
          </Switch>
        </AuthProvider>
      </ToastProvider>
    </Router>
  );
}
