// KPI definitions shown in the dashboard tooltips and in docs/kpi-definitions.md.
// Each one names the exact SQL the API runs (over analytics_marts.appointments, filtered by
// date range, department, doctor and status).
const KPIS = [
  {
    id: 'appointments',
    name: 'Appointments',
    definition: 'Appointments in the date range that are still in the hospital system (removed ones excluded).',
    sql: 'COUNT(*) FILTER (WHERE NOT is_removed)',
  },
  {
    id: 'completed',
    name: 'Completed',
    definition: 'Appointments marked done (a diagnosis was recorded).',
    sql: "COUNT(*) FILTER (WHERE status = 'completed')",
  },
  {
    id: 'scheduled',
    name: 'Upcoming',
    definition: 'Not yet done, dated today or later.',
    sql: "COUNT(*) FILTER (WHERE status = 'scheduled')",
  },
  {
    id: 'unresolved',
    name: 'Not completed',
    definition: 'Date has passed but the appointment was never marked done. This is the closest measure of no-shows the hospital data allows: it also includes visits that happened but were not documented.',
    sql: "COUNT(*) FILTER (WHERE status = 'unresolved')",
  },
  {
    id: 'removed',
    name: 'Removed (cancelled)',
    definition: 'Appointments the pipeline saw on an earlier run that were later deleted. The hospital app deletes an appointment when a patient cancels or a doctor removes it, so only removals after the pipeline started running can be counted.',
    sql: 'COUNT(*) FILTER (WHERE is_removed)',
  },
  {
    id: 'completion_rate',
    name: 'Completion rate',
    definition: 'Completed divided by past appointments (completed + not completed). Upcoming appointments are left out because their outcome is not known yet.',
    sql: "COUNT(*) FILTER (WHERE status = 'completed')::numeric / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'unresolved')), 0)",
  },
  {
    id: 'not_completed_rate',
    name: 'Not-completed rate (no-show proxy)',
    definition: 'Not completed divided by past appointments. Read as an upper bound on the no-show rate.',
    sql: "COUNT(*) FILTER (WHERE status = 'unresolved')::numeric / NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'unresolved')), 0)",
  },
  {
    id: 'removal_rate',
    name: 'Removal rate',
    definition: 'Removed divided by all appointments the pipeline has seen in the range, including removed ones.',
    sql: 'COUNT(*) FILTER (WHERE is_removed)::numeric / NULLIF(COUNT(*), 0)',
  },
  {
    id: 'slot_utilization',
    name: 'Slot utilisation',
    definition: "Booked appointments divided by the one-hour slots doctors' working hours offered on the same days. Days before the pipeline's first run use today's working hours (marked as back-filled).",
    sql: 'SUM(appointments)::numeric / NULLIF(SUM(scheduled_slots), 0)  -- over analytics_marts.daily_department_operations',
  },
  {
    id: 'patients',
    name: 'Patients seen or booked',
    definition: 'Distinct pseudonymous patients with an appointment in the range. Groups smaller than 5 are hidden in patient breakdowns.',
    sql: 'COUNT(DISTINCT patient_sk) FILTER (WHERE NOT is_removed)',
  },
  {
    id: 'demand_change',
    name: 'Change in demand',
    definition: 'Appointments in the range compared with the same number of days immediately before it.',
    sql: '(current_period - previous_period)::numeric / NULLIF(previous_period, 0)',
  },
];

module.exports = { KPIS };
