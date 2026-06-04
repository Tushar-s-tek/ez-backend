"""All Pydantic models + status-transition maps."""
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, EmailStr


# -------- Auth --------
class LoginInput(BaseModel):
    email: EmailStr
    password: str


# -------- Locations --------
class LocationCreate(BaseModel):
    name: str
    code: Optional[str] = ""
    address: Optional[str] = ""
    timezone: Optional[str] = "UTC"
    active: bool = True


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    address: Optional[str] = None
    timezone: Optional[str] = None
    active: Optional[bool] = None


# -------- Users --------
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str
    department_id: Optional[str] = None
    location_id: Optional[str] = None                  # primary (where user is stationed)
    extra_location_ids: Optional[List[str]] = None     # read-only access to additional locations


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    department_id: Optional[str] = None
    location_id: Optional[str] = None
    extra_location_ids: Optional[List[str]] = None
    password: Optional[str] = None


# -------- Departments --------
class DepartmentCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    location_id: Optional[str] = None


# -------- Categories --------
class CategoryCreate(BaseModel):
    name: str
    icon: str = "Coffee"
    department_id: str
    color: str = "#0055FF"
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    group: str = "Hospitality"
    active: bool = True
    location_id: Optional[str] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    department_id: Optional[str] = None
    color: Optional[str] = None
    priority: Optional[str] = None
    group: Optional[str] = None
    active: Optional[bool] = None


# -------- Rooms --------
class RoomCreate(BaseModel):
    name: str
    floor: str = "1"
    location: str = "Main Office"
    department_id: Optional[str] = None
    location_id: Optional[str] = None


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    floor: Optional[str] = None
    location: Optional[str] = None
    department_id: Optional[str] = None
    location_id: Optional[str] = None


class RoomPinAuth(BaseModel):
    pin: str


# -------- Requests --------
class RequestCreate(BaseModel):
    room_id: str
    category_id: str
    pin: Optional[str] = None
    note: Optional[str] = ""


class RequestStatusUpdate(BaseModel):
    status: Literal["accepted", "in_progress", "delivered", "closed", "escalated"]
    note: Optional[str] = ""


STATUS_TRANSITIONS: Dict[str, List[str]] = {
    "requested": ["accepted", "escalated", "closed"],
    "accepted": ["in_progress", "delivered", "escalated", "closed"],
    "in_progress": ["delivered", "escalated", "closed"],
    "delivered": ["closed"],
    "closed": [],
    "escalated": ["accepted", "in_progress", "closed"],
}


# -------- Routing rules --------
class RoutingRuleCreate(BaseModel):
    category_id: str
    # Either single (legacy) or multi-department routing. The server normalises
    # this into `department_ids` (list) and keeps `department_id` (first item)
    # for backward compatibility.
    department_id: Optional[str] = None
    department_ids: Optional[List[str]] = None
    escalation_minutes: int = 15


# -------- Visitors --------
class VisitorCreate(BaseModel):
    name: str
    company: Optional[str] = ""
    purpose: Optional[str] = ""
    host_room_id: str
    phone: Optional[str] = ""
    expected_at: Optional[str] = None        # ISO timestamp for pre-registered visitors
    id_number: Optional[str] = ""             # govt ID / driver licence — masked in lists


class VisitorStatusUpdate(BaseModel):
    status: Literal["waiting", "notified", "checked_in", "checked_out", "blocked"]


class VisitorSelfCheckin(BaseModel):
    """Self check-in payload (public — protected by visitor PIN)."""
    pin: str
    photo_data_url: Optional[str] = None      # base64 data URL captured from webcam
    id_number: Optional[str] = ""
    nda_signed_name: Optional[str] = None     # who signed it (visitor's own name)


# -------- Menu / Pre-orders --------
class MenuItemCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    price: float = 0.0
    category: str = "Lunch"
    available: bool = True
    icon: str = "ForkKnife"
    color: str = "#B45309"
    location_id: Optional[str] = None
    # When set, orders of this item route to these departments instead of the
    # default Cafeteria. Multiple ids = any of those depts can claim it.
    department_ids: Optional[List[str]] = None


class MenuItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    category: Optional[str] = None
    available: Optional[bool] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    location_id: Optional[str] = None
    department_ids: Optional[List[str]] = None


class PreOrderCreate(BaseModel):
    room_id: str
    pin: str
    items: List[Dict[str, Any]]
    scheduled_for: Optional[str] = None
    note: Optional[str] = ""


class PreOrderStatusUpdate(BaseModel):
    status: Literal["pending", "accepted", "preparing", "delivered", "cancelled"]


PREORDER_TRANSITIONS: Dict[str, List[str]] = {
    "pending": ["accepted", "cancelled"],
    "accepted": ["preparing", "cancelled"],
    "preparing": ["delivered", "cancelled"],
    "delivered": [],
    "cancelled": [],
}


# -------- IoT --------
class IoTCommand(BaseModel):
    room_id: str
    pin: str
    device: Literal["ac", "light", "projector", "blinds"]
    action: str


# -------- Settings --------
class SettingsUpdate(BaseModel):
    slack_webhook_url: Optional[str] = None
    teams_webhook_url: Optional[str] = None
    whatsapp_token: Optional[str] = None
    whatsapp_phone_id: Optional[str] = None
    whatsapp_to: Optional[str] = None
    email_enabled: Optional[bool] = None
    # Notification sound profile per event (keys from /app/frontend/src/lib/sound.js)
    sound_new_request: Optional[str] = None
    sound_new_order: Optional[str] = None
    sound_accepted: Optional[str] = None
    sound_started: Optional[str] = None
    sound_ready: Optional[str] = None
    sound_escalated: Optional[str] = None
    sound_visitor: Optional[str] = None
    # Visitor management (per-location overrideable)
    nda_text: Optional[str] = None                  # NDA shown at self check-in. Empty disables NDA gate.
    nda_required: Optional[bool] = None             # If True, visitor must accept before badge issuance.
    visitor_badge_hours: Optional[float] = None     # how many hours the badge is valid for
