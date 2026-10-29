-- 1. Patients (Password for all accounts is: password12)
INSERT INTO Patient(email, password, name, address, gender)
VALUES
('arjun.sharma@example.com', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Arjun Sharma', 'Bandra West, Mumbai', 'male'),
('neha.patel@example.com', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Neha Patel', 'Navrangpura, Ahmedabad', 'female'),
('rohit.verma@example.com', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Rohit Verma', 'Connaught Place, New Delhi', 'male'),
('ananya.iyer@example.com', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Ananya Iyer', 'Mylapore, Chennai', 'female'),
('kavita.reddy@example.com', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Kavita Reddy', 'Banjara Hills, Hyderabad', 'female')
ON CONFLICT (email) DO NOTHING;

-- 2. Medical Histories (IDs 5 to 9)
INSERT INTO MedicalHistory(id, date, conditions, surgeries, medication)
VALUES
(5, CURRENT_DATE - INTERVAL '60 days', 'Hypertension', 'Appendectomy (2021)', 'Amlodipine 5mg'),
(6, CURRENT_DATE - INTERVAL '45 days', 'Type 2 Diabetes', 'None', 'Metformin 500mg'),
(7, CURRENT_DATE - INTERVAL '30 days', 'Asthma', 'None', 'Albuterol Inhaler'),
(8, CURRENT_DATE - INTERVAL '90 days', 'Chronic Migraine', 'Wisdom Teeth Extraction', 'Sumatriptan 50mg'),
(9, CURRENT_DATE - INTERVAL '15 days', 'Hypothyroidism', 'None', 'Levothyroxine 50mcg')
ON CONFLICT (id) DO NOTHING;

-- 3. Link Patients to Medical History
INSERT INTO PatientsFillHistory(patient, history)
VALUES
('arjun.sharma@example.com', 5),
('neha.patel@example.com', 6),
('rohit.verma@example.com', 7),
('ananya.iyer@example.com', 8),
('kavita.reddy@example.com', 9)
ON CONFLICT (history) DO NOTHING;

-- 4. Doctors (Password: password12)
INSERT INTO Doctor(email, gender, password, name)
VALUES
('rajesh.gupta@example.com', 'male', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Rajesh Gupta'),
('sneha.kulkarni@example.com', 'female', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Sneha Kulkarni'),
('farhan.khan@example.com', 'male', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Farhan Khan')
ON CONFLICT (email) DO NOTHING;

-- 5. Schedules (IDs 3, 4, 5)
INSERT INTO Schedule(id, starttime, endtime, breaktime)
VALUES
(3, '09:00', '17:00', '13:00'),
(4, '10:00', '18:00', '13:00'),
(5, '08:00', '16:00', '12:00')
ON CONFLICT (id) DO NOTHING;

-- 6. Schedule Days
INSERT INTO ScheduleDays(sched, day)
VALUES
(3, 'Monday'), (3, 'Wednesday'), (3, 'Thursday'), (3, 'Friday'),
(4, 'Tuesday'), (4, 'Thursday'), (4, 'Saturday'), (4, 'Sunday'),
(5, 'Monday'), (5, 'Tuesday'), (5, 'Thursday'), (5, 'Friday')
ON CONFLICT (sched, day) DO NOTHING;

-- 7. Link Doctors to Schedules
INSERT INTO DocsHaveSchedules(sched, doctor)
VALUES
(3, 'rajesh.gupta@example.com'),
(4, 'sneha.kulkarni@example.com'),
(5, 'farhan.khan@example.com')
ON CONFLICT (sched, doctor) DO NOTHING;

-- 8. Sample Appointments (IDs 4, 5, 6, 7, 8)
INSERT INTO Appointment(id, doctor, date, starttime, endtime, status)
VALUES
(4, 'anita.desai@example.com', CURRENT_DATE + INTERVAL '1 day', '09:00', '10:00', 'NotDone'),
(5, 'vikram.menon@example.com', CURRENT_DATE + INTERVAL '1 day', '10:00', '11:00', 'NotDone'),
(6, 'rajesh.gupta@example.com', CURRENT_DATE, '09:00', '10:00', 'Done'),
(7, 'sneha.kulkarni@example.com', CURRENT_DATE, '10:00', '11:00', 'Done'),
(8, 'farhan.khan@example.com', CURRENT_DATE + INTERVAL '1 day', '14:00', '15:00', 'NotDone')
ON CONFLICT (id) DO NOTHING;

-- 9. Patients Attend Appointments
INSERT INTO PatientsAttendAppointments(patient, appt, concerns, symptoms)
VALUES
('arjun.sharma@example.com', 4, 'Annual Cardiac Checkup', 'Mild palpitations during cardio'),
('neha.patel@example.com', 5, 'Blood Glucose Review', 'Increased thirst and mild fatigue'),
('rohit.verma@example.com', 6, 'Shortness of breath', 'Wheezing when climbing stairs'),
('ananya.iyer@example.com', 7, 'Severe recurring headache', 'Throbbing pain on left side with light sensitivity'),
('kavita.reddy@example.com', 8, 'Knee joint stiffness', 'Pain when walking in the morning')
ON CONFLICT (patient, appt) DO NOTHING;

-- 10. Diagnoses for completed appointments
INSERT INTO Diagnose(appt, doctor, diagnosis, prescription)
VALUES
(6, 'rajesh.gupta@example.com', 'Exercise-induced Bronchospasm', 'Montelukast 10mg once daily at night, Salbutamol inhaler before exercise'),
(7, 'sneha.kulkarni@example.com', 'Acute Migraine with Aura', 'Naproxen 500mg as needed, Sumatriptan at onset of aura')
ON CONFLICT (appt, doctor) DO NOTHING;

-- 11. Update sequences
SELECT setval(pg_get_serial_sequence('medicalhistory', 'id'), (SELECT MAX(id) FROM MedicalHistory));
SELECT setval(pg_get_serial_sequence('schedule', 'id'), (SELECT MAX(id) FROM Schedule));
SELECT setval(pg_get_serial_sequence('appointment', 'id'), (SELECT MAX(id) FROM Appointment));
