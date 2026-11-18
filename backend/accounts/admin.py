from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User

@admin.register(User)
class WaterWatchUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("WaterWatch profile", {"fields": ("role", "phone", "locality")}),)
    list_display = ("email", "username", "role", "is_active")
    ordering = ("email",)
