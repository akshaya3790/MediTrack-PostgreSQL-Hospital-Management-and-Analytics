"""Machine learning module of the HMS analytics platform.

Reads only the analytics_marts views, writes only to analytics_ml and to ml/artifacts.
Results support planning (reminders, staffing). They must never be used for clinical decisions
or to refuse or deprioritise anyone's care.
"""
