# Hospital Management System

**Author:** akshaya ([@akshaya3790](https://github.com/akshaya3790))

A web application for running a hospital's everyday work: booking appointments, managing doctor schedules, recording diagnoses and keeping patients' medical histories. It has a public hospital website with a page for every department, separate dashboards for patients, doctors and administrators, and real-time appointment slots, all built on a relational PostgreSQL database that keeps the data consistent and easy to query.

![HMS Hospital home page](Screenshots/Landing.png)

**Tech stack**

| Layer    | Technology                                   |
| -------- | -------------------------------------------- |
| Frontend | React, React Router, hand-written CSS (white, navy and teal theme, responsive) |
| Backend  | Node.js, Express, express-session (sessions stored in PostgreSQL), bcrypt |
| Database | PostgreSQL (accessed through `pg`)           |

## Features

**Public website**

- Home page with the hospital's departments, its doctors and their working days, live statistics from the database and a "how it works" guide.
- **Department pages.** Every department card is a link to `/departments/<name>` (for example `/departments/cardiology`) that works with a mouse, a keyboard and a screen reader, and can be refreshed, bookmarked or opened in a new tab. Each page shows a breadcrumb, an introduction, the department's services, its doctors (qualifications, experience, fee, languages and working hours, only where the hospital has entered them), the free appointment times for the next two weeks, and contact details. Choosing a free time asks visitors to sign in or sign up and then opens the booking form with that doctor, date and time already chosen; the time is re-checked when the booking is confirmed. Unknown addresses show a "department not found" page.
- Everything on the department pages comes from the database. Nothing is made up: contact details, qualifications and fees that have not been entered are simply not shown, and the sample doctors are labelled "Demo profile".
- Patient and doctor sign-in with **"Keep me signed in"**, **forgot password** by email, and sign-up forms that check every field as you type.
- A terms and privacy page linked from sign-up.

**Patients**

1. A dashboard with their next appointment, visit statistics, recent prescriptions and quick actions.
2. Step-by-step booking: filter doctors by department, pick a date (days the doctor doesn't work are greyed out), then choose from the doctor's **free time slots**, which skip breaks, booked slots and times already past. The server still re-checks every booking for clashes.
3. A booking confirmation with a reference number.
4. Upcoming, past and all appointments in tabs, with a details popup showing the diagnosis and prescription, and cancellation with a confirmation dialog. Cancelling frees the slot for other patients.
5. A printable medical record: profile, medical background and a timeline of every visit.
6. A profile page to update their name, phone, date of birth and address, and to change their password.

**Doctors**

1. A dashboard with today's schedule, upcoming visits, visits awaiting a diagnosis, patient count and their working hours.
2. An appointment list with tabs (today, upcoming, awaiting diagnosis, completed) and search.
3. A diagnosis page that shows the visit details next to the form, and lets them update an earlier diagnosis.
4. A patient list with age, visit count and last and next visits, with live search, and each patient's full record.
5. A profile page to update their name and department.

**Administrators**

1. Add, edit, hide or show departments: name, web address, descriptions, common reasons to visit, icon, optional header image, phone, email, location, operating hours and instructions for patients.
2. Add, edit, switch off or delete a department's services.
3. Move doctors between departments and edit what patients see about them: qualifications, experience, fee, languages, profile, photo and working hours. A doctor or department can be switched off; existing appointments are kept but no new ones can be booked.
4. Changes appear on the public website at once. Administrator accounts are created from the command line (see below); there is no sign-up page for them.

**Across the site**

- Works on phones, tablets and desktops (the sidebar becomes a slide-out menu on small screens).
- Notifications for every action instead of browser pop-ups, loading and empty states, and a 404 page.
- Pages are protected by role: patients, doctors and administrators each see only their own area, and logged-out visitors are sent to sign in.

**Accounts and sessions**

- Sign-in creates a server-side session stored in the `session` table, referenced by an `HttpOnly`, `SameSite=Lax` cookie (also `Secure` in production). Scripts in the page cannot read it and nothing about the login is kept in `localStorage`.
- Without "Keep me signed in" the cookie ends when the browser closes, and the session expires after 8 hours without activity. With it, the cookie lasts 30 days.
- Signing out deletes the session on the server, so a copied cookie stops working at once. Changing or resetting a password signs out every other device.
- The session id is replaced at every sign-in, so an old id can never be reused.
- Forgot password emails a link that works once and expires after 30 minutes. Only a SHA-256 hash of the link's token is stored, and the page answers the same way whether or not the email is registered.
- The app checks the session before showing any page, so signed-in users never see the sign-in page flash, and every API route checks the role again on the server.
- There is no admin sign-up: administrators are created with `npm run create-admin`. Doctor sign-up can be limited to people with a hospital invite code (`DOCTOR_INVITE_CODE`).

**Input validation**

The same rules file ([`backend/validation.js`](backend/validation.js), copied to `frontend/src/validation.js`) runs in the browser and on the server, and the database has matching `CHECK` constraints, so bad data is refused even if someone skips the website and calls the API or the database directly.

| Field | Rule |
| ----- | ---- |
| First and last name | Letters from any language, spaces, hyphens, apostrophes and full stops; no digits or symbols; 1–50 characters each; extra spaces trimmed |
| Email | Valid address format, stored lowercased; a clear message if it is already registered |
| Mobile number | 10-digit Indian mobile number starting with 6–9, with or without `+91`; spaces and dashes in pasted numbers are removed; letters are refused; stored as `+91XXXXXXXXXX` |
| Password | At least 8 characters with an uppercase letter, a lowercase letter and a number; symbols allowed; at most 72 bytes; must be typed twice |
| Date of birth | A real calendar date, not in the future and not more than 120 years ago |
| Appointment date | From today up to 90 days ahead, on a day the doctor works, in a free slot |
| Address | 3–200 characters, must contain a letter, only letters, numbers, spaces and `, . / # - ' ( ) & : ;` |
| Gender, department, schedule | Only the options offered in the form |
| Medical notes, reason for visit, diagnosis | Trimmed, length-limited, no control characters |

Errors appear next to the field when you leave it and on submit, clear as soon as the value is fixed, are announced to screen readers, and never wipe the other fields.

**Security and privacy**

- Passwords are hashed with bcrypt and never stored or logged in plain text. Wrong email and wrong password give the same message.
- Five failed sign-ins for an account from one network lock further attempts for 15 minutes. Sign-ups and reset requests are rate limited too.
- Every request that changes data must carry an `X-Requested-With` header and come from the app's own origin, which blocks cross-site request forgery.
- Security headers (`nosniff`, `X-Frame-Options: DENY`, no referrer, no caching of API answers) are set on every response, and errors never include stack traces or request bodies.
- Every API route checks who is logged in. Patients can only see their own data. A doctor can only see the records of patients who have booked with them, and each such view is recorded in the `DoctorViewsHistory` audit table.
- All SQL queries are parameterized, which protects against SQL injection, and React escapes everything it displays.
- Multi-step writes such as registration, booking, diagnosis and password reset run inside database transactions. A booking locks the doctor's row and a unique index on doctor, date and start time stops two patients getting the same slot, even at the same moment.
- The public department endpoints return only what the website shows: no patient data, no doctor emails, and booked times appear only as missing free slots.
- Database credentials, the session secret and email settings live in an `.env` file, never in the code.

## Database design

```mermaid
erDiagram
    Patient ||--o{ PatientsAttendAppointments : books
    Appointment ||--|| PatientsAttendAppointments : "booked by"
    Doctor ||--o{ Appointment : "is booked for"
    Appointment ||--o| Diagnose : "gets"
    Doctor ||--o{ Diagnose : writes
    Patient ||--|| PatientsFillHistory : fills
    MedicalHistory ||--|| PatientsFillHistory : "filled by"
    Doctor ||--o{ DocsHaveSchedules : follows
    Schedule ||--o{ DocsHaveSchedules : "assigned to"
    Schedule ||--|{ ScheduleDays : "applies on"
    Department ||--o{ Doctor : "has"
    Department ||--o{ DepartmentService : offers
    Doctor ||--o{ DoctorViewsHistory : views
    MedicalHistory ||--o{ DoctorViewsHistory : "viewed in"

    Patient {
        varchar email PK
        varchar password
        varchar name
        varchar address
        varchar gender
        varchar phone
        date dob
    }
    Doctor {
        varchar email PK
        int id UK
        varchar password
        varchar name
        varchar gender
        varchar specialization FK
        varchar qualifications
        int experience_years
        numeric consultation_fee
        varchar languages
        boolean is_active
        boolean is_demo
    }
    Department {
        int id PK
        varchar name UK
        varchar slug UK
        varchar short_description
        text description
        varchar phone
        varchar email
        varchar location
        varchar operating_hours
        boolean is_active
    }
    DepartmentService {
        int id PK
        int department_id FK
        varchar name
        boolean is_active
    }
    Appointment {
        int id PK
        varchar doctor FK
        date date
        time starttime
        time endtime
        enum status
    }
    MedicalHistory {
        int id PK
        date date
        varchar conditions
        varchar surgeries
        varchar medication
    }
    Schedule {
        int id PK
        time starttime
        time endtime
        time breaktime
    }
    ScheduleDays {
        int sched PK
        enum day PK
    }
    Diagnose {
        int appt PK
        varchar doctor PK
        varchar diagnosis
        varchar prescription
    }
```

`Admin` (email, password hash, name) holds administrator accounts. The full schema is in [`DDL.sql`](DDL.sql) and the sample data is in [`InsertDML.sql`](InsertDML.sql).

## Running locally

**Prerequisites:** Node.js 18 or newer, and PostgreSQL 13 or newer (make sure `psql` is on your PATH).

1. **Create the database.** Load the schema and the sample data (this works in PowerShell, Command Prompt and bash):

   ```bash
   psql -U postgres -f DDL.sql
   psql -U postgres -f InsertDML.sql
   ```

   Then create a database user for the app. Open `psql -U postgres -d hms` and run:

   ```sql
   CREATE USER hms_user WITH PASSWORD 'choose-a-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hms_user;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO hms_user;
   ```

   If you reload `DDL.sql` later, run the two `GRANT` lines again (the user itself stays).

   **Upgrading an existing database** instead of reloading it: run the migrations in order, then the two `GRANT` lines again. `000` adds the phone, date of birth and specialization columns if your database predates them; `001` adds the session and password-reset tables, cleans up existing emails and phone numbers, and adds the validation constraints without touching your data:

   ```bash
   psql -U postgres -d hms -f migrations/000_add_new_columns.sql
   psql -U postgres -d hms -f migrations/001_auth_and_validation.sql
   ```

   If the old database stored passwords as plain text, hash them once so existing users can still sign in with the same password (run after the `GRANT` lines):

   ```bash
   cd backend && node scripts/hash-plaintext-passwords.js
   ```

   **Adding the department pages to an existing database.** Take a backup first, then run the department migration and the two `GRANT` lines again. It creates the `Department`, `DepartmentService` and `Admin` tables, seeds the ten starting departments and their services (only the first time), and adds the new doctor columns. It never deletes data and can safely be run again:

   ```bash
   pg_dump -U postgres -d hms -f hms_backup_before_departments.sql
   psql -U postgres -d hms -v ON_ERROR_STOP=1 -f migrations/002_departments.sql
   ```

   A doctor whose department is not in the list is moved to General Medicine, so check the Doctors page afterwards.

2. **Configure the backend.** Copy `backend/.env.example` to `backend/.env`, then fill in the database password and a long random `SESSION_SECRET`. The other settings are explained in the file: `DOCTOR_INVITE_CODE` limits doctor sign-up, and the `SMTP_*` settings send password reset emails (without them, the reset link is printed in the backend terminal during development).

3. **Install and start.** Start the backend first, then the frontend, each in its own terminal:

   ```bash
   cd backend && npm install && npm start    # http://localhost:3001
   cd frontend && npm install && npm start   # http://localhost:3000
   ```

4. **Open http://localhost:3000.** All the sample accounts use the password `password12`. It was set before the new password rules; any new or changed password must follow them.

   | Role    | Email                    |
   | ------- | ------------------------ |
   | Patient | priya@example.com        |
   | Patient | ramesh@example.com       |
   | Doctor  | anita.desai@example.com (Cardiology) |
   | Doctor  | vikram.menon@example.com (General Medicine) |
   | Doctor  | kavya.iyer@example.com (Pediatrics) |
   | Doctor  | arjun.nair@example.com (Orthopedics) |

   New doctors pick their department and one of the working schedules when they register.

5. **Create an administrator** to manage departments and doctors. The password is asked for twice in the terminal and is never shown:

   ```bash
   cd backend && npm run create-admin -- admin@yourhospital.in "Your Name"
   ```

   Then sign in at http://localhost:3000/admin/login. Running the command again for the same email sets a new password.

If the backend runs somewhere other than `localhost:3001`, set `REACT_APP_API_URL` in `frontend/.env`, and set `CLIENT_ORIGIN` in `backend/.env` to wherever the frontend runs.

When you put the built frontend (`npm run build`) on a web server, set it to answer unknown paths with `index.html`, so a refreshed or bookmarked address such as `/departments/cardiology` still opens. `npm start` already does this.

## API overview

| Method | Path                           | Who                            | Purpose                                         |
| ------ | ------------------------------ | ------------------------------ | ----------------------------------------------- |
| GET    | `/public/overview`             | anyone                         | Doctors, departments and counts for the website |
| GET    | `/public/schedules`            | anyone                         | Working schedules for doctor registration       |
| GET    | `/public/departments`          | anyone                         | Open departments with doctor and service counts |
| GET    | `/public/departments/:slug`    | anyone                         | One department with its services, doctors and contact details (404 if unknown or hidden) |
| GET    | `/public/departments/:slug/availability?date=&doctor=` | anyone | Free slots of the department's doctors on a date |
| POST   | `/auth/patient/register`       | anyone                         | Register a patient with their history           |
| POST   | `/auth/doctor/register`        | anyone                         | Register a doctor with a department and schedule |
| POST   | `/auth/login`                  | anyone                         | Log in (`isDoctor: true` or `role: "admin"` selects the role, `remember` keeps the login for 30 days) |
| POST   | `/auth/logout`                 | logged in                      | Log out                                         |
| GET    | `/auth/me`                     | anyone                         | Show who is logged in                           |
| POST   | `/auth/password`               | logged in                      | Change password (signs out other devices)       |
| POST   | `/auth/forgot-password`        | anyone                         | Email a password reset link                     |
| POST   | `/auth/reset-password`         | anyone with a valid link       | Set a new password with the link's token        |
| GET    | `/profile`                     | logged in                      | Own profile (and schedule for doctors)          |
| PUT    | `/profile`                     | logged in                      | Update own profile                              |
| GET    | `/doctors`                     | logged in                      | Doctors with department and working days        |
| GET    | `/doctors/:email/slots?date=`  | logged in                      | A doctor's free one-hour slots on a date        |
| GET    | `/appointments`                | patient / doctor               | Own appointments with diagnoses                 |
| POST   | `/appointments`                | patient                        | Book (with clash checks)                        |
| GET    | `/appointments/:id`            | appointment's patient / doctor | One appointment with its diagnosis              |
| DELETE | `/appointments/:id`            | appointment's patient / doctor | Cancel or remove                                |
| POST   | `/appointments/:id/diagnosis`  | appointment's doctor           | Save diagnosis                                  |
| GET    | `/patients?name=`              | doctor                         | Search own patients                             |
| GET    | `/patients/:email/history`     | the patient / their doctor     | Profile and medical background                  |
| GET    | `/patients/:email/visits`      | the patient / their doctor     | Every visit with diagnoses                      |
| GET    | `/admin/departments`           | admin                          | Every department, including hidden ones         |
| GET    | `/admin/departments/:id`       | admin                          | One department with its services and doctors    |
| POST   | `/admin/departments`           | admin                          | Add a department                                |
| PUT    | `/admin/departments/:id`       | admin                          | Edit, hide or show a department                 |
| POST   | `/admin/departments/:id/services` | admin                       | Add a service                                   |
| PUT    | `/admin/services/:id`          | admin                          | Edit or switch off a service                    |
| DELETE | `/admin/services/:id`          | admin                          | Delete a service                                |
| GET    | `/admin/doctors`               | admin                          | Every doctor with their profile and schedule    |
| PUT    | `/admin/doctors/:id`           | admin                          | Change a doctor's department, profile, schedule or status |

Every request that changes data needs the header `X-Requested-With: XMLHttpRequest`. Invalid input returns `400` with `{ "error": "...", "fields": { "field": "message" } }`. Not signed in is `401`, the wrong role is `403`, an unknown record is `404`, a duplicate or a slot that was just taken is `409`, and `503` means the database cannot be reached.

## Tests

```bash
# Backend: 54 tests for sign-up, sign-in, sessions, password reset, rate limits,
# access rules, validation, department pages, the admin area and double bookings. Uses a separate database that the tests wipe and reload.
createdb -U postgres -O hms_user hms_test
cd backend && npm test

# Frontend: form behaviour, sign-in and sign-up pages, department cards
cd frontend && npm test -- --watchAll=false

# Browser: refresh and "Keep me signed in" persistence, sign-out, redirects, keyboard use,
# validation messages, phone-sized layouts, every department card, booking from a department
# page and an admin edit. Start the backend and frontend first; the admin test needs an
# administrator's login in ADMIN_EMAIL and ADMIN_PASSWORD and is skipped without them.
cd e2e && npm install && npx playwright install chromium && npm test
```

## Screenshots

| | |
| --- | --- |
| Login<br>![Login](Screenshots/LogInScreen.png) | Patient registration<br>![Patient registration](Screenshots/PatientRegistration.png) |
| Field validation<br>![Validation](Screenshots/RegistrationValidation.png) | Wrong password<br>![Login error](Screenshots/LoginError.png) |
| Forgot password<br>![Forgot password](Screenshots/ForgotPassword.png) | 404 page<br>![Not found](Screenshots/NotFound.png) |
| Patient dashboard<br>![Patient dashboard](Screenshots/PatientHome.png) | Booking with free time slots<br>![Booking](Screenshots/SchedulingAppt.png) |
| Booking confirmed<br>![Booking confirmed](Screenshots/BookingConfirmed.png) | Patient's appointments<br>![Patient appointments](Screenshots/PatientViewingAppt.png) |
| Appointment details<br>![Appointment details](Screenshots/AppointmentDetails.png) | Medical record<br>![Medical record](Screenshots/PatientHistory.png) |
| Profile<br>![Profile](Screenshots/Profile.png) | Password change<br>![Password change](Screenshots/PasswordReset.png) |
| Doctor registration<br>![Doctor registration](Screenshots/DoctorRegistration.png) | Doctor dashboard<br>![Doctor dashboard](Screenshots/DoctorHome.png) |
| Doctor's appointments<br>![Doctor appointments](Screenshots/DoctorViewingAppt.png) | Recording a diagnosis<br>![Diagnosis](Screenshots/Diagnosis.png) |
| Doctor's patient list<br>![Patient list](Screenshots/DoctorPatientList.png) | Doctor viewing a patient's record<br>![Patient record](Screenshots/ViewingPatientHistory.png) |
| On a phone<br>![Mobile dashboard](Screenshots/MobileDashboard.png) | All departments<br>![Departments](Screenshots/DepartmentsList.png) |
| Department page<br>![Department page](Screenshots/DepartmentPage.png) | Department page on a phone<br>![Department on a phone](Screenshots/DepartmentMobile.png) |
| Booking from a department page<br>![Booking prefilled](Screenshots/BookingPrefilled.png) | Unknown department<br>![Department not found](Screenshots/DepartmentNotFound.png) |
| Admin: departments<br>![Admin departments](Screenshots/AdminDepartments.png) | Admin: editing a department<br>![Admin department edit](Screenshots/AdminDepartmentEdit.png) |
| Admin: editing a doctor<br>![Admin doctor edit](Screenshots/AdminDoctorEdit.png) | |

## Possible next steps

- Send email or SMS reminders before each appointment.
- Let patients reschedule an appointment, not only cancel it.
- Let administrators create and edit working schedules (they can already assign existing ones).
- Verify phone numbers and email addresses with a one-time code.
- Support phone numbers from outside India.
