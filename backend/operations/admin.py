from django.contrib import admin
from .models import Assignment, MaintenanceTeam, StatusHistory

admin.site.register(MaintenanceTeam)
admin.site.register(Assignment)
admin.site.register(StatusHistory)
