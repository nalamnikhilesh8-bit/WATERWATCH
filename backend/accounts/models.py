from django.contrib.auth.models import AbstractUser
from django.db import models

class User(AbstractUser):
    class Role(models.TextChoices):
        RESIDENT = "RESIDENT", "Resident"
        MAINTENANCE = "MAINTENANCE", "Maintenance"
        ADMIN = "ADMIN", "Administrator"

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.RESIDENT)
    phone = models.CharField(max_length=20, blank=True)
    locality = models.CharField(max_length=120, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    def __str__(self):
        return self.email
