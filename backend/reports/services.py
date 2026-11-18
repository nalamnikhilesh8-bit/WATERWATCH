import math

FLOW_POINTS = {"LOW_DRIP": 15, "MODERATE_STREAM": 35, "HIGH_BURST": 55}

def calculate_distance_meters(lat1, lon1, lat2, lon2):
    """Return the great-circle distance between two decimal-degree coordinates."""
    radius_m = 6_371_000
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = math.radians(float(lat2) - float(lat1))
    d_lambda = math.radians(float(lon2) - float(lon1))
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def calculate_priority(estimated_flow, duration_hours, affected_households):
    score = min(100.0, FLOW_POINTS.get(estimated_flow, 15) + min(int(duration_hours) * 0.5, 20) + min(int(affected_households) * 1.5, 25))
    severity = "LOW" if score < 30 else "MEDIUM" if score < 55 else "HIGH" if score < 80 else "CRITICAL"
    return round(score, 1), severity
