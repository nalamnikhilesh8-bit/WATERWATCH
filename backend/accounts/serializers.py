from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken
from .models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "username", "first_name", "last_name", "role", "phone", "locality")
        read_only_fields = ("id", "role")

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    class Meta:
        model = User
        fields = ("email", "username", "password", "first_name", "last_name", "phone", "locality")

    def create(self, validated_data):
        return User.objects.create_user(role=User.Role.RESIDENT, **validated_data)

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        request = self.context.get("request")
        user = authenticate(request=request, username=attrs["email"], password=attrs["password"])
        if not user or not user.is_active:
            raise serializers.ValidationError("Email or password is incorrect.")
        refresh = RefreshToken.for_user(user)
        return {"access": str(refresh.access_token), "refresh": str(refresh), "user": UserSerializer(user).data}
