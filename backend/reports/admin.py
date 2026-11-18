from django.contrib import admin
from .models import LeakReport, Location, ReportImage

class ReportImageInline(admin.TabularInline):
    model = ReportImage
    extra = 0

@admin.register(LeakReport)
class LeakReportAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "status", "severity_level", "priority_score", "is_demo", "created_at")
    list_filter = ("is_demo", "status", "category", "severity_level")
    search_fields = ("title", "description", "reporter__email")
    inlines = [ReportImageInline]

admin.site.register(Location)
