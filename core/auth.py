"""JWT, password verification, get_current_user, role gating."""
from __future__ import annotations

import os
from datetime import timedelta

import jwt
from fastapi import HTTPException, Request, Depends

from .db import db
from .utils import now_utc

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]

ALLOWED_ROLES = {
    "super_admin", "admin", "reception", "cafeteria",
    "it_support", "facilities", "security",
}


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": now_utc() + timedelta(hours=12), "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def require_roles(*roles: str):
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in roles and user["role"] != "super_admin":
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _checker


def require_admin():
    return require_roles("super_admin", "admin")
