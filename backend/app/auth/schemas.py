from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # Matches LoginPage.tsx's `minLength={8}` for the register form — the
    # frontend constraint is just UX, this is the actual enforcement. Upper
    # bound is a sanity cap (not a policy choice) against oversized payloads
    # before they reach bcrypt.
    password: str = Field(min_length=8, max_length=128)
    firstName: str
    lastName: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refreshToken: str


class LogoutRequest(BaseModel):
    refreshToken: str


class UserOut(BaseModel):
    id: str
    email: str
    firstName: str
    lastName: str
    roles: list[str]
    status: str
    createdAt: str


class AuthResponse(BaseModel):
    accessToken: str
    refreshToken: str
    user: UserOut


class RefreshResponse(BaseModel):
    accessToken: str
    refreshToken: str
