from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
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
