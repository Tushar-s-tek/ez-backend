from fastapi import APIRouter, Depends, HTTPException, Response

from core import db, hash_password, verify_password, create_access_token, get_current_user
from models import LoginInput

router = APIRouter(prefix="/auth")


@router.post("/login")
async def auth_login(payload: LoginInput, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], email, user["role"])
    response.set_cookie(
        key="access_token", value=token, httponly=True,
        secure=False, samesite="lax", max_age=43200, path="/",
    )
    return {"token": token, "user": {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "role": user["role"], "department_id": user.get("department_id"),
        "created_at": user.get("created_at"),
    }}


@router.post("/logout")
async def auth_logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return user
