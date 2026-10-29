-- Sample data. Every sample account's password is: password12
-- Run with: psql -U postgres -f InsertDML.sql
\c hms

INSERT INTO Patient(email,password,name,address,gender,phone,dob)
VALUES
('ramesh@example.com','$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u','Ramesh Kumar','Tamil Nadu','male','+919800000001','1985-04-12'),
('suresh@example.com','$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u','Suresh Rao','Karnataka','male','+919800000002','1992-09-03'),
('priya@example.com','$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u','Priya Shah','Gujarat','female','+919800000003','1998-01-27')
;

INSERT INTO MedicalHistory(id,date,conditions,surgeries,medication)
VALUES
(1,'2024-01-14','Pain in abdomen','Heart Surgery','Crocin'),
(2,'2024-01-14','Frequent Indigestion','none','none'),
(3,'2024-01-14','Body Pain','none','Iodex')
;

INSERT INTO PatientsFillHistory(patient,history)
VALUES
('ramesh@example.com', 1),
('suresh@example.com', 2),
('priya@example.com', 3)
;

INSERT INTO Doctor(email, gender, password, name, specialization)
VALUES
('anita.desai@example.com', 'female', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Anita Desai', 'Cardiology'),
('vikram.menon@example.com', 'male', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Vikram Menon', 'General Medicine'),
('kavya.iyer@example.com', 'female', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Kavya Iyer', 'Pediatrics'),
('arjun.nair@example.com', 'male', '$2a$10$qxFxcwb7U1LsjPreMkrACuNgcTqkD4Jvlw9dIEqqpVFogqTvbaS0u', 'Dr. Arjun Nair', 'Orthopedics')
;

INSERT INTO Schedule(id,starttime,endtime,breaktime)
VALUES
(1,'09:00','17:00','12:00'),
(2,'09:00','17:00','12:00')
;

INSERT INTO ScheduleDays(sched,day)
VALUES
(1,'Tuesday'),
(1,'Friday'),
(1,'Saturday'),
(1,'Sunday'),
(2,'Wednesday'),
(2,'Friday')
;

INSERT INTO DocsHaveSchedules(sched,doctor)
VALUES
(1,'anita.desai@example.com'),
(2,'vikram.menon@example.com'),
(2,'kavya.iyer@example.com'),
(1,'arjun.nair@example.com')
;

INSERT INTO Appointment(id,doctor,date,starttime,endtime,status)
VALUES
(1,'anita.desai@example.com','2024-01-15','09:00','10:00','Done'),
(2,'vikram.menon@example.com','2024-01-17','10:00','11:00','Done'),
(3,'vikram.menon@example.com','2024-01-19','14:00','15:00','Done')
;

INSERT INTO PatientsAttendAppointments(patient,appt,concerns,symptoms)
VALUES
('ramesh@example.com',1,'none','itchy throat'),
('suresh@example.com',2,'infection','fever'),
('priya@example.com',3,'nausea','fever')
;

INSERT INTO Diagnose(appt,doctor,diagnosis,prescription)
VALUES
(1,'anita.desai@example.com','Bloating','Ibuprofen as needed'),
(2,'vikram.menon@example.com','Muscle soreness','Stretch morning/night'),
(3,'vikram.menon@example.com','Vitamin Deficiency','Good Diet')
;

-- The rows above set their ids by hand, so move each id counter past them
SELECT setval(pg_get_serial_sequence('medicalhistory', 'id'), (SELECT MAX(id) FROM MedicalHistory));
SELECT setval(pg_get_serial_sequence('schedule', 'id'), (SELECT MAX(id) FROM Schedule));
SELECT setval(pg_get_serial_sequence('appointment', 'id'), (SELECT MAX(id) FROM Appointment));

-- The sample doctors are fictional. Mark them as demo profiles so the website labels them,
-- and give them only the details a demo needs (no invented qualifications or experience).
UPDATE Doctor SET is_demo = TRUE, languages = 'English, Hindi', consultation_fee = 500
WHERE email IN ('anita.desai@example.com', 'vikram.menon@example.com', 'kavya.iyer@example.com', 'arjun.nair@example.com');
