import React, { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useHistory, useLocation } from 'react-router-dom';
import Icon from './Icon';
import { Avatar } from './ui';
import { homeFor, useAuth } from '../auth';
import { formatLongDate } from '../format';

export const Brand = ({ to = '/' }) => (
  <Link to={to} className="brand">
    <span className="brand-mark"><Icon name="logo" size={20} /></span>
    <span>
      HMS Hospital
      <small>Hospital Management System</small>
    </span>
  </Link>
);

// ---------- Public website ----------

export function SiteNav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [['/departments', 'Departments'], ['/#doctors', 'Doctors'], ['/#how', 'How it works'], ['/#contact', 'Contact']];

  return (
    <nav className="site-nav">
      <div className="container">
        <Brand />
        <div className={`nav-links ${open ? 'open' : ''}`}>
          {links.map(([href, label]) => (
            <Link key={href} to={href} onClick={() => setOpen(false)}>{label}</Link>
          ))}
        </div>
        <div className="nav-actions">
          {user ? (
            <Link to={homeFor(user)} className="btn btn-primary">
              Go to dashboard <Icon name="arrow-right" size={16} />
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-secondary">Log in</Link>
              <Link to="/register" className="btn btn-primary">Book appointment</Link>
            </>
          )}
          <button type="button" className="icon-btn nav-toggle" onClick={() => setOpen(o => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            <Icon name={open ? 'x' : 'menu'} />
          </button>
        </div>
      </div>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer" id="contact">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Brand />
            <p style={{ marginTop: 16, maxWidth: 300 }}>
              Book appointments, see your prescriptions and keep your medical history in one secure place.
            </p>
            <div className="emergency"><Icon name="phone" size={16} /> Emergency ambulance: 108</div>
          </div>
          <div>
            <h4>For patients</h4>
            <ul>
              <li><Link to="/register">Create an account</Link></li>
              <li><Link to="/login">Patient login</Link></li>
              <li><a href="/#departments">Departments</a></li>
              <li><a href="/#doctors">Find a doctor</a></li>
            </ul>
          </div>
          <div>
            <h4>For doctors</h4>
            <ul>
              <li><Link to="/register/doctor">Join as a doctor</Link></li>
              <li><Link to="/login?role=doctor">Doctor login</Link></li>
            </ul>
          </div>
          <div>
            <h4>Help</h4>
            <ul>
              <li><Link to="/forgot-password">Reset your password</Link></li>
              <li><Link to="/terms">Terms and privacy</Link></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} HMS Hospital. All rights reserved.</span>
          <span>Your records are private and visible only to you and your doctors.</span>
        </div>
      </div>
    </footer>
  );
}

// ---------- Logged-in app ----------

const navItems = {
  pat: [
    ['/patient', 'Dashboard', 'home'],
    ['/patient/book', 'Book appointment', 'calendar-plus'],
    ['/patient/appointments', 'My appointments', 'calendar'],
    ['/patient/records', 'Medical records', 'clipboard'],
  ],
  doc: [
    ['/doctor', 'Dashboard', 'home'],
    ['/doctor/appointments', 'Appointments', 'calendar'],
    ['/doctor/patients', 'My patients', 'users'],
  ],
  adm: [
    ['/admin', 'Departments', 'cross'],
    ['/admin/doctors', 'Doctors', 'stethoscope'],
  ],
};

const ROLE_LABELS = { pat: 'Patient', doc: 'Doctor', adm: 'Administrator' };

function UserMenu() {
  const { user, logout } = useAuth();
  const history = useHistory();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = e => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const signOut = () => logout().then(() => history.push('/login'));

  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-button" onClick={() => setOpen(o => !o)}>
        <Avatar name={user.name} />
        <div>
          <strong>{user.name}</strong>
          <span>{ROLE_LABELS[user.who]}</span>
        </div>
        <Icon name="chevron-down" size={16} />
      </button>
      {open && (
        <div className="dropdown">
          <Link to="/profile" onClick={() => setOpen(false)}><Icon name="user" size={16} /> My profile</Link>
          <Link to="/profile?tab=security" onClick={() => setOpen(false)}><Icon name="lock" size={16} /> Password &amp; security</Link>
          <Link to="/" onClick={() => setOpen(false)}><Icon name="home" size={16} /> Hospital website</Link>
          <hr />
          <button type="button" onClick={signOut}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const history = useHistory();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  const items = navItems[user.who];
  return (
    <div className="app">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Brand to={homeFor(user)} />
        <div className="sidebar-label">Menu</div>
        {items.map(([to, label, icon]) => (
          <NavLink key={to} to={to} exact={to === '/patient' || to === '/doctor' || to === '/admin'} className="side-link" activeClassName="active">
            <Icon name={icon} /> {label}
          </NavLink>
        ))}
        <div className="sidebar-label" style={{ marginTop: 18 }}>Account</div>
        <NavLink to="/profile" className="side-link" activeClassName="active">
          <Icon name="settings" /> Profile &amp; settings
        </NavLink>
        <button
          type="button"
          className="side-link"
          style={{ border: 'none', background: 'none', width: '100%', cursor: 'pointer', font: 'inherit' }}
          onClick={() => logout().then(() => history.push('/login'))}
        >
          <Icon name="logout" /> Sign out
        </button>
        {user.who === 'pat' ? (
          <div className="sidebar-cta">
            <strong>Need to see a doctor?</strong>
            Pick a department and a free time slot in under a minute.
            <Link to="/patient/book" className="btn btn-sm">Book now</Link>
          </div>
        ) : user.who === 'adm' ? (
          <div className="sidebar-cta">
            <strong>Public website</strong>
            Changes you save appear on the department pages straight away.
            <Link to="/departments" className="btn btn-sm">View departments</Link>
          </div>
        ) : (
          <div className="sidebar-cta">
            <strong>Today, {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</strong>
            Review today&apos;s visits and record diagnoses as you go.
            <Link to="/doctor/appointments" className="btn btn-sm">Open schedule</Link>
          </div>
        )}
      </aside>
      <div className={`backdrop ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-btn nav-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" />
            </button>
            <span className="topbar-date">{formatLongDate()}</span>
          </div>
          <UserMenu />
        </header>
        <main className="content" id="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
