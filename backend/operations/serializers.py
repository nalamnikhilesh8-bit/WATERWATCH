from rest_framework import serializers
from .models import Assignment, MaintenanceTeam, StatusHistory

class MaintenanceTeamSerializer(serializers.ModelSerializer):
    lead_worker_name = serializers.CharField(source="lead_worker.get_full_name", read_only=True)
    class Meta:
        model = MaintenanceTeam
        fields = ("id", "name", "zone", "lead_worker", "lead_worker_name", "is_active")

class AssignmentSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    class Meta:
        model = Assignment
        fields = ("id", "report", "team", "team_name", "assigned_by", "assigned_at", "completion_notes", "resolved_at")
        read_only_fields = fields

class StatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.get_full_name", read_only=True)
    class Meta:
        model = StatusHistory
        fields = ("id", "old_status", "new_status", "changed_by", "changed_by_name", "note", "timestamp")
